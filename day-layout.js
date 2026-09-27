/* Re-time one day after the traveller drags things around.
 * Travel rows (walk / public transport / back to the hotel) are recomputed from
 * the new order; fixed rows (landing, flights, wake-up, night sleep) stay put and
 * the evening rest absorbs the difference. Pure functions — testable in Node. */
(function (root) {
  'use strict';
  const E = () => root.ItineraryEngine;
  const toMin = (v) => { const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/); return m ? +m[1] * 60 + +m[2] : null; };
  const clock = (v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  const TRAVEL = /^הליכה|^נסיעה בתחבורה|^נסיעה במונית|^חזרה ללינה/;
  const FIXED = /נחיתה|שדה התעופה|המראה|טיסה|צ'ק-אין|צ'ק-אאוט|אריזה|שינה אחרי|^קימה|איסוף מזוודות|^הגעה ל/;
  const SLACK = /^מנוחה|זמן התארגנות אחרון|התארגנות לשינה/;
  const FREE = /סיור רגלי חופשי|זמן לשוטט|שיטוט|הפסקת קפה|טיול ערב/;

  /* 'fixed' | 'travel' | 'slack' | 'move' for every block of the day. */
  function roles(day) {
    const blocks = day.blocks || [];
    const out = blocks.map((b) => (TRAVEL.test(b.activity) && !b.placeName ? 'travel' : FIXED.test(b.activity) && !b.placeName ? 'fixed' : SLACK.test(b.activity) && !b.placeName ? 'slack' : 'move'));
    // Leading and trailing fixed runs; anything fixed in the middle stays fixed too.
    return out;
  }

  const same = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  const label = (b) => String(b.activity || '').replace(/^ביקור:\s*/, '');

  /* order: array of block indexes of the movable/slack/fixed blocks (travel blocks omitted) in the new order.
   * ctx: { home:{lat,lng}, pointOf(block) → {lat,lng}|null } */
  function relayout(day, order, ctx) {
    const blocks = day.blocks;
    const r = roles(day);
    const kept = order.map((i) => ({ ...blocks[i], _idx: i, _role: r[i], _dur: toMin(blocks[i].endTime) - toMin(blocks[i].startTime) }));
    const firstMove = kept.findIndex((b) => b._role === 'move');
    if (firstMove < 0) return { ok: true, day };
    // Head = fixed rows before the first movable one; tail = from the first slack/fixed row after the last movable one.
    let lastMove = -1;
    kept.forEach((b, i) => { if (b._role === 'move') lastMove = i; });
    const head = kept.slice(0, firstMove);
    const middle = kept.slice(firstMove, lastMove + 1).filter((b) => b._role === 'move' || b._role === 'slack' ? b._role === 'move' : true);
    const tail = kept.slice(lastMove + 1);
    const headEnd = head.length ? toMin(head.at(-1).endTime) : toMin(day.wakeTime);
    // Where the evening can end: the first fixed row of the tail, else bedtime.
    const tailFixed = tail.find((b) => b._role === 'fixed');
    const limit = tailFixed ? toMin(tailFixed.startTime) : toMin(day.sleepTime);
    const home = ctx.home && Number.isFinite(ctx.home.lat) ? ctx.home : null;

    // Meals float to sensible times (lunch ~12:00+, dinner ~18:30+) unless the traveller dragged that meal.
    const isLunch = (b) => /ארוחת צהריים/.test(b.activity) && !b.placeName;
    const isDinner = (b) => /ארוחת ערב/.test(b.activity) && !b.placeName;
    const pinned = ctx.pinned;
    const build = (itemsIn) => {
      const floating = itemsIn.filter((b) => (isLunch(b) || isDinner(b)) && b._idx !== pinned);
      const items = itemsIn.filter((b) => !floating.includes(b));
      let lunch = floating.find(isLunch), dinner = floating.find(isDinner);
      const out = [];
      let t = headEnd, pos = home;
      const meal = (m) => { out.push(strip(m, t, t + m._dur)); t += m._dur; };
      const hop = (to, name, back) => {
        if (!pos || !to || same(pos, to)) return;
        const tr = E().travel(pos, to);
        if (!tr.min) return;
        const text = back ? `חזרה ללינה (${tr.mode === 'walk' ? 'הליכה' : 'תחבורה ציבורית'} ~${tr.min} דק')` : `${tr.mode === 'walk' ? 'הליכה' : 'נסיעה בתחבורה ציבורית'} אל ${name} (~${tr.min} דק')`;
        out.push({ startTime: clock(t), endTime: clock(t + tr.min), activity: text, placeName: '', existingStopId: '' });
        t += tr.min;
      };
      for (const b of items) {
        if (lunch && t >= 12 * 60 && b._role !== 'fixed') { meal(lunch); lunch = null; }
        if (dinner && t >= 18 * 60 + 30 && b._role !== 'fixed') { meal(dinner); dinner = null; }
        if (b._role === 'fixed') {
          // A fixed row inside the day (rare): keep its clock time; wait if early.
          const s = toMin(b.startTime);
          if (s > t) { out.push({ startTime: clock(t), endTime: clock(s), activity: 'זמן חופשי', placeName: '', existingStopId: '' }); t = s; }
          out.push(strip(b, t, t + b._dur)); t += b._dur; continue;
        }
        const p = b.placeName ? ctx.pointOf(b) : null;
        if (p) hop(p, label(b));
        const open = b.placeName && ctx.openOf ? ctx.openOf(b) : null;
        if (open && open.open !== null && t < open.open && open.open - t <= 120) {
          out.push({ startTime: clock(t), endTime: clock(open.open), activity: `הפסקת קפה ליד ${label(b)} עד הפתיחה`, placeName: '', existingStopId: '' });
          t = open.open;
        }
        out.push(strip(b, t, t + b._dur));
        t += b._dur;
        if (p) pos = p;
      }
      if (lunch) meal(lunch);
      if (dinner) meal(dinner);
      if (home) hop(home, '', true);
      return { out, t };
    };
    const strip = (b, s, e) => ({ startTime: clock(s), endTime: clock(e), activity: b.activity, placeName: b.placeName || '', existingStopId: b.existingStopId || '' });

    let items = middle.map((b) => ({ ...b }));
    let res = build(items);
    // Too long for the day? Shorten free-time rows first (never visits or meals).
    let over = res.t - limit;
    if (over > 0) {
      for (const b of items.filter((x) => FREE.test(x.activity) && !x.placeName)) {
        const cut = Math.min(over, b._dur - 15);
        if (cut > 0) { b._dur -= cut; over -= cut; }
        if (over <= 0) break;
      }
      items = items.filter((b) => b._dur > 0);
      res = build(items);
    }
    if (res.t > limit) return { ok: false, over: res.t - limit, message: `אין מספיק זמן ביום — חסרות ${res.t - limit} דקות. קצר ביקור או העבר מקום ליום אחר.` };

    const blocksOut = head.map((b) => strip(b, toMin(b.startTime), toMin(b.endTime)));
    blocksOut.push(...res.out);
    let t = res.t;
    const slack = tail.find((b) => b._role === 'slack');
    if (t < limit) blocksOut.push({ startTime: clock(t), endTime: clock(limit), activity: slack ? slack.activity : 'מנוחה והתארגנות', placeName: '', existingStopId: '' });
    t = limit;
    for (const b of tail.filter((x) => x._role === 'fixed' || (x._role === 'slack' && tail.indexOf(x) > tail.indexOf(tailFixed)))) {
      const s = toMin(b.startTime), e = toMin(b.endTime);
      if (s > t) blocksOut.push({ startTime: clock(t), endTime: clock(s), activity: 'זמן התארגנות', placeName: '', existingStopId: '' });
      blocksOut.push(strip(b, Math.max(s, t), e));
      t = e;
    }
    const sleep = toMin(day.sleepTime);
    if (t < sleep) blocksOut.push({ startTime: clock(t), endTime: clock(sleep), activity: 'מנוחה והתארגנות לשינה', placeName: '', existingStopId: '' });
    // Merge accidental zero/duplicate rows.
    const clean = blocksOut.filter((b) => toMin(b.endTime) > toMin(b.startTime));
    return { ok: true, day: { ...day, blocks: clean } };
  }

  function openOf(block, stops) {
    const st = (stops || []).find((s) => s.id === block.existingStopId) || (stops || []).find((s) => s.name === block.placeName);
    const m = String(st?.notes || '').match(/שעות פתיחה[^:]*:\s*(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2}|\?)/);
    return m ? { open: toMin(m[1]), close: toMin(m[2]) } : null;
  }
  /* Opening-hour warnings for places that moved outside "שעות פתיחה משוערות: 10:00–18:00". */
  function hourWarnings(day, stops) {
    const out = [];
    for (const b of day.blocks) {
      if (!b.placeName) continue;
      const st = (stops || []).find((s) => s.id === b.existingStopId) || (stops || []).find((s) => s.name === b.placeName);
      const m = String(st?.notes || '').match(/שעות פתיחה[^:]*:\s*(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2}|\?)/);
      if (!m) continue;
      const open = toMin(m[1]), close = toMin(m[2]);
      if ((open !== null && toMin(b.startTime) < open) || (close !== null && toMin(b.endTime) > close))
        out.push(`${label(b)} פתוח בערך ${m[1]}–${m[2]}`);
    }
    return out;
  }

  root.TriplyDayLayout = { roles, relayout, hourWarnings, openOf, TRAVEL, FIXED, SLACK };
  if (typeof module !== 'undefined') module.exports = root.TriplyDayLayout;
})(globalThis);
