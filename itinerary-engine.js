/* Triply itinerary engine.
 * The AI only chooses WHAT to visit (a pool of attractions with coordinates,
 * durations and opening hours). This deterministic engine decides WHEN:
 * it groups places by area per day, orders them, estimates walking/transit
 * time, inserts breakfast/lunch/dinner and fills every day from wake-up to
 * sleep with no empty gaps. Pure functions, no DOM, testable in Node. */
(function (root) {
  "use strict";

  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const toMin = (v) => {
    const m = String(v ?? "").trim().match(HHMM);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const pad = (n) => String(n).padStart(2, "0");
  const clock = (m) => {
    const v = Math.max(0, Math.min(1439, Math.round(m)));
    return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
  };
  const up5 = (m) => Math.ceil(m / 5) * 5;
  const round15 = (m) => Math.round(m / 15) * 15;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const norm = (v) =>
    String(v || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[’'`׳"״]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const validPoint = (p) =>
    p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0);

  function km(a, b) {
    if (!validPoint(a) || !validPoint(b)) return NaN;
    const r = Math.PI / 180,
      dLat = (b.lat - a.lat) * r,
      dLng = (b.lng - a.lng) * r;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Door-to-door estimate: walking up to ~1.8 km of street distance,
   * otherwise public transport (waiting + average urban speed). */
  function travel(a, b) {
    const d = km(a, b);
    if (!Number.isFinite(d)) return { min: 25, mode: "transit", km: null };
    if (d < 0.08) return { min: 0, mode: "walk", km: d };
    const street = d * 1.3;
    if (street <= 1.8)
      return { min: Math.max(5, up5((street / 4.5) * 60)), mode: "walk", km: street };
    return {
      min: Math.min(100, up5(12 + (street / 17) * 60)),
      mode: "transit",
      km: street,
    };
  }

  const PACE = {
    relaxed: { durMul: 1.15, rest: true, maxRest: 80 },
    balanced: { durMul: 1, rest: false, maxRest: 75 },
    busy: { durMul: 0.9, rest: false, maxRest: 60 },
  };

  function dates(start, end) {
    const a = Date.parse(start + "T00:00:00Z"),
      b = Date.parse(end + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
      throw Error("טווח התאריכים של הטיול אינו תקין");
    const out = [];
    for (let t = a; t <= b; t += 86400000)
      out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 14)
      throw Error("תכנון מלא זמין כרגע לטיול של עד 14 ימים");
    return out;
  }
  const weekday = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();

  function normalizeItem(x, rank, pace) {
    if (!x || typeof x !== "object") return null;
    const name = String(x.name || "").trim().slice(0, 160);
    if (!name) return null;
    const lat = Number(x.lat),
      lng = Number(x.lng);
    let dur = Number(x.durationMin ?? x.duration);
    if (!Number.isFinite(dur)) dur = 90;
    dur = clamp(round15(dur * pace.durMul), 30, 300);
    let openFrom = toMin(x.openFrom),
      openTo = toMin(x.openTo);
    if (openTo !== null && openTo === 0) openTo = null; // closes at midnight
    if (openFrom !== null && openTo !== null && openTo <= openFrom) openTo = null;
    if (openFrom !== null && openTo !== null && openTo - openFrom < dur)
      dur = Math.max(30, round15(openTo - openFrom));
    const best = ["morning", "afternoon", "evening", "any"].includes(x.bestTime)
      ? x.bestTime
      : "any";
    return {
      key: norm(name),
      name,
      nameHe: String(x.nameHe || "").trim().slice(0, 160),
      lat: Number.isFinite(lat) ? lat : NaN,
      lng: Number.isFinite(lng) ? lng : NaN,
      area: String(x.area || "").trim().slice(0, 60),
      dur,
      baseDur: dur,
      openFrom,
      openTo,
      closedDays: Array.isArray(x.closedDays)
        ? x.closedDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : [],
      bestTime: best,
      flexible: x.flexible === true || /park|market|neighborhood|walk|shopping|viewpoint/.test(String(x.category || "")),
      mustSee: x.mustSee === true,
      rank: Number.isFinite(Number(x.rank)) ? Number(x.rank) : rank,
      why: String(x.why || "").trim().slice(0, 300),
      category: String(x.category || "").slice(0, 30),
      existingStopId: String(x.existingStopId || ""),
      approx: x.approx === true,
    };
  }

  function dedupe(items) {
    const out = [];
    for (const item of items) {
      const dup = out.find(
        (o) =>
          o.key === item.key ||
          (o.key.length > 4 && item.key.length > 4 && (o.key.includes(item.key) || item.key.includes(o.key)) && (!Number.isFinite(km(o, item)) || km(o, item) < 0.5)),
      );
      if (!dup) out.push(item);
      else {
        dup.mustSee = dup.mustSee || item.mustSee;
        if (!dup.existingStopId && item.existingStopId) dup.existingStopId = item.existingStopId;
        if (!validPoint(dup) && validPoint(item)) Object.assign(dup, { lat: item.lat, lng: item.lng });
      }
    }
    return out;
  }

  function centroid(points, fallback) {
    const valid = points.filter(validPoint);
    if (!valid.length) return fallback;
    return {
      lat: valid.reduce((s, p) => s + p.lat, 0) / valid.length,
      lng: valid.reduce((s, p) => s + p.lng, 0) / valid.length,
    };
  }

  /* ---------- Day frames (routine before/after the activity window) ---------- */
  function buildDayFrames(input, list, pace) {
    const wakePref = toMin(input.wake) ?? 480;
    let sleepPref = toMin(input.sleep) ?? 1380;
    if (sleepPref <= wakePref + 300) sleepPref = Math.min(1439, wakePref + 15 * 60);
    const arrival = input.arrival || {},
      departure = input.departure || {};
    const arrMin = toMin(arrival.time),
      depMin = toMin(departure.time);
    return list.map((date, index) => {
      const f = {
        date,
        index,
        weekday: weekday(date),
        wake: wakePref,
        sleep: sleepPref,
        pre: [],
        start: null,
        windowEnd: null,
        minRest: 30,
        maxRest: pace.maxRest,
        endLabel: "מנוחה, מקלחת והתארגנות לשינה",
        post: [],
        lunchDone: false,
        dinnerDone: false,
        kind: "full",
      };
      const isArrival = arrival.date === date && arrMin !== null;
      const isDeparture = departure.date === date && depMin !== null;
      // Default morning.
      let cursor = f.wake;
      if (isArrival) {
        f.kind = "arrival";
        const a = arrMin;
        // The day in the destination starts at landing.
        f.wake = a;
        const landed = Math.min(1439, a + 90),
          checkedIn = Math.min(1439, a + 120);
        f.pre.push([a, landed, "נחיתה, ביקורת גבולות ונסיעה ללינה", ""]);
        cursor = checkedIn;
        if (a + 120 >= f.sleep - 90 || a + 120 > 1320) {
          // Late landing: the day is only arriving and resting.
          f.wake = Math.min(a, 1410);
          const land2 = Math.min(f.wake + 90, 1425);
          f.pre = [[f.wake, land2, "נחיתה, ביקורת גבולות ונסיעה ללינה", ""]];
          f.sleep = Math.max(f.sleep, Math.min(1439, land2 + 30));
          f.pre.push([land2, f.sleep, "צ'ק-אין, התארגנות ומנוחה אחרי הטיסה", ""]);
          f.start = null;
          return f;
        }
        f.pre.push([landed, checkedIn, "צ'ק-אין / הנחת מזוודות והתארגנות", ""]);
        if (cursor < 600) {
          f.pre.push([cursor, cursor + 45, "ארוחת בוקר", ""]);
          cursor += 45;
        }
        if (cursor >= 14 * 60 + 30) f.lunchDone = true;
      } else {
        f.pre.push([f.wake, f.wake + 60, "קימה, התארגנות וארוחת בוקר", ""]);
        cursor = f.wake + 60;
      }
      f.start = cursor;
      f.windowEnd = f.sleep;
      if (isDeparture) {
        f.kind = f.kind === "arrival" ? "arrival-departure" : "departure";
        const d = depMin;
        const toAirport = d - 180,
          leave = toAirport - 60,
          pickup = leave - 20;
        // Very early flight: wake up just for packing.
        if (pickup - 45 < f.wake || pickup - cursor < 60) {
          const w = Math.max(0, Math.min(f.wake, pickup - 45));
          if (f.kind === "departure") {
            f.wake = w;
            f.pre = [[w, pickup, "קימה, אריזה וצ'ק-אאוט", ""]];
          }
          f.start = null;
        } else {
          if (f.kind === "departure") {
            f.pre.push([cursor, cursor + 20, "צ'ק-אאוט ואחסון מזוודות בלינה", ""]);
            f.start = cursor + 20;
          }
          f.windowEnd = pickup;
          f.minRest = 0;
          f.maxRest = 45;
          f.endLabel = "זמן התארגנות אחרון בלינה";
        }
        f.post.push([pickup, leave, "איסוף מזוודות מהלינה", ""]);
        f.post.push([leave, toAirport, "נסיעה לשדה התעופה", ""]);
        f.post.push([toAirport, d, "צ'ק-אין, ביקורת ביטחון והמתנה לטיסה", ""]);
        f.sleep = Math.min(1439, d + 30);
        f.post.push([d, f.sleep, "המראה – טיסה הביתה", ""]);
        if (f.start === null) f.windowEnd = pickup;
      }
      return f;
    });
  }

  function capacity(f) {
    if (f.start === null) return 0;
    let cap = f.windowEnd - f.minRest - f.start;
    if (!f.lunchDone && f.start < 13 * 60 && f.windowEnd > 14 * 60) cap -= 60;
    if (f.windowEnd - f.minRest >= 20 * 60 + 15 && f.start < 19 * 60) cap -= 75;
    return Math.max(0, cap);
  }

  /* ---------- Simulate one day for a fixed order ---------- */
  function simulate(f, order, home, pace) {
    const blocks = [];
    let t = f.start,
      pos = home,
      cost = 0,
      lunch = f.lunchDone,
      dinner = f.dinnerDone,
      rest = !pace.rest,
      hard = 0,
      travelTotal = 0;
    const areaOf = (p) => (p && p.area ? ` באזור ${p.area}` : "");
    const add = (s, e, label, place, item) => {
      if (e > s) blocks.push([s, e, label, place || "", item || null]);
    };
    const meals = (nextDur, nextTravel) => {
      if (!lunch && (t >= 12 * 60 + 15 || (t >= 11 * 60 + 30 && t + nextTravel + nextDur > 14 * 60 + 30))) {
        add(t, t + 60, `ארוחת צהריים${areaOf(pos)}`);
        t += 60;
        lunch = true;
      }
      if (!rest && lunch && t >= 15 * 60 + 30 && t < 17 * 60) {
        add(t, t + 40, `הפסקת קפה ומנוחה${areaOf(pos)}`);
        t += 40;
        rest = true;
      }
      if (!dinner && (t >= 18 * 60 + 45 || (t >= 18 * 60 && t + nextTravel + nextDur > 20 * 60 + 45))) {
        add(t, t + 75, `ארוחת ערב${areaOf(pos)}`);
        t += 75;
        dinner = true;
      }
    };
    for (const item of order) {
      const tr = travel(pos, item);
      meals(item.dur, tr.min);
      if (tr.min > 0) {
        add(t, t + tr.min, `${tr.mode === "walk" ? "הליכה" : "נסיעה בתחבורה ציבורית"}${item.filler ? "" : " אל " + (item.nameHe || item.name)} (~${tr.min} דק')`);
        t += tr.min;
        travelTotal += tr.min;
      }
      if (item.openFrom !== null && t < item.openFrom) {
        const wait = item.openFrom - t;
        add(t, item.openFrom, `הפסקת קפה ליד ${item.nameHe || item.name} עד הפתיחה`);
        cost += wait * 2 + Math.max(0, wait - 30) * 8;
        if (wait > 45) hard++;
        t = item.openFrom;
      }
      if (item.closedDays.includes(f.weekday)) (cost += 5000), hard++;
      let dur = item.dur;
      if (item.openTo !== null && t + dur > item.openTo) {
        // Shorten the visit to closing time if a meaningful visit is still possible.
        const possible = item.openTo - t;
        if (possible >= Math.max(30, Math.round(item.baseDur * 0.6))) dur = possible;
        else (cost += 1000 + (t + dur - item.openTo) * 20), hard++;
      }
      const end = t + dur;
      if (item.bestTime === "morning" && t > 13 * 60) cost += 40;
      if (item.bestTime === "afternoon" && t < 11 * 60) cost += 25;
      if (item.bestTime === "evening" && t < 17 * 60) cost += 60;
      if (item.bestTime !== "evening" && item.openTo === null && t >= 21 * 60) cost += 30;
      if (item.filler) add(t, end, item.label);
      else add(t, end, `ביקור: ${item.nameHe && item.nameHe !== item.name ? `${item.nameHe}` : item.name}`, item.name, item);
      t = end;
      pos = item;
    }
    // Close the day: lunch / dinner if their time has come.
    if (!lunch && t >= 12 * 60 && t <= 15 * 60 + 30) {
      add(t, t + 60, `ארוחת צהריים${areaOf(pos)}`);
      t += 60;
      lunch = true;
    }
    const home2 = travel(pos, home);
    if (!dinner && t >= 17 * 60 + 45 && t + 75 + home2.min <= f.windowEnd - f.minRest) {
      add(t, t + 75, `ארוחת ערב${areaOf(pos)}`);
      t += 75;
      dinner = true;
    }
    if (home2.min > 0 && order.length) {
      add(t, t + home2.min, `חזרה ללינה (${home2.mode === "walk" ? "הליכה" : "תחבורה ציבורית"} ~${home2.min} דק')`);
      t += home2.min;
      travelTotal += home2.min;
    }
    const needLunch = !f.lunchDone && f.start <= 12 * 60 + 30 && f.windowEnd >= 14 * 60 + 30;
    const needDinner = f.windowEnd - f.minRest >= 20 * 60 + 30 && f.start <= 18 * 60;
    let mealsOk = true;
    if (needLunch && !lunch) (mealsOk = false), (cost += 300);
    if (needDinner && !dinner) (mealsOk = false), (cost += 300);
    cost += travelTotal;
    const fits = t <= f.windowEnd - f.minRest && hard === 0;
    return { blocks, returnTime: t, cost, fits, mealsOk, travelTotal, order, hard };
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => {
      for (const rest of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x, ...rest]);
    });
    return out;
  }
  const better = (a, b) =>
    !b ||
    (a.fits && !b.fits) ||
    (a.fits === b.fits && (a.fits ? a.cost < b.cost : a.returnTime + a.cost / 10 < b.returnTime + b.cost / 10));

  function optimize(f, items, home, pace) {
    if (!items.length) return simulate(f, [], home, pace);
    let best = null;
    if (items.length <= 6) {
      for (const p of permutations(items)) {
        const s = simulate(f, p, home, pace);
        if (better(s, best)) best = s;
      }
      return best;
    }
    // Larger days: nearest neighbour by time-of-day group, then 2-opt.
    const group = (i) => (i.bestTime === "morning" ? 0 : i.bestTime === "evening" ? 3 : i.bestTime === "afternoon" ? 2 : 1);
    const left = items.slice();
    const order = [];
    let pos = home;
    while (left.length) {
      const g = Math.min(...left.map(group));
      let pick = null,
        pd = Infinity;
      for (const it of left)
        if (group(it) <= g + (g === 1 ? 1 : 0)) {
          const d = km(pos, it);
          const dd = Number.isFinite(d) ? d : 5;
          if (dd < pd) (pd = dd), (pick = it);
        }
      order.push(pick);
      left.splice(left.indexOf(pick), 1);
      pos = pick;
    }
    best = simulate(f, order, home, pace);
    let improved = true,
      guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      for (let i = 0; i < order.length - 1; i++)
        for (let j = i + 1; j < order.length; j++) {
          const cand = best.order.slice();
          const seg = cand.slice(i, j + 1).reverse();
          cand.splice(i, seg.length, ...seg);
          const s = simulate(f, cand, home, pace);
          if (better(s, best)) (best = s), (improved = true);
        }
    }
    return best;
  }

  /* Insert candidate at the best position of an existing order (cheap test). */
  function bestInsertion(f, order, cand, home, pace) {
    let best = null;
    for (let i = 0; i <= order.length; i++) {
      const o = order.slice();
      o.splice(i, 0, cand);
      const s = simulate(f, o, home, pace);
      if (better(s, best)) best = s;
    }
    return best;
  }

  function openOn(item, f) {
    return !item.closedDays.includes(f.weekday);
  }

  /* ---------- Main planner ---------- */
  function plan(input) {
    const pace = PACE[input.pace] || PACE.balanced;
    const list = dates(input.start, input.end);
    const frames = buildDayFrames(input, list, pace);
    const warnings = [];
    let items = dedupe(
      (Array.isArray(input.attractions) ? input.attractions : [])
        .map((x, i) => normalizeItem(x, i, pace))
        .filter(Boolean),
    );
    const center = validPoint(input.cityCenter) ? input.cityCenter : centroid(items, { lat: NaN, lng: NaN });
    // Items without coordinates: must-sees are kept near the center, others dropped.
    items = items.filter((i) => {
      if (validPoint(i)) return true;
      if (i.mustSee && validPoint(center)) {
        Object.assign(i, { lat: center.lat, lng: center.lng, approx: true });
        return true;
      }
      return false;
    });
    const home = validPoint(input.home) ? input.home : validPoint(center) ? center : centroid(items, { lat: 0, lng: 0 });
    const must = items.filter((i) => i.mustSee);
    const pool = items.filter((i) => !i.mustSee).sort((a, b) => a.rank - b.rank);
    const active = frames.filter((f) => capacity(f) >= 45);
    const sets = new Map(frames.map((f) => [f.date, []]));

    // 1) Distribute must-sees geographically across active days.
    const fullDays = active.filter((f) => f.kind === "full");
    const mustDays = fullDays.length ? fullDays : active;
    if (mustDays.length && must.length) {
      const k = Math.min(mustDays.length, must.length);
      const seeds = [must.reduce((a, b) => (km(home, b) > km(home, a) ? b : a))];
      while (seeds.length < k) {
        let far = null,
          fd = -1;
        for (const m of must) {
          if (seeds.includes(m)) continue;
          const d = Math.min(...seeds.map((s) => km(s, m)));
          if (d > fd) (fd = d), (far = m);
        }
        seeds.push(far);
      }
      let clusters = seeds.map((s) => ({ c: { lat: s.lat, lng: s.lng }, items: [] }));
      for (let iter = 0; iter < 6; iter++) {
        clusters.forEach((c) => (c.items = []));
        for (const m of must) {
          let bi = 0,
            bd = Infinity;
          clusters.forEach((c, i) => {
            const d = km(c.c, m);
            if (d < bd) (bd = d), (bi = i);
          });
          clusters[bi].items.push(m);
        }
        clusters.forEach((c) => (c.c = centroid(c.items, c.c)));
      }
      clusters = clusters.filter((c) => c.items.length).sort((a, b) => b.items.reduce((s, i) => s + i.dur, 0) - a.items.reduce((s, i) => s + i.dur, 0));
      const dayOrder = mustDays.slice().sort((a, b) => capacity(b) - capacity(a));
      const load = new Map(frames.map((f) => [f.date, 0]));
      clusters.forEach((cl, idx) => {
        const f = dayOrder[idx % dayOrder.length];
        for (const m of cl.items.sort((a, b) => b.dur - a.dur)) {
          // Prefer this cluster's day; move to the least-loaded open day if full or closed.
          let target = f;
          const fitsIn = (d) => openOn(m, d) && load.get(d.date) + m.dur + 30 <= capacity(d);
          if (!fitsIn(target)) {
            const alt = dayOrder
              .filter(fitsIn)
              .sort((a, b) => km(centroid(sets.get(a.date), home), m) - km(centroid(sets.get(b.date), home), m))[0];
            target = alt || dayOrder.filter((d) => openOn(m, d)).sort((a, b) => load.get(a.date) - capacity(a) - (load.get(b.date) - capacity(b)))[0] || f;
          }
          sets.get(target.date).push(m);
          load.set(target.date, load.get(target.date) + m.dur + 30);
        }
      });
    }

    // 2) Make sure every day's must-sees fit; move the ones that do not.
    const used = new Set(must);
    const results = new Map();
    const fillOrder = frames.filter((f) => f.start !== null);
    for (const f of fillOrder) {
      let set = sets.get(f.date);
      let best = optimize(f, set, home, pace);
      let guard = 0;
      while (!best.fits && set.length && guard++ < 12) {
        // Remove the must-see that causes the problem (closed day first, else the longest).
        const closed = set.find((i) => !openOn(i, f));
        const victim = closed || set.slice().sort((x, y) => y.dur - x.dur)[0];
        if (!closed && set.length === 1 && victim.dur < 300) break;
        set = set.filter((i) => i !== victim);
        victim.__overflow = true;
        best = optimize(f, set, home, pace);
      }
      sets.set(f.date, set);
      results.set(f.date, best);
    }
    for (const m of must.filter((x) => x.__overflow)) {
      delete m.__overflow;
      const options = fillOrder
        .filter((f) => openOn(m, f))
        .map((f) => ({ f, s: bestInsertion(f, results.get(f.date).order, m, home, pace) }))
        .filter((o) => o.s.fits)
        .sort((x, y) => x.s.returnTime - y.s.returnTime + (x.s.cost - y.s.cost) / 5);
      if (options.length) {
        const { f, s: res } = options[0];
        results.set(f.date, res);
        sets.set(f.date, res.order.slice());
      } else {
        // Last resort: shorten it so it fits somewhere.
        let placed = false;
        for (const f of fillOrder.filter((d) => openOn(m, d))) {
          const original = m.dur;
          while (!placed && m.dur > 45) {
            m.dur -= 15;
            const res = bestInsertion(f, results.get(f.date).order, m, home, pace);
            if (res.fits) {
              results.set(f.date, res);
              sets.set(f.date, res.order.slice());
              placed = true;
            }
          }
          if (placed) break;
          m.dur = original;
        }
        if (!placed) {
          used.delete(m);
          warnings.push(`לא נמצא מקום בלוח עבור ${m.nameHe || m.name} בלי לחרוג משעות השינה או שעות הפתיחה. אפשר להוסיף יום או לוותר על מקום אחר.`);
        } else warnings.push(`קיצרתי את הביקור ב${m.nameHe || m.name} כדי שייכנס ללוח.`);
      }
    }

    // 3) Fill days round-robin from the AI pool (one place per day per round, so
    //    no day is left empty when the pool is small), preferring nearby places.
    const underfilled = (f) => {
      const r = results.get(f.date);
      return r.fits && (f.windowEnd - r.returnTime > f.maxRest || !r.mealsOk);
    };
    // Seed empty full days with well-separated, highly ranked anchors.
    for (const f of fillOrder.filter((d) => d.kind === "full" && !sets.get(d.date).length)) {
      const taken = fillOrder.map((d) => sets.get(d.date)).filter((x) => x.length).map((x) => centroid(x, home));
      const options = pool
        .filter((c) => !used.has(c) && openOn(c, f) && c.bestTime !== "evening")
        .slice(0, 12)
        .map((c) => ({ c, score: c.rank * 0.4 - Math.min(6, taken.length ? Math.min(...taken.map((t) => km(t, c) || 0)) : 0) }))
        .sort((x, y) => x.score - y.score);
      for (const { c } of options) {
        const s = bestInsertion(f, results.get(f.date).order, c, home, pace);
        if (s.fits) {
          used.add(c);
          sets.set(f.date, s.order.slice());
          results.set(f.date, s);
          break;
        }
      }
    }
    for (let round = 0; round < 14; round++) {
      let changed = false;
      const dayOrder = fillOrder
        .filter(underfilled)
        .sort((x, y) => (y.windowEnd - results.get(y.date).returnTime) - (x.windowEnd - results.get(x.date).returnTime));
      for (const f of dayOrder) {
        const best = results.get(f.date);
        const set = sets.get(f.date);
        const anchor = set.length ? centroid(set, home) : home;
        const late = best.returnTime >= 17 * 60;
        const others = dayOrder.filter((o) => o !== f && sets.get(o.date).length).map((o) => centroid(sets.get(o.date), home));
        const candidates = pool
          .filter((c) => !used.has(c) && openOn(c, f))
          .map((c) => {
            const d = km(anchor, c);
            const own = Number.isFinite(d) ? d : 8;
            const elsewhere = others.length ? Math.min(...others.map((o) => km(o, c) || 99)) : 99;
            let score = own + c.rank * (set.length ? 0.2 : 0.6) + 0.8 * Math.max(0, own - elsewhere);
            if (late && c.bestTime === "evening") score -= 2;
            if (late && (c.openTo === null || c.openTo >= 21 * 60 + 30)) score -= 1.5;
            if (!late && c.openTo === null && c.bestTime !== "morning") score += 0.8;
            if (!late && c.bestTime === "evening" && !set.length) score += 3;
            if (f.kind !== "full") score += (km(home, c) || 0) * 0.5;
            return { c, score };
          })
          .sort((x, y) => x.score - y.score)
          .slice(0, 8);
        let pick = null;
        for (const { c } of candidates) {
          const s = bestInsertion(f, best.order, c, home, pace);
          if (s.fits) {
            pick = { c, s };
            break;
          }
        }
        if (!pick) continue;
        used.add(pick.c);
        const nextSet = [...set, pick.c];
        let next = nextSet.length <= 6 ? optimize(f, nextSet, home, pace) : pick.s;
        if (!next.fits) next = pick.s;
        sets.set(f.date, next.order.slice());
        results.set(f.date, next);
        changed = true;
      }
      if (!changed) break;
    }

    // 4) Absorb leftover evening time by lengthening visits (never leave a long empty block).
    for (const f of fillOrder) {
      let best = results.get(f.date);
      let guard = 0;
      while (best.fits && f.windowEnd - best.returnTime > f.maxRest && guard++ < 60) {
        const stretch = best.order
          .filter((i) => i.dur < i.baseDur * (i.flexible ? 1.6 : 1.3))
          .sort((a, b) => Number(b.flexible) - Number(a.flexible) || a.dur / a.baseDur - b.dur / b.baseDur)[0];
        if (!stretch) break;
        stretch.dur += 15;
        const s = simulate(f, best.order, home, pace);
        if (!s.fits) {
          stretch.dur -= 15;
          break;
        }
        best = s;
      }
      // Last resort when the AI pool ran out: explicit free-exploration time
      // (with meals placed around it) instead of an unexplained empty block.
      for (let k = 0; k < 6 && best.fits && f.windowEnd - best.returnTime > f.maxRest; k++) {
        const last = best.order.slice().reverse().find((i) => !i.filler);
        const at = last || home;
        const area = last?.area || "";
        const dur = Math.min(90, Math.max(30, round15(f.windowEnd - best.returnTime - Math.max(f.minRest, f.maxRest - 30))));
        const filler = { filler: true, name: "", nameHe: "", label: dur <= 45 ? `קינוח ושיטוט ערב קצר${area ? " באזור " + area : " ליד הלינה"}` : `זמן חופשי לשיטוט, קניות ובתי קפה${area ? " באזור " + area : " ליד הלינה"}`, lat: at.lat, lng: at.lng, area, dur, baseDur: dur, openFrom: null, openTo: null, closedDays: [], bestTime: "any", flexible: false, mustSee: false, rank: 999 };
        let s2 = simulate(f, [...best.order, filler], home, pace);
        while (!s2.fits && filler.dur > 30) {
          filler.dur -= 15;
          s2 = simulate(f, [...best.order, filler], home, pace);
        }
        if (!s2.fits) break;
        best = s2;
      }
      results.set(f.date, best);
    }

    // 5) Assemble contiguous day schedules.
    const stops = [];
    const dailySchedule = frames.map((f) => {
      const out = [];
      const push = (s, e, label, place, item) => {
        s = Math.max(0, Math.min(1439, s));
        e = Math.max(0, Math.min(1439, e));
        if (e <= s) return;
        const last = out[out.length - 1];
        if (last && last.e !== s) {
          if (s > last.e) out.push({ s: last.e, e: s, label: "הפסקה קצרה", place: "", item: null });
          else s = last.e;
        }
        if (e <= s) return;
        out.push({ s, e, label, place, item });
      };
      for (const b of f.pre) push(...b);
      const res = results.get(f.date);
      let end = f.start ?? (f.pre.length ? f.pre[f.pre.length - 1][1] : f.wake);
      if (res) {
        for (const b of res.blocks) push(...b);
        end = res.returnTime;
      }
      if (f.start !== null) {
        const restEnd = f.windowEnd;
        if (restEnd > end) push(end, restEnd, f.endLabel, "", null);
      }
      for (const b of f.post) push(...b);
      let sleep = f.sleep;
      const lastEnd = out.length ? out[out.length - 1].e : f.wake;
      if (lastEnd < sleep) push(lastEnd, sleep, f.kind.includes("departure") ? "טיסה הביתה" : "מנוחה והתארגנות לשינה", "", null);
      if (lastEnd > sleep) sleep = lastEnd;
      const wake = out.length ? out[0].s : f.wake;
      const blocks = out.map((b) => {
        const block = {
          startTime: clock(b.s),
          endTime: clock(b.e),
          activity: b.label.slice(0, 240),
          placeName: b.place ? b.place.slice(0, 160) : "",
          existingStopId: b.item?.existingStopId || "",
        };
        if (b.item)
          stops.push({
            name: b.item.name,
            nameHe: b.item.nameHe,
            date: f.date,
            time: block.startTime,
            duration: b.e - b.s,
            notes: [b.item.nameHe && b.item.nameHe !== b.item.name ? b.item.nameHe : "", b.item.why, b.item.openFrom !== null ? `שעות פתיחה משוערות: ${clock(b.item.openFrom)}–${b.item.openTo !== null ? clock(b.item.openTo) : "?"}` : "", b.item.approx ? "המיקום משוער — כדאי לבדוק במפה" : ""]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 2900),
            lat: b.item.lat,
            lng: b.item.lng,
            existingStopId: b.item.existingStopId,
            mustSee: b.item.mustSee,
          });
        return block;
      });
      return { date: f.date, wakeTime: clock(wake), sleepTime: clock(sleep), blocks };
    });
    const unused = pool.filter((p) => !used.has(p)).slice(0, 15).map((p) => p.nameHe || p.name);
    return { dailySchedule, stops, warnings, unused };
  }

  /* Validate a produced schedule the same way the app does (no gaps, no overlaps). */
  function checkSchedule(schedule) {
    const problems = [];
    for (const day of schedule) {
      let prev = toMin(day.wakeTime);
      for (const b of day.blocks) {
        const s = toMin(b.startTime),
          e = toMin(b.endTime);
        if (s !== prev) problems.push(`${day.date}: פער לפני ${b.startTime}`);
        if (e === null || e <= s) problems.push(`${day.date}: מקטע לא תקין ${b.startTime}`);
        prev = e;
      }
      if (prev !== toMin(day.sleepTime)) problems.push(`${day.date}: הלוח לא מגיע עד השינה`);
    }
    return problems;
  }

  const api = { plan, travel, km, checkSchedule, toMin, clock, norm };
  root.ItineraryEngine = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
