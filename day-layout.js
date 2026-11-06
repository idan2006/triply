/* Re-time one day after the traveller (or the chat) changes it: drag, edit, add, remove, move to another day.
 * Derived rows — travel (walk / public transport / back to the hotel), "coffee until it opens" waits and short
 * gap fillers — are dropped and recomputed from the new order and the places' coordinates. Fixed rows (landing,
 * flights, wake-up, check-in/out) keep their clock time; free-time rows shrink first when the day is too full;
 * the evening rest absorbs what is left. Pure functions — testable in Node. */
(function (root) {
  "use strict";
  const E = () => root.ItineraryEngine;
  const toMin = (v) => {
    const m = String(v || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const clock = (v) => {
    const x = Math.max(0, Math.min(1439, Math.round(v)));
    return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  };
  // Walks and rides between places — the planner's own rows and the free-text ones of older plans ("הליכה לקובנט
  // גרדן דרך סוהו", "נסיעה ברכבת התחתית ל…"). The day editor does not let the traveller name a row like that.
  const TRAVEL =
    /^(?:הליכה|נסיעה בתחבורה|נסיעה במונית|נסיעה ברכבת|נסיעה באוטובוס|נסיעה במטרו|נסיעה ל(?!שדה התעופה))|^חזרה ללינה/;
  const WAIT = /^הפסקת קפה ליד .+ עד הפתיחה$/;
  const GAP = /^הפסקה קצרה$/;
  const FIXED = /נחיתה|שדה התעופה|המראה|טיסה|צ'ק-אין|צ'ק-אאוט|אריזה|שינה אחרי|^קימה|איסוף מזוודות|^הגעה ל/;
  const SLACK = /^מנוחה|^זמן התארגנות|התארגנות לשינה/;
  const FREE = /סיור רגלי חופשי|זמן לשוטט|שיטוט|הפסקת קפה|טיול ערב|^זמן חופשי/;
  const FREE_LABEL = "זמן חופשי — אפשר להוסיף כאן מקום";
  const isLunch = (b) => /ארוחת צהריים/.test(b.activity) && !b.placeName;
  const isDinner = (b) => /ארוחת ערב/.test(b.activity) && !b.placeName;
  const isFree = (b) => FREE.test(b.activity) && !b.placeName;
  const valid = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  const same = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  const label = (b) => String(b.activity || "").replace(/^ביקור:\s*/, "");
  const span = (b) => toMin(b.endTime) - toMin(b.startTime);
  const UNKNOWN = Object.freeze({ unknown: true });

  /* 'fixed' | 'travel' (derived, recomputed) | 'slack' | 'move' for one block. */
  function roleOf(b) {
    if (b.placeName) return "move";
    const a = String(b.activity || "");
    if (TRAVEL.test(a) || WAIT.test(a) || GAP.test(a)) return "travel";
    if (FIXED.test(a)) return "fixed";
    if (SLACK.test(a)) return "slack";
    return "move";
  }
  const roles = (day) => (day.blocks || []).map(roleOf);

  /* head = the leading fixed rows (wake-up, landing…), tail = the trailing rest/fixed rows (evening rest, airport),
   * middle = everything movable in between (plus a fixed row stuck between movable ones). Derived rows are left out. */
  function split(day) {
    const items = (day.blocks || [])
      .map((b, i) => ({ ...b, _idx: i, _role: roleOf(b), _dur: span(b) }))
      .filter((x) => x._role !== "travel");
    let h = 0;
    while (h < items.length && items[h]._role === "fixed") h++;
    let t = items.length;
    while (t > h && items[t - 1]._role !== "move") t--;
    return {
      head: items.slice(0, h),
      // A rest row between activities (e.g. "מנוחה במלון" of an older plan, or one the traveller added) is kept as an
      // activity; only the evening rest at the end of the day is recomputed.
      middle: items.slice(h, t).map((x) => (x._role === "slack" ? { ...x, _role: "move" } : x)),
      tail: items.slice(t),
    };
  }

  const row = (s, e, activity, b = {}) => ({
    startTime: clock(s),
    endTime: clock(e),
    activity,
    placeName: b.placeName || "",
    existingStopId: b.existingStopId || "",
  });

  /* Lays out `middle` (items in the wanted order, each with _dur) inside the day's free window.
   * ctx: { home:{lat,lng}|null, pointOf(item) → {lat,lng}|null, openOf(item) → {open,close}|null, pinned(item) → bool,
   *        maxLater: minutes the bedtime may move later when the day is too full (default 0) } */
  function layout(day, middleIn, ctx = {}) {
    const { head, middle: was, tail } = split(day);
    const wake = toMin(day.wakeTime),
      sleep = toMin(day.sleepTime);
    if (wake === null || sleep === null) return { ok: false, message: "שעת הקימה או השינה של היום לא תקינה." };
    // A day that is only flights and transfers (the flight day before a night landing, a very early flight home, a late
    // landing) has no room for visits: refuse instead of putting a place after the plane has left.
    if (!was.length && !tail.some((b) => b._role === "slack") && middleIn.some((b) => b.placeName))
      return {
        ok: false,
        noRoom: true,
        message:
          "ביום הזה אין זמן לביקורים — לפי הטיסות הוא כולו טיסה ונסיעות. בחר יום אחר (ואם הטיסות השתנו, כתוב את השעות החדשות בצ'אט).",
      };
    const start = head.length ? toMin(head.at(-1).endTime) : wake;
    const tailFixed = tail.find((b) => b._role === "fixed");
    let limit = tailFixed ? toMin(tailFixed.startTime) : sleep;
    const home = valid(ctx.home) ? { lat: Number(ctx.home.lat), lng: Number(ctx.home.lng) } : null;
    const pinned = (b) => Boolean(b._pin || (ctx.pinned && ctx.pinned(b)));
    // Lunch normally floats to 12:00. On a day that ends at the airport it may be a little earlier (from 11:00),
    // leaving ~30 minutes to get back to the hotel; a meal that cannot fit before the day's end at all is left out
    // (eaten at the airport / on the way), as the planner itself does.
    const lunchRow = middleIn.find((b) => isLunch(b) && !pinned(b));
    const lunchDur = lunchRow ? Math.max(5, Math.round(Number(lunchRow._dur) || 0)) : 60;
    // time needed after lunch to get back to the hotel (from the day's last place)
    const lastPlace = [...middleIn].reverse().find((b) => b.placeName);
    const lastPoint = lastPlace ? ctx.pointOf?.(lastPlace) || null : null;
    const backLeg = tailFixed && home && lastPlace ? (valid(lastPoint) ? E().travel(lastPoint, home).min : 25) : 30;
    const lunchAt = tailFixed ? Math.max(11 * 60, Math.min(12 * 60, limit - lunchDur - backLeg)) : 12 * 60;
    const DINNER_AT = 18 * 60 + 30;

    // true once waiting for a meal's hour (see `side` below) would overfill the day: the meal is then eaten at once.
    let eager = false;
    const build = (items, finalFree = 0) => {
      const floating = items.filter((b) => (isLunch(b) || isDinner(b)) && !pinned(b));
      const list = items.filter((b) => !floating.includes(b));
      let lunch = floating.find(isLunch),
        dinner = floating.find(isDinner);
      const out = [];
      let t = start,
        pos = home,
        travel = 0,
        penalty = 0;
      const put = (b, d) => {
        out.push(row(t, t + d, b.activity, b));
        t += d;
      };
      // pos: null = start of a day without a known hotel (no leg); UNKNOWN = after a place we could not locate.
      const hop = (to, name, back) => {
        if (!pos) return;
        if (to && pos !== UNKNOWN && same(pos, to)) return;
        // An unknown end of the leg gets the planner's own estimate instead of "next door".
        const tr = E().travel(pos === UNKNOWN ? null : pos, to || null);
        if (!tr.min) return;
        const how = tr.mode === "walk" ? "הליכה" : "נסיעה בתחבורה ציבורית";
        const text = back
          ? `חזרה ללינה (${tr.mode === "walk" ? "הליכה" : "תחבורה ציבורית"} ~${tr.min} דק')`
          : `${how} אל ${name} (~${tr.min} דק')`;
        out.push(row(t, t + tr.min, text));
        t += tr.min;
        travel += tr.min;
      };
      const meal = (m, at) => {
        // A meal left for the end of a short day waits for its normal hour instead of being eaten at 11:00.
        if (at && t < at) {
          out.push(row(t, at, FREE_LABEL));
          t = at;
        }
        put(m, m._dur);
      };
      // The row the traveller just dragged keeps its side of each meal: dropped after lunch, lunch comes first (from
      // half an hour before its usual hour, with free time before it if needed); dropped before lunch, it is visited
      // first even if lunch is later.
      const side = (b, m) => (m && b._pin ? Math.sign(items.indexOf(b) - items.indexOf(m)) : 0);
      for (const b of list) {
        const ls = side(b, lunch);
        if (lunch && b._role !== "fixed" && (ls > 0 || (!ls && t >= lunchAt))) {
          meal(lunch, ls > 0 && !eager ? Math.min(lunchAt, Math.max(11 * 60, lunchAt - 30)) : 0);
          lunch = null;
        }
        const ds = side(b, dinner);
        if (dinner && b._role !== "fixed" && (ds > 0 || (!ds && t >= DINNER_AT))) {
          meal(dinner, ds > 0 && !eager ? DINNER_AT - 30 : 0);
          dinner = null;
        }
        if (isFree(b) && !pinned(b) && ((lunch && t < lunchAt) || (dinner && t < DINNER_AT))) {
          // A meal that falls inside a stretch of free time is eaten at its hour, with free time around it.
          let d = b._dur;
          for (const [m, at] of [
            [lunch, lunchAt],
            [dinner, DINNER_AT],
          ]) {
            if (!m || !(t < at && t + d > at)) continue;
            const part = at - t;
            put(b, part);
            d -= part;
            meal(m);
            if (m === lunch) lunch = null;
            else dinner = null;
          }
          if (d > 0) put(b, d);
          continue;
        }
        if (b._role === "fixed") {
          // A fixed row inside the day (rare): keep its clock time; wait if early.
          const s = toMin(b.startTime);
          if (s > t) {
            out.push(row(t, s, "זמן חופשי"));
            t = s;
          }
          put(b, b._dur);
          continue;
        }
        const p = b.placeName ? ctx.pointOf?.(b) || null : null;
        if (b.placeName) hop(p, label(b));
        const open = b.placeName && ctx.openOf ? ctx.openOf(b) : null;
        if (open && open.open !== null && t < open.open) {
          if (open.open - t <= 120) {
            out.push(row(t, open.open, `הפסקת קפה ליד ${label(b)} עד הפתיחה`));
            penalty += (open.open - t) / 2;
            t = open.open;
          } else penalty += 300;
        }
        if (open && open.close !== null && t + b._dur > open.close) penalty += 200 + (t + b._dur - open.close);
        put(b, b._dur);
        if (b.placeName) pos = p || UNKNOWN;
      }
      if (lunch) meal(lunch, lunchAt);
      if (dinner) meal(dinner, DINNER_AT);
      if (finalFree > 0) out.push(row(t, (t += finalFree), FREE_LABEL));
      if (home && list.some((b) => b.placeName)) hop(home, "", true);
      return { out, t, travel, penalty };
    };

    let items = middleIn
      .map((b) => ({ ...b, _dur: Math.max(5, Math.round(Number(b._dur) || 0)) }))
      .filter(
        (b) =>
          pinned(b) ||
          !((isLunch(b) && lunchAt + b._dur > limit) || (isDinner(b) && tailFixed && DINNER_AT + b._dur > limit)),
      );
    let res = build(items);
    const warnings = [];
    // Too long for the day? Shorten free-time rows first (keeping ~30 minutes of evening rest when the day ends
    // at the hotel), then drop them — never visits or meals.
    const soft = limit - (tailFixed ? 0 : 30);
    if (res.t > soft) {
      let over = res.t - soft;
      for (const b of items.filter((x) => isFree(x) && !pinned(x))) {
        const cut = Math.min(over, b._dur - 15);
        if (cut > 0) {
          b._dur -= cut;
          over -= cut;
        }
        if (over <= 0) break;
      }
      res = build(items);
    }
    if (res.t > limit) {
      items = items.filter((x) => !isFree(x) || pinned(x));
      res = build(items);
    }
    if (res.t > limit) {
      eager = true;
      res = build(items);
    }
    let sleepOut = sleep;
    if (res.t > limit && !tailFixed && ctx.maxLater > 0) {
      const later = res.t - limit;
      if (later <= ctx.maxLater && res.t <= 1439) {
        limit = res.t;
        sleepOut = res.t;
        warnings.push(`היום מלא, ולכן שעת השינה זזה ל-${clock(sleepOut)} (במקום ${clock(sleep)})`);
      }
    }
    // An automatic re-time (new hotel or flights — nobody chose it) shortens the longest visits a little instead of
    // failing; a change the traveller makes gets a clear refusal instead.
    if (res.t > limit && ctx.squeeze > 0 && res.t - limit <= ctx.squeeze) {
      let over = res.t - limit;
      const cut = [];
      for (const b of items.filter((x) => x.placeName).sort((a, b) => b._dur - a._dur)) {
        const c = Math.min(over, b._dur - 30);
        if (c <= 0) continue;
        b._dur -= c;
        over -= c;
        cut.push(`את ${label(b)} ב-${c} דק'`);
        if (over <= 0) break;
      }
      const trial = build(items);
      if (over <= 0 && trial.t <= limit) {
        res = trial;
        warnings.push(`כדי שהכל ייכנס, קיצרתי ${cut.join(" ו")}`);
      }
    }
    if (res.t > limit)
      return {
        ok: false,
        over: res.t - limit,
        message: `אין מספיק זמן ביום — חסרות ${res.t - limit} דקות. קצר ביקור או העבר מקום ליום אחר.`,
      };
    // A long empty evening becomes visible free time in the area (before heading back), like the planner does.
    if (items.some((b) => b.placeName)) {
      let extra = 0;
      for (let k = 0; k < 4; k++) {
        const left = limit - res.t;
        if (left <= 100) break;
        const add = Math.floor((left - 45) / 15) * 15;
        if (add < 15) break;
        const trial = build(items, extra + add);
        if (trial.t > limit) break;
        extra += add;
        res = trial;
      }
    }

    const blocksOut = head.map((b) => row(toMin(b.startTime), toMin(b.endTime), b.activity, b));
    blocksOut.push(...res.out);
    let t = res.t;
    const slack = tail.find((b) => b._role === "slack");
    if (t < limit) blocksOut.push(row(t, limit, slack ? slack.activity : "מנוחה והתארגנות"));
    t = Math.max(t, limit);
    const after = tailFixed ? tail.slice(tail.indexOf(tailFixed)) : [];
    for (const b of after) {
      const s = toMin(b.startTime),
        e = toMin(b.endTime);
      if (b._role === "slack") {
        if (e > t) {
          blocksOut.push(row(t, e, b.activity));
          t = e;
        }
        continue;
      }
      if (s > t) blocksOut.push(row(t, s, "זמן התארגנות"));
      blocksOut.push(row(Math.max(s, t), e, b.activity, b));
      t = e;
    }
    if (t < sleepOut) blocksOut.push(row(t, sleepOut, "מנוחה והתארגנות לשינה"));
    if (t > sleepOut) sleepOut = t;
    // Drop zero-length rows and merge neighbouring free-time rows.
    const clean = [];
    for (const b of blocksOut) {
      if (toMin(b.endTime) <= toMin(b.startTime)) continue;
      const prev = clean.at(-1);
      if (prev && !prev.placeName && !b.placeName && prev.activity === b.activity && prev.endTime === b.startTime) {
        prev.endTime = b.endTime;
        continue;
      }
      clean.push(b);
    }
    return {
      ok: true,
      day: { ...day, wakeTime: day.wakeTime, sleepTime: clock(sleepOut), blocks: clean },
      travel: res.travel,
      penalty: res.penalty,
      warnings,
    };
  }

  /* Old API (drag & drop and tests): order = block indexes of the non-travel rows in the new order;
   * ctx.pinned = index of the row the traveller moved (a dragged meal stays where it was put). */
  function relayout(day, order, ctx = {}) {
    const r = roles(day);
    const items = order
      .filter((i) => r[i] === "move" || r[i] === "fixed")
      .map((i) => ({ ...day.blocks[i], _idx: i, _role: r[i], _dur: span(day.blocks[i]) }));
    const { head } = split(day);
    const headIdx = new Set(head.map((b) => b._idx));
    const middle = items.filter((b) => !headIdx.has(b._idx) && !(b._role === "fixed" && isTail(day, b._idx)));
    if (!middle.some((b) => b._role === "move")) return { ok: true, day };
    return layout(day, middle, { ...ctx, pinned: (b) => b._idx === ctx.pinned });
  }
  function isTail(day, idx) {
    const { tail } = split(day);
    return tail.some((b) => b._idx === idx);
  }

  /* Best position for a new item among `middle` (least travel, respects opening hours, must fit). */
  function bestInsert(day, middle, item, ctx = {}) {
    let best = null;
    for (let i = 0; i <= middle.length; i++) {
      const order = middle.slice();
      order.splice(i, 0, item);
      const r = layout(day, order, ctx);
      // A place with no time asked for goes where it fits best — preferably in daylight hours, not after dinner.
      const at = r.ok
        ? r.day.blocks.find(
            (b) =>
              (item.existingStopId && b.existingStopId === item.existingStopId) ||
              (!item.existingStopId && b.placeName && b.placeName === item.placeName),
          )
        : null;
      const late = at ? Math.max(0, toMin(at.startTime) - 19 * 60) * 1.5 : 0;
      const cost = r.ok ? r.travel + r.penalty + late : 100000 + (r.over || 0);
      if (!best || cost < best.cost) best = { cost, order, ok: r.ok };
    }
    return best ? best.order : [...middle, item];
  }

  const HOURS = /שעות פתיחה[^:]*:\s*(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2}|\?)/;
  function openOf(block, stops) {
    const st =
      (stops || []).find((s) => block.existingStopId && s.id === block.existingStopId) ||
      (stops || []).find((s) => s.name === block.placeName);
    const m = String(st?.notes || "").match(HOURS);
    return m ? { open: toMin(m[1]), close: toMin(m[2]) } : null;
  }
  /* Opening-hour warnings for places that moved outside "שעות פתיחה משוערות: 10:00–18:00". */
  function hourWarnings(day, stops) {
    const out = [];
    for (const b of day.blocks) {
      if (!b.placeName) continue;
      const st =
        (stops || []).find((s) => b.existingStopId && s.id === b.existingStopId) ||
        (stops || []).find((s) => s.name === b.placeName);
      const m = String(st?.notes || "").match(HOURS);
      if (!m) continue;
      const open = toMin(m[1]),
        close = toMin(m[2]);
      if ((open !== null && toMin(b.startTime) < open) || (close !== null && toMin(b.endTime) > close))
        out.push(`${label(b)} פתוח בערך ${m[1]}–${m[2]}`);
    }
    return out;
  }

  root.TriplyDayLayout = {
    roles,
    roleOf,
    split,
    layout,
    relayout,
    bestInsert,
    hourWarnings,
    openOf,
    toMin,
    clock,
    TRAVEL,
    FIXED,
    SLACK,
    FREE,
  };
  if (typeof module !== "undefined") module.exports = root.TriplyDayLayout;
})(globalThis);
