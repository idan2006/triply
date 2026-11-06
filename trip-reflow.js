/* Keeps the day plan (dailySchedule) in step with the trip's places (stops) after ANY change —
 * the chat, dragging, the place editor, adding or deleting a place, moving it to another day.
 * The places are the "what", this file decides the "when": every changed day is re-timed by
 * TriplyDayLayout, so walking / public-transport times always follow the new order.
 * syncDay / reflow are pure (testable in Node); ensureCoords / prepare / commit run in the app. */
(function (root) {
  "use strict";
  const L = () => root.TriplyDayLayout;
  const TP = () => root.TripPlanning;
  const toMin = (v) => L().toMin(v);
  const clock = (v) => L().clock(v);
  const norm = (v) =>
    String(v || "")
      .normalize("NFKC")
      .replace(/^ביקור:\s*/, "")
      .trim()
      .toLocaleLowerCase();
  const valid = (p) =>
    p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(+p.lat === 0 && +p.lng === 0);
  const clampDur = (v) => Math.max(5, Math.min(1440, Math.round(Number(v) || 60))); // same limits as TripModel
  const MAX_LATER = 60; // the bedtime may slide this much later before a change is refused

  /* Hotel for the night of `date`: per-hotel points (multi-hotel trips) → the main lodging point → (hotel not on the
   * map, e.g. offline or not found) the city centre as an estimate, like the planner itself does. */
  function homeFor(trip, date) {
    const td = trip.travelDetails || {};
    const list = Array.isArray(td.lodgingPoints) ? td.lodgingPoints : [];
    const hit = list.find((p) => p && p.start <= date && date <= p.end);
    if (hit && valid(hit)) return { lat: +hit.lat, lng: +hit.lng, name: hit.name || "" };
    if (!hit && valid(td.lodgingPoint)) return { lat: +td.lodgingPoint.lat, lng: +td.lodgingPoint.lng };
    // Estimate: the city centre of a one-city trip, else the middle of the places of that hotel's nights.
    if (!hit && valid(td.cityPoint)) return { lat: +td.cityPoint.lat, lng: +td.cityPoint.lng, estimate: true };
    const near = (trip.stops || []).filter((x) => valid(x) && (!hit || (hit.start <= x.date && x.date <= hit.end)));
    const c = near.length
      ? {
          lat: near.reduce((a, x) => a + +x.lat, 0) / near.length,
          lng: near.reduce((a, x) => a + +x.lng, 0) / near.length,
        }
      : centerOf(trip);
    return c ? { lat: c.lat, lng: c.lng, estimate: true } : null;
  }
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const addDays = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  /* The flights the day frames are built from: landing, take-off home, and the outbound flight (for the flight day). */
  function flightsOf(trip) {
    const td = trip.travelDetails || {};
    const ok = (x) => x && ISO.test(x.date || "") && HHMM.test(x.time || "");
    const arrival = ok(td.arrival) ? { date: td.arrival.date, time: td.arrival.time } : {};
    const departure = ok(td.departure) ? { date: td.departure.date, time: td.departure.time } : {};
    const legs = Array.isArray(td.flights) ? td.flights : [];
    const out =
      arrival.date &&
      legs.find(
        (l) =>
          l && l.date && (l.arriveDate || l.date) === arrival.date && (!l.arriveTime || l.arriveTime === arrival.time),
      );
    const outbound = out && HHMM.test(out.departTime || "") ? { date: out.date, time: out.departTime } : {};
    return { arrival, departure, outbound };
  }
  /* What decides the fixed rows of a day (landing, flight day at home, flight home). Two trips with the same key for a
   * date have the same frame on it. */
  function frameKey(trip, date) {
    const { arrival, departure, outbound } = flightsOf(trip);
    const k = [];
    if (arrival.date && date < arrival.date)
      k.push(
        "pre",
        date === addDays(arrival.date, -1) ? "eve" : "",
        outbound.date === date ? outbound.time : "",
        arrival.time,
      );
    else if (arrival.date === date) k.push("arr", arrival.time);
    if (departure.date === date) k.push("dep", departure.time);
    else if (departure.date && date > departure.date) k.push("post");
    return k.join("|");
  }
  const commonTime = (trip, key, dflt) => {
    const n = new Map();
    for (const d of trip.dailySchedule || []) n.set(d[key], (n.get(d[key]) || 0) + 1);
    const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return HHMM.test(best || "") ? best : dflt;
  };
  /* A fresh day for `date` from the planner: only its fixed rows, meals and free time (no places). */
  function frameFor(trip, date, wake, sleep) {
    const { arrival, departure, outbound } = flightsOf(trip);
    const r = root.ItineraryEngine.plan({
      start: date,
      end: date,
      pace: "balanced",
      wake,
      sleep,
      attractions: [],
      city: trip.city,
      arrival,
      departure,
      outbound,
      cityCenter: centerOf(trip),
      home: homeFor(trip, date),
    });
    return r.dailySchedule[0];
  }
  const FLIGHT_ROW = /נחיתה|המראה|טיסה|שדה התעופה|עוד בבית/;
  const flightMarks = (d) =>
    JSON.stringify(
      (d?.blocks || [])
        .filter((b) => !b.placeName && FLIGHT_ROW.test(b.activity))
        .map((b) => [b.startTime, b.activity]),
    );
  /* The day's landing / flight rows are not the ones its flights give (flights changed since it was planned). */
  function frameStale(trip, day) {
    try {
      return flightMarks(frameFor(trip, day.date, day.wakeTime, day.sleepTime)) !== flightMarks(day);
    } catch {
      return false;
    }
  }
  /* The flights of a planned day changed (e.g. the flight home is earlier now): new fixed rows from the planner,
   * the traveller's places, meals and free time are kept and laid out again inside the new window. */
  function reframeDay(trip, day, wake, sleep) {
    const frame = frameFor(trip, day.date, wake, sleep);
    const f = L().split(frame),
      old = L().split(day);
    const roomy = f.middle.length > 0 || f.tail.some((b) => b._role === "slack");
    const here = (b) => {
      if (!b.placeName) return true;
      const st = stopForBlock(trip, b, day.date);
      return st ? st.date === day.date : !b.existingStopId; // a place moved to another day / deleted is not kept
    };
    const mid = old.middle.filter(here);
    const keep = mid.length ? mid : f.middle;
    if (!roomy && keep.some((b) => b.placeName))
      return {
        ok: false,
        date: day.date,
        message: `לפי הטיסות, ב${dayShort(day.date)} אין זמן לביקורים. העבר קודם את המקומות של היום הזה ליום אחר.`,
      };
    const strip = (x) => {
      const { _idx, _role, _dur, ...b } = x;
      return b;
    };
    const blocks = [...f.head, ...(roomy ? keep : []), ...f.tail].map(strip);
    return { ok: true, day: { ...frame, blocks } };
  }
  function stopForBlock(trip, block, date) {
    if (!block.placeName) return null;
    const byId = block.existingStopId && trip.stops.find((s) => s.id === block.existingStopId);
    if (byId) return byId;
    if (block.existingStopId) return null;
    return trip.stops.find((s) => s.date === date && norm(s.name) === norm(block.placeName)) || null;
  }
  function ctxFor(trip, date) {
    return {
      home: homeFor(trip, date),
      pointOf: (b) => {
        const st = stopForBlock(trip, b, date) || trip.stops.find((s) => norm(s.name) === norm(b.placeName));
        return st && valid(st) ? { lat: +st.lat, lng: +st.lng } : null;
      },
      openOf: (b) => L().openOf(b, trip.stops),
      maxLater: MAX_LATER,
    };
  }
  const visitItem = (st, extra = {}) => ({
    startTime: st.time,
    endTime: clock(toMin(st.time) + clampDur(st.duration)),
    activity: "ביקור: " + st.name,
    placeName: st.name,
    existingStopId: st.id,
    _role: "move",
    _dur: clampDur(st.duration),
    ...extra,
  });

  /* Rebuilds one day so it matches trip.stops.
   * opts.hints[stopId]: "auto" → best spot (least travel), "time" → at the stop's time; default for a new or
   * re-timed place is its time. opts.order(date, items) may reorder the middle items (drag & drop).
   * Returns { ok, changed, day, moved:[{id,name,date,time}], warnings } or { ok:false, message }. */
  function syncDay(trip, day, opts = {}) {
    const hints = opts.hints || {};
    const { middle } = L().split(day);
    const seen = new Set();
    let changed = Boolean(opts.force && opts.force.includes(day.date));
    const items = [];
    for (const it of middle) {
      if (!it.placeName) {
        items.push({ ...it, _start: toMin(it.startTime) });
        continue;
      }
      const st = stopForBlock(trip, it, day.date);
      if (!st) {
        if (it.existingStopId)
          changed = true; // the place was deleted
        else items.push({ ...it, _start: toMin(it.startTime) }); // a place of the plan without its own stop
        continue;
      }
      if (st.date !== day.date || seen.has(st.id)) {
        changed = true; // moved to another day / listed twice
        continue;
      }
      seen.add(st.id);
      const next = { ...it, existingStopId: st.id, _start: toMin(it.startTime) };
      if (norm(st.name) !== norm(it.placeName)) {
        next.placeName = st.name;
        next.activity = "ביקור: " + st.name;
        changed = true;
      }
      const d = clampDur(st.duration);
      if (d !== it._dur) {
        next._dur = d;
        changed = true;
      }
      if (hints[st.id] === "auto") {
        next._auto = true;
        changed = true;
      } else if (hints[st.id] === "time" || (st.time !== it.startTime && hints[st.id] !== "keep")) {
        next._want = toMin(st.time);
        changed = true;
      }
      if (hints[st.id]) next._pin = true;
      items.push(next);
    }
    for (const st of trip.stops) {
      if (st.date !== day.date || seen.has(st.id)) continue;
      seen.add(st.id);
      changed = true;
      const extra = hints[st.id] === "auto" ? { _auto: true, _pin: true } : { _want: toMin(st.time), _pin: true };
      // A visit moved from another day keeps its label (e.g. "ביקור: העין של לונדון").
      const label = opts.labels?.get(st.id);
      if (label && norm(label.placeName) === norm(st.name)) extra.activity = label.activity;
      items.push(visitItem(st, extra));
    }
    if (!changed) return { ok: true, changed: false, day };
    const ctx = ctxFor(trip, day.date);
    if (opts.auto?.includes(day.date)) ctx.squeeze = 45; // nobody chose this change: shorten visits rather than fail
    let order = items.filter((x) => x._want == null && !x._auto);
    for (const x of items.filter((x) => x._want != null).sort((a, b) => a._want - b._want)) {
      // Before the first item that is still mostly ahead at that time (its middle is later).
      const k = order.findIndex((y) => (y._want ?? y._start + (y._dur || 0) / 2) > x._want);
      order.splice(k < 0 ? order.length : k, 0, x);
    }
    for (const x of items.filter((x) => x._auto)) order = L().bestInsert(day, order, x, ctx);
    if (opts.order) order = opts.order(day.date, order) || order;
    const res = L().layout(day, order, ctx);
    if (!res.ok) return { ok: false, date: day.date, message: res.message };
    const moved = [];
    for (const x of items)
      if (x._want != null || x._auto || x._pin) {
        const b = res.day.blocks.find((b) => b.existingStopId && b.existingStopId === x.existingStopId);
        if (b)
          moved.push({
            id: x.existingStopId,
            name: b.activity.replace(/^ביקור:\s*/, ""),
            date: day.date,
            time: b.startTime,
          });
      }
    return { ok: true, changed: true, day: res.day, moved, warnings: res.warnings || [] };
  }

  /* The trip's dates changed after planning: plan days outside the trip go, new dates get a simple day
   * (meals and free time, landing / flight home if they fall on it) that places can be added to. */
  function fitDates(trip) {
    if (!Array.isArray(trip.dailySchedule) || !trip.dailySchedule.length) return [];
    let dates;
    try {
      dates = root.TripModel.dates(trip.start, trip.end);
    } catch {
      return [];
    }
    const have = new Map(trip.dailySchedule.map((d) => [d.date, d]));
    if (dates.length === trip.dailySchedule.length && dates.every((d) => have.has(d))) return [];
    if (dates.length > 14) {
      // An hour-by-hour plan covers up to 14 days (the app's own limit); the places stay on their days.
      trip.dailySchedule = [];
      trip.scheduleStopSnapshot = "";
      trip._planCleared = true;
      return [];
    }
    const wake = commonTime(trip, "wakeTime", "08:00"),
      sleep = commonTime(trip, "sleepTime", "23:00");
    const added = [];
    trip.dailySchedule = dates.map((date) => {
      if (have.has(date)) return have.get(date);
      added.push(date);
      return frameFor(trip, date, wake, sleep);
    });
    return added;
  }

  /* Re-times every day that no longer matches its places, then copies the final times back to the places.
   * Pure: returns a new trip. */
  function reflow(tripIn, opts = {}) {
    const trip = structuredClone(tripIn);
    const added = fitDates(trip);
    const cleared = Boolean(trip._planCleared);
    delete trip._planCleared;
    if (!Array.isArray(trip.dailySchedule) || !trip.dailySchedule.length)
      return { ok: true, trip, changed: [], moved: [], warnings: [], cleared };
    const changed = [...added],
      moved = [],
      warnings = [];
    // New days before the landing / after the flight home (the dates were stretched, the flights were not).
    const homeDays = (kind) => added.filter((d) => frameKey(trip, d).startsWith(kind)).map((d) => dayShort(d));
    const after = homeDays("post"),
      ahead = homeDays("pre");
    if (after.length)
      warnings.push(
        `לפי הטיסה הביתה, ${after.join(", ")} אחרי החזרה — בלי ביקורים. אם הטיסה השתנתה, כתוב בצ'אט את השעה החדשה.`,
      );
    if (ahead.length)
      warnings.push(`לפי הנחיתה, ${ahead.join(", ")} לפני ההגעה ליעד. אם הטיסה השתנתה, כתוב בצ'אט את השעה החדשה.`);
    // Days whose flights changed get new fixed rows first (opts.reframe = dates).
    if (opts.reframe?.length) {
      const wake = commonTime(trip, "wakeTime", "08:00"),
        sleep = commonTime(trip, "sleepTime", "23:00");
      for (let i = 0; i < trip.dailySchedule.length; i++) {
        const d = trip.dailySchedule[i];
        if (!opts.reframe.includes(d.date) || added.includes(d.date)) continue;
        const r = reframeDay(trip, d, wake, sleep);
        if (!r.ok) {
          // The "update the plan" button keeps such a day as it is and says why; a flight change is refused.
          if (opts.refresh) {
            warnings.push(r.message);
            continue;
          }
          return r;
        }
        trip.dailySchedule[i] = r.day;
        if (!changed.includes(d.date)) changed.push(d.date);
      }
      opts = { ...opts, force: [...new Set([...(opts.force || []), ...opts.reframe])] };
    }
    const labels = new Map();
    for (const d of trip.dailySchedule)
      for (const b of d.blocks || [])
        if (b.placeName && b.existingStopId)
          labels.set(b.existingStopId, { activity: b.activity, placeName: b.placeName });
    for (let i = 0; i < trip.dailySchedule.length; i++) {
      const day = trip.dailySchedule[i];
      const r = syncDay(trip, day, { ...opts, labels });
      if (!r.ok)
        return {
          ok: false,
          date: r.date,
          message: String(r.message).replace(/^אין מספיק זמן ביום/, "אין מספיק זמן ב" + dayShort(r.date)),
        };
      if (!r.changed) continue;
      trip.dailySchedule[i] = r.day;
      if (!changed.includes(day.date)) changed.push(day.date);
      moved.push(...r.moved);
      warnings.push(...r.warnings);
    }
    // Places follow the plan: day, start time and length come from their row.
    for (const day of trip.dailySchedule)
      for (const b of day.blocks) {
        if (!b.placeName || !b.existingStopId) continue;
        const st = trip.stops.find((s) => s.id === b.existingStopId);
        if (!st) continue;
        st.date = day.date;
        st.time = b.startTime;
        st.duration = toMin(b.endTime) - toMin(b.startTime);
      }
    // Places on a day the plan does not cover (e.g. dates outside it) are left as they are.
    trip.scheduleStopSnapshot = JSON.stringify(trip.stops);
    return { ok: true, trip, changed, moved, warnings };
  }

  /* Re-times one day with an explicit new order (drag & drop / the "earlier / later" buttons). */
  function reorderDay(tripIn, date, fromIdx, toBeforeIdx) {
    const trip = structuredClone(tripIn);
    const day = trip.dailySchedule.find((d) => d.date === date);
    if (!day) return { ok: false, message: "ליום הזה אין לוח" };
    const target = day.blocks[fromIdx];
    if (!target) return { ok: false, message: "השורה לא נמצאה" };
    const stop = stopForBlock(trip, target, date);
    return reflow(trip, {
      force: [date],
      hints: stop ? { [stop.id]: "keep" } : {},
      order: (d, order) => {
        if (d !== date) return order;
        const i = order.findIndex((x) => x._idx === fromIdx);
        if (i < 0) return order;
        const [item] = order.splice(i, 1);
        item._pin = true;
        const j =
          toBeforeIdx === null || toBeforeIdx === undefined ? -1 : order.findIndex((x) => x._idx === toBeforeIdx);
        order.splice(j < 0 ? order.length : j, 0, item);
        return order;
      },
    });
  }

  const findDay = (trip, date) => (trip.dailySchedule || []).find((d) => d.date === date);

  /* A meal / free-time row edited by hand: new text, start and length; it moves to that time and the day is re-timed. */
  function retimeItem(tripIn, date, idx, { activity, start, dur } = {}) {
    const trip = structuredClone(tripIn);
    const day = findDay(trip, date);
    const b = day?.blocks[idx];
    if (!b) return { ok: false, message: "השורה לא נמצאה" };
    if (activity) b.activity = activity;
    const s = Number.isFinite(start) ? start : toMin(b.startTime);
    const d = Number.isFinite(dur) ? Math.max(5, Math.round(dur)) : toMin(b.endTime) - toMin(b.startTime);
    return reflow(trip, {
      force: [date],
      order: (dd, order) => {
        if (dd !== date) return order;
        const i = order.findIndex((x) => x._idx === idx);
        if (i < 0) return order;
        const [item] = order.splice(i, 1);
        Object.assign(item, { _pin: true, _dur: d, activity: b.activity });
        const k = order.findIndex((x) => (x._want ?? x._start + (x._dur || 0) / 2) > s);
        order.splice(k < 0 ? order.length : k, 0, item);
        return order;
      },
    });
  }

  /* A fixed row (wake-up and breakfast, check-in…) got new times: the rows before/after it in the morning stay
   * back to back, and the rest of the day is re-timed from there. */
  function editFixed(tripIn, date, idx, s, e) {
    const trip = structuredClone(tripIn);
    const day = findDay(trip, date);
    const b = day?.blocks[idx];
    if (!b || !(e > s)) return { ok: false, message: "בדוק את שעות ההתחלה והסיום." };
    const head = L()
      .split(day)
      .head.map((h) => h._idx);
    const pos = head.indexOf(idx);
    b.startTime = clock(s);
    b.endTime = clock(e);
    if (pos >= 0) {
      if (pos === 0) day.wakeTime = clock(s);
      else {
        const prev = day.blocks[head[pos - 1]];
        if (toMin(prev.startTime) >= s) return { ok: false, message: "השעה מוקדמת מדי — היא חופפת לשורה שלפניה." };
        prev.endTime = clock(s);
      }
      let t = e;
      for (const j of head.slice(pos + 1)) {
        const x = day.blocks[j],
          len = toMin(x.endTime) - toMin(x.startTime);
        x.startTime = clock(t);
        x.endTime = clock(t + len);
        t += len;
      }
    }
    return reflow(trip, { force: [date] });
  }

  /* New wake-up / bedtime for one day. On a landing day the morning follows the flight, so only the
   * "wake up" row after the night's sleep moves. */
  function setDayTimes(tripIn, date, wake, sleep) {
    const trip = structuredClone(tripIn);
    const day = findDay(trip, date);
    if (!day) return { ok: false, message: "ליום הזה אין לוח" };
    if (!(sleep > wake)) return { ok: false, message: "שעת השינה חייבת להיות אחרי שעת הקימה." };
    const head = L()
      .split(day)
      .head.map((h) => h._idx);
    const wi = head.find((j) => /^קימה/.test(day.blocks[j].activity));
    const current = wi === undefined ? toMin(day.wakeTime) : toMin(day.blocks[wi].startTime);
    const delta = wake - current;
    if (delta) {
      if (wi === undefined)
        return { ok: false, message: "ביום הזה היום מתחיל בטיסה, ולכן שעת ההתחלה נקבעת לפי הנחיתה." };
      const pos = head.indexOf(wi);
      if (pos === 0) day.wakeTime = clock(wake);
      else {
        const prev = day.blocks[head[pos - 1]];
        if (toMin(prev.startTime) >= wake) return { ok: false, message: "שעת הקימה מוקדמת מדי ביום הזה." };
        prev.endTime = clock(wake);
      }
      for (const j of head.slice(pos)) {
        const x = day.blocks[j];
        x.startTime = clock(toMin(x.startTime) + delta);
        x.endTime = clock(toMin(x.endTime) + delta);
      }
    }
    // The evening rest is recomputed up to the new bedtime; fixed rows (e.g. the flight home) keep their times.
    day.sleepTime = clock(sleep);
    return reflow(trip, { force: [date] });
  }

  /* ---------- In the app: coordinates for new places, validation, saving ---------- */
  const km = (a, b) => {
    const r = Math.PI / 180,
      x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r),
      y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  };
  const geoCache = new Map(); // query → point | null, for this session (a miss is not asked again)
  async function photon(query, near) {
    const key = query + "|" + (near ? `${(+near.lat).toFixed(2)},${(+near.lng).toFixed(2)}` : "");
    if (geoCache.has(key)) return geoCache.get(key);
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
    let out = null;
    try {
      const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}${bias}`, {
        signal: AbortSignal.timeout(6000),
      });
      const c = (await res.json())?.features?.[0]?.geometry?.coordinates;
      out = c ? { lat: c[1], lng: c[0] } : null;
    } catch {
      return null; // network trouble: try again next time
    }
    geoCache.set(key, out);
    return out;
  }
  function centerOf(trip) {
    const td = trip.travelDetails || {};
    if (valid(td.cityPoint)) return { lat: +td.cityPoint.lat, lng: +td.cityPoint.lng };
    const pts = trip.stops.filter(valid);
    if (pts.length)
      return {
        lat: pts.reduce((s, p) => s + +p.lat, 0) / pts.length,
        lng: pts.reduce((s, p) => s + +p.lng, 0) / pts.length,
      };
    return valid(td.lodgingPoint) ? { lat: +td.lodgingPoint.lat, lng: +td.lodgingPoint.lng } : null;
  }
  /* Finds coordinates for places (and hotels) that have none, so their walking/transit time can be computed.
   * Mutates `trip`. Never throws; places that are not found keep a time estimate. */
  async function ensureCoords(trip, dates) {
    if (typeof fetch !== "function") return 0;
    let found = 0;
    try {
      let center = centerOf(trip);
      if (!center && trip.city) center = await photon(trip.city, null).catch(() => null);
      const want = trip.stops.filter((s) => !valid(s) && (!dates || dates.includes(s.date))).slice(0, 10);
      await Promise.all(
        want.map(async (s) => {
          const p = await photon(`${s.name} ${trip.city || ""}`.trim(), center).catch(() => null);
          if (p && (!center || km(center, p) <= 60)) {
            s.lat = p.lat;
            s.lng = p.lng;
            found++;
          }
        }),
      );
      const td = (trip.travelDetails = trip.travelDetails || {});
      const several = Array.isArray(td.hotels) && td.hotels.filter((h) => h && h.name).length > 1;
      // No hotel point yet (e.g. an older plan): look the hotel up, so days start and end there.
      if (!valid(td.lodgingPoint) && trip.hotel && !several) {
        const p = await photon(`${trip.hotel}, ${trip.city || ""}`, center).catch(() => null);
        if (p && (!center || km(center, p) <= 80)) td.lodgingPoint = { name: trip.hotel, lat: p.lat, lng: p.lng };
      }
      // The hotel was changed after planning: start and end the days at the new one.
      if (
        trip.hotel &&
        valid(td.lodgingPoint) &&
        norm(td.lodgingPoint.name || "") !== norm(trip.hotel) &&
        !(Array.isArray(td.hotels) && td.hotels.length > 1)
      ) {
        const p = await photon(`${trip.hotel}, ${trip.city || ""}`, center).catch(() => null);
        if (p && (!center || km(center, p) <= 80)) td.lodgingPoint = { name: trip.hotel, lat: p.lat, lng: p.lng };
        else delete td.lodgingPoint; // the old hotel's point is wrong now; estimate until the new one is found
      }
      // Several hotels in one trip: one point per hotel, so each night starts and ends at the right place.
      const hotels = (Array.isArray(td.hotels) ? td.hotels : []).filter((h) => h && h.name && h.checkIn);
      if (hotels.length > 1 && !(Array.isArray(td.lodgingPoints) && td.lodgingPoints.length)) {
        const sorted = hotels.slice().sort((a, b) => String(a.checkIn).localeCompare(String(b.checkIn)));
        // The hotel that is already on the map keeps its point; the others are looked up.
        const known = valid(td.lodgingPoint) ? td.lodgingPoint : null;
        const points = await Promise.all(
          sorted.map((h) =>
            known && norm(known.name || "") === norm(h.name)
              ? { lat: +known.lat, lng: +known.lng }
              : photon(`${h.name}, ${h.city || trip.city || ""}`, center).catch(() => null),
          ),
        );
        td.lodgingPoints = sorted.map((h, i) => {
          const next = sorted[i + 1];
          const end = next
            ? new Date(Date.parse(next.checkIn + "T12:00:00Z") - 86400000).toISOString().slice(0, 10)
            : trip.end;
          const p = points[i] && (!center || km(center, points[i]) <= 80) ? points[i] : null;
          return { name: h.name, start: i === 0 ? trip.start : h.checkIn, end, ...(p || {}) };
        });
      } else if (Array.isArray(td.lodgingPoints) && td.lodgingPoints.some((p) => p && p.name && !valid(p))) {
        // A hotel that was not found last time (offline, odd name): try again.
        td.lodgingPoints = await Promise.all(
          td.lodgingPoints.map(async (p) => {
            if (!p || !p.name || valid(p)) return p;
            const q = await photon(`${p.name}, ${trip.city || ""}`, center).catch(() => null);
            return q && (!center || km(center, q) <= 80) ? { ...p, lat: q.lat, lng: q.lng } : p;
          }),
        );
      }
    } catch {
      /* coordinates are optional */
    }
    return found;
  }
  const KEYS = [
    "city",
    "start",
    "end",
    "people",
    "participants",
    "currency",
    "budgetPerPerson",
    "hotel",
    "travelDetails",
    "travelType",
    "activityTypes",
    "stops",
    "expenses",
    "dailySchedule",
    "scheduleStopSnapshot",
  ];
  const fingerprint = (t) => JSON.stringify(KEYS.map((k) => t[k]));
  function validate(trip) {
    if (trip.dailySchedule?.length) trip.dailySchedule = TP().validateSchedule(trip, trip.dailySchedule);
    TP().apply(trip, []); // the app's own checks: dates in range, no overlapping visits, flight margins
  }
  const STALE_ROW = "הלוח השתנה בינתיים (אולי ממכשיר אחר). פתח את השורה שוב ונסה שוב.";
  /* Builds the changed trip without saving it: mutate(draft) changes places, then the plan is re-timed.
   * opts.before: the trip as it was before a change already made to `trip` (trip details / hotels editors) —
   *   days whose flights or hotel changed get new fixed rows / legs.
   * opts.expect: { date, idx, block } — the row an editor was opened on; refused if that row changed meanwhile.
   * Returns { ok, trip, changed, moved, warnings, base } or { ok:false, message }. */
  async function prepare(trip, mutate, opts = {}) {
    // The version this change is made on. A cloud sync while we wait (coordinates lookup) is caught by apply().
    const base = fingerprint(trip);
    const before = opts.before || trip;
    const draft = structuredClone(trip);
    if (opts.expect) {
      const { date, idx, block } = opts.expect;
      const cur = findDay(draft, date)?.blocks?.[idx];
      if (!cur || cur.activity !== block.activity || cur.startTime !== block.startTime || cur.endTime !== block.endTime)
        return { ok: false, message: STALE_ROW };
    }
    try {
      if (mutate) await mutate(draft);
    } catch (e) {
      return { ok: false, message: e.message || "השינוי לא תקין" };
    }
    const dates = [...new Set(draft.stops.map((s) => s.date))];
    await ensureCoords(draft, opts.allDates ? null : dates);
    // Flights or hotels changed (here or in `before`): those days get new fixed rows / legs from the right hotel.
    // opts.refresh ("update the plan" button): every day is re-timed, and days whose flight rows are out of date
    // are rebuilt.
    let ro = opts;
    if (!opts.transform && !opts.reorder && draft.dailySchedule?.length) {
      const planned = draft.dailySchedule.map((d) => d.date);
      const homeKey = (t, d) => {
        const h = homeFor(t, d);
        return !h || h.estimate ? "~" : `${(+h.lat).toFixed(5)},${(+h.lng).toFixed(5)}`;
      };
      const reframe = opts.refresh
        ? draft.dailySchedule.filter((d) => frameStale(draft, d)).map((d) => d.date)
        : planned.filter((d) => frameKey(before, d) !== frameKey(draft, d));
      const homes = opts.refresh ? planned : planned.filter((d) => homeKey(before, d) !== homeKey(draft, d));
      if (reframe.length || homes.length)
        ro = {
          ...opts,
          reframe: [...new Set([...(opts.reframe || []), ...reframe])],
          force: [...new Set([...(opts.force || []), ...homes])],
          auto: [...new Set([...reframe, ...homes])],
        };
    }
    const r = opts.transform
      ? opts.transform(draft)
      : opts.reorder
        ? reorderDay(draft, ...opts.reorder)
        : reflow(draft, ro);
    if (!r.ok) return r;
    try {
      validate(r.trip);
    } catch (e) {
      return { ok: false, message: e.message || "השינוי לא עבר את בדיקת הלוח" };
    }
    return { ...r, base };
  }
  /* Saves a prepared change into the live trip (the trip object may have been replaced by a cloud sync meanwhile). */
  function apply(trip, prepared) {
    // `state` and `save` are the app's globals (app.js / cloud.js).
    const trips = typeof state !== "undefined" && Array.isArray(state.trips) ? state.trips : [];
    const live = trips.find((t) => t.id === trip.id) || trip;
    if (prepared.base && fingerprint(live) !== prepared.base)
      return { ok: false, conflict: true, message: "הטיול השתנה בינתיים (אולי ממכשיר אחר). נסה שוב." };
    const before = structuredClone(live);
    for (const k of KEYS) if (k in prepared.trip) live[k] = prepared.trip[k];
    try {
      save();
    } catch {
      for (const k of KEYS) live[k] = before[k];
      return { ok: false, message: "השמירה נכשלה" };
    }
    return { ...prepared, ok: true, trip: live };
  }
  const liveOf = (trip) =>
    (typeof state !== "undefined" && Array.isArray(state.trips) && state.trips.find((t) => t.id === trip.id)) || trip;
  /* prepare + apply. If the trip changed while the change was being prepared (a cloud sync), it is prepared once more
   * on the new version — so the other device's change is kept and this one is not lost. */
  async function commit(trip, mutate, opts = {}) {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = await prepare(attempt ? liveOf(trip) : trip, mutate, opts);
      if (!p.ok) return p;
      r = apply(trip, p);
      if (r.ok || !r.conflict) return r;
    }
    return r;
  }
  const dayShort = (iso) =>
    new Intl.DateTimeFormat("he-IL", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }).format(
      new Date(iso + "T12:00:00Z"),
    );
  /* One short line for the toast: "London Eye עבר ל-ד׳, 20.11 בשעה 10:15 · זמני הדרך עודכנו". */
  function summary(result, fallback = "הלוח עודכן") {
    if (result.cleared) return "לוח שעות מפורט אפשר עד 14 ימים, ולכן הלוח השעתי הוסר. המקומות נשארו בימים שלהם.";
    const m = (result.moved || [])[0];
    const parts = [m ? `${m.name} ${m.date ? "ב" + dayShort(m.date) + " " : ""}בשעה ${m.time}` : fallback];
    if (result.changed?.length) parts.push("זמני ההליכה והנסיעה עודכנו");
    if (result.warnings?.length) parts.push(result.warnings[0]);
    return parts.join(" · ");
  }

  root.TriplyReflow = {
    syncDay,
    reflow,
    fitDates,
    reorderDay,
    retimeItem,
    editFixed,
    setDayTimes,
    ensureCoords,
    prepare,
    apply,
    commit,
    summary,
    homeFor,
    frameKey,
    frameStale,
    dayShort,
    stopForBlock,
  };
  if (typeof module !== "undefined") module.exports = root.TriplyReflow;
})(globalThis);
