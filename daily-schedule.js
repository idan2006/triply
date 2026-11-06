(function () {
  "use strict";
  // The day plan is out of date only when a place was added, removed, renamed or moved — not for notes or map pins.
  const scheduleKey = (list) =>
    JSON.stringify(
      (Array.isArray(list) ? list : []).map((s) => [
        String(s.id || ""),
        String(s.name || ""),
        String(s.date || ""),
        String(s.time || ""),
        Number(s.duration) || 0,
      ]),
    );
  const scheduleStale = (trip) => {
    if (!trip.scheduleStopSnapshot) return true;
    try {
      return scheduleKey(JSON.parse(trip.scheduleStopSnapshot)) !== scheduleKey(trip.stops);
    } catch {
      return true;
    }
  };
  const norm = (v) =>
    String(v || "")
      .trim()
      .toLocaleLowerCase();
  const R = () => window.TriplyReflow;
  const L = () => window.TriplyDayLayout;
  window.TriplySchedule = {
    isFresh: (trip) => Boolean(trip?.dailySchedule?.length) && !scheduleStale(trip),
    // True when the place is a visit in the day plan.
    isLinked(trip, stop) {
      return (
        Boolean(stop) &&
        (trip?.dailySchedule || []).some((day) =>
          (day.blocks || []).some((block) =>
            block.existingStopId
              ? block.existingStopId === stop.id
              : day.date === stop.date && Boolean(block.placeName) && norm(block.placeName) === norm(stop.name),
          ),
        )
      );
    },
    // Kept for older callers: a deleted place is now removed by re-timing the day (see TriplyReflow).
    forgetStop() {},
  };

  /* ---------- What changed: the moved places light up, a bar says where they went, and it can be undone ---------- */
  const KEEP = new Set(["id", "chat", "createdAt", "updatedAt"]);
  let flash = null, // { tripId, until, moved: Map(stopId → {date,time} | null for new), shifted: Set(stopId), scrolled }
    undo = null, // { tripId, before (whole trip), after (fingerprint) }
    barTimer = 0;
  function noteChange(before, after, primary = new Set(), extra = "") {
    const old = new Map((before.stops || []).map((x) => [x.id, x]));
    const moved = new Map(),
      shifted = new Set();
    for (const x of after.stops || []) {
      const o = old.get(x.id);
      if (!o) moved.set(x.id, null);
      else if (o.date !== x.date || o.time !== x.time) {
        if (primary.has(x.id) || o.date !== x.date) moved.set(x.id, { date: o.date, time: o.time });
        else shifted.add(x.id);
      } else if (primary.has(x.id) && (o.name !== x.name || o.duration !== x.duration))
        moved.set(x.id, { date: o.date, time: o.time });
    }
    flash = { tripId: after.id, until: Date.now() + 10000, moved, shifted, scrolled: false };
    undo = { tripId: after.id, before: structuredClone(before), after: structuredClone(after) };
    // the message: where the place went (in words), how many others shifted, and anything to watch out for
    const labelOf = (st) => {
      for (const d of after.dailySchedule || [])
        for (const b of d.blocks || [])
          if (b.existingStopId === st.id && b.placeName) return b.activity.replace(/^ביקור:\s*/, "") || st.name;
      return st.name;
    };
    const first = [...moved.keys()].map((id) => after.stops.find((x) => x.id === id)).filter(Boolean)[0];
    const removed = (before.stops || []).filter((x) => !after.stops.some((y) => y.id === x.id));
    let head = "✓ הלוח עודכן";
    if (first) {
      const o = moved.get(first.id);
      const name = labelOf(first);
      head = !o
        ? `✓ ${name} נוסף ל${R().dayShort(first.date)}, ${first.time}`
        : o.date !== first.date
          ? `✓ ${name} עבר ל${R().dayShort(first.date)}, ${first.time}`
          : o.time !== first.time
            ? `✓ ${name} עבר ל-${first.time} (היה ${o.time})`
            : `✓ ${name} עודכן`;
      if (moved.size > 1) head += ` ועוד ${moved.size - 1}`;
    } else if (removed.length) head = `✓ ${removed[0].name} נמחק מהלוח`;
    const sub = [
      shifted.size
        ? `${shifted.size === 1 ? "מקום אחד נוסף זז" : `עוד ${shifted.size} מקומות זזו`} בשעה · זמני הדרך עודכנו`
        : "זמני הדרך עודכנו",
      extra,
    ]
      .filter(Boolean)
      .join(" · ");
    showBar(head, sub);
  }
  function showBar(text, sub) {
    let bar = document.getElementById("changeBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "changeBar";
      bar.className = "change-bar";
      bar.setAttribute("role", "status");
      document.body.append(bar);
    }
    bar.innerHTML = `<div class="cb-msg"><b>${escapeHTML(text)}</b>${sub ? `<small>${escapeHTML(sub)}</small>` : ""}</div><button type="button" class="cb-undo">↶ ביטול</button><button type="button" class="cb-x" aria-label="סגירה">✕</button>`;
    bar.querySelector(".cb-undo").onclick = undoLast;
    bar.querySelector(".cb-x").onclick = hideBar;
    requestAnimationFrame(() => bar.classList.add("show"));
    clearTimeout(barTimer);
    barTimer = setTimeout(hideBar, 10000);
  }
  function hideBar() {
    clearTimeout(barTimer);
    document.getElementById("changeBar")?.classList.remove("show");
  }
  function undoLast() {
    hideBar();
    const u = undo;
    undo = null;
    const live = u && state.trips.find((t) => t.id === u.tripId);
    if (!live) return;
    // Only what this change touched goes back; anything else (an expense from another device…) stays as it is now.
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const keys = [...new Set([...Object.keys(u.before), ...Object.keys(u.after)])].filter(
      (k) => !KEEP.has(k) && !same(u.before[k], u.after[k]),
    );
    if (keys.some((k) => !same(live[k], u.after[k]))) {
      toast("אי אפשר לבטל — הטיול השתנה בינתיים");
      return;
    }
    const now = structuredClone(live);
    for (const k of keys) {
      if (k in u.before) live[k] = structuredClone(u.before[k]);
      else delete live[k];
    }
    try {
      save();
    } catch {}
    // show where things went back to
    const back = new Set(
      (u.before.stops || [])
        .filter((x) => {
          const y = now.stops.find((z) => z.id === x.id);
          return !y || y.date !== x.date || y.time !== x.time;
        })
        .map((x) => x.id),
    );
    const first = (u.before.stops || []).find((x) => back.has(x.id));
    flash = {
      tripId: live.id,
      until: Date.now() + 10000,
      moved: new Map([...back].map((id) => [id, { date: "", time: "" }])),
      shifted: new Set(),
      scrolled: false,
      undone: true,
    };
    if (first && TripModel.dates(live.start, live.end).includes(first.date)) selectedDate = first.date;
    renderTrip();
    toast("השינוי בוטל — הכל חזר למקום");
  }
  window.TriplySchedule.noteChange = noteChange;

  /* Runs one change of the day plan: re-times the affected days (walking / transit included), saves, redraws.
   * Returns the result so callers can react; shows the outcome in the change bar (with undo). */
  let busy = false;
  async function run(trip, mutate, opts = {}, note) {
    if (busy) return { ok: false, message: "רגע, השינוי הקודם עוד נשמר…" };
    busy = true;
    document.querySelector(".full-day-schedule")?.classList.add("sb-busy");
    try {
      const before = structuredClone(trip);
      const res = await R().commit(trip, mutate, opts);
      if (!res.ok) {
        if (opts.before && trip.dailySchedule?.length) {
          // The trip details were already saved (dates, flights, hotel) but the plan could not follow: mark it out of
          // date, so the "update the plan" button shows up once the day is made to fit.
          trip.scheduleStopSnapshot = "";
          try {
            save();
          } catch {}
        }
        toast(res.message || "לא ניתן לשמור את השינוי");
        renderTrip();
        return res;
      }
      // the places this change was about: the dragged row, the place edited / added / moved to another day
      const primary = new Set(Object.keys(opts.hints || {}));
      if (opts.reorder) {
        const [d, from] = opts.reorder;
        const blk = before.dailySchedule?.find((x) => x.date === d)?.blocks?.[from];
        const st = blk && R().stopForBlock(before, blk, d);
        if (st) primary.add(st.id);
      }
      // opening hours only for the places that moved
      const names = new Set(res.trip.stops.filter((x) => primary.has(x.id)).map((x) => x.name));
      const warn = (res.changed || [])
        .flatMap((d) =>
          L().hourWarnings(
            res.trip.dailySchedule.find((x) => x.date === d),
            res.trip.stops,
          ),
        )
        .filter((w) => !names.size || [...names].some((n) => w.includes(n)));
      const moved = res.trip.stops.find((x) => primary.has(x.id));
      if (opts.goTo) selectedDate = opts.goTo;
      else if (
        moved &&
        moved.date !== selectedDate &&
        TripModel.dates(res.trip.start, res.trip.end).includes(moved.date)
      )
        selectedDate = moved.date;
      closeModal();
      noteChange(
        res.previous || before,
        res.trip,
        primary,
        [...(res.warnings || []), ...warn.map((w) => "שים לב: " + w)][0] || "",
      );
      if (!primary.size && !flash.moved.size && note)
        showBar("✓ " + note, R().summary(res, note).replace(note, "").replace(/^ · /, ""));
      renderTrip();
      if ($('.quick[data-panel="mapPanel"]')?.classList.contains("active")) window.openDayMap?.();
      return res;
    } catch (error) {
      toast(error?.message || "לא ניתן לשמור את השינוי");
      renderTrip();
      return { ok: false, message: error?.message };
    } finally {
      busy = false;
      document.querySelector(".full-day-schedule")?.classList.remove("sb-busy");
    }
  }
  window.TriplySchedule.run = run;

  const previousRender = renderStops;
  renderStops = () => {
    previousRender();
    const trip = currentTrip();
    const day = trip?.dailySchedule?.find((item) => item.date === selectedDate);
    if (!day) return;
    const list = $("#itineraryList");
    if (!list) return;
    const stale = scheduleStale(trip);
    // Flights changed but the landing / airport rows were never updated (e.g. the day did not fit at the time).
    const flightsStale = stale ? null : trip.dailySchedule.find((d) => R().frameStale(trip, d)) || null;
    const section = document.createElement("section");
    section.className = "full-day-schedule";
    section.setAttribute("aria-label", "לוח היום");
    const dayStops = trip.stops.filter((stop) => stop.date === day.date);
    const linked = new Set();
    const stopFor = (block) => {
      if (!block.placeName) return null;
      const byId = block.existingStopId && dayStops.find((stop) => stop.id === block.existingStopId);
      const hit =
        byId ||
        dayStops.find((stop) => norm(stop.name) === norm(block.placeName) && stop.time === block.startTime) ||
        dayStops.find((stop) => norm(stop.name) === norm(block.placeName));
      if (hit) linked.add(hit.id);
      return hit || null;
    };
    const kind = (block) =>
      block.placeName
        ? "sb-place"
        : /^הליכה|\(הליכה/.test(block.activity)
          ? "sb-walk"
          : /תחבורה|מונית|שדה התעופה|נסיעה/.test(block.activity)
            ? "sb-ride"
            : /ארוחת|צהריים|קפה/.test(block.activity)
              ? "sb-meal"
              : "";
    const roles = L().roles(day);
    const grip =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    const lit = flash && flash.tripId === trip.id && flash.until > Date.now() ? flash : null;
    const was = (stop) => {
      if (!lit || !stop || !lit.moved.has(stop.id)) return "";
      const o = lit.moved.get(stop.id);
      const text = lit.undone
        ? "חזר למקום"
        : !o
          ? "חדש"
          : o.date !== stop.date
            ? `עבר מ${R().dayShort(o.date)}`
            : o.time !== stop.time
              ? `היה ${o.time}`
              : "עודכן";
      return `<span class="sb-was">${escapeHTML(text)}</span>`;
    };
    const rows = day.blocks
      .map((block, index) => {
        const stop = stopFor(block);
        const movable = roles[index] === "move";
        const mark =
          stop && lit ? (lit.moved.has(stop.id) ? " sb-moved" : lit.shifted.has(stop.id) ? " sb-shifted" : "") : "";
        return `<li class="schedule-block ${kind(block)}${movable ? " sb-movable" : ""}${mark}" data-idx="${index}" data-role="${roles[index]}">${movable ? `<button type="button" class="sb-handle" data-drag="${index}" aria-label="גרירה של ${escapeHTML(block.activity)} — אפשר גם עם החצים למעלה ולמטה">${grip}</button>` : ""}<button type="button" class="sb-row" data-edit-schedule="${index}"${stop ? ` data-stop="${escapeHTML(stop.id)}"` : ""} aria-label="עריכה: ${escapeHTML(block.activity)}"><time>${escapeHTML(block.startTime)}</time><span class="sb-text"><strong>${escapeHTML(block.activity)}</strong>${block.placeName && !block.activity.includes(block.placeName) ? `<small>${escapeHTML(block.placeName)}</small>` : ""}${was(stop)}</span><span class="sb-end">עד ${escapeHTML(block.endTime)}</span></button></li>`;
      })
      .join("");
    section.innerHTML = `<div class="full-day-heading"><h4>לוח היום</h4><button type="button" class="text-btn" id="editDayTimes">קימה ${escapeHTML(day.wakeTime)} · שינה ${escapeHTML(day.sleepTime)} · שינוי</button></div>
      ${stale || flightsStale ? `<div class="schedule-warning"><p>${stale ? "יש שינויים בטיול שעוד לא נכנסו ללוח." : `שעות הטיסות לא תואמות ללוח של ${escapeHTML(R().dayShort(flightsStale.date))}.`}</p><button type="button" class="small-btn" id="syncSchedule">עדכון הלוח וזמני הדרך עכשיו</button></div>` : ""}
      <ol class="schedule-blocks">${rows}</ol>
      <p class="schedule-caveat">להזזה: לחיצה ארוכה על שורה (או על הנקודות שבצד) וגרירה למעלה או למטה — או אל יום אחר בשורת הימים. לחיצה רגילה פותחת עריכה עם ⬆ להקדים / ⬇ לדחות ובחירת יום. אחרי כל שינוי המקום שזז מסומן, זמני הדרך מחושבים מחדש, ואפשר לבטל. הזמנים ושעות הפתיחה הם הערכה.</p>`;
    section.querySelector("#editDayTimes").onclick = () => editDayTimes(trip, day);
    section
      .querySelector("#syncSchedule")
      ?.addEventListener("click", () => run(trip, null, { allDates: true, refresh: true }, "הלוח עודכן לפי הטיול"));
    section.querySelectorAll("[data-edit-schedule]").forEach(
      (button) =>
        (button.onclick = () => {
          if (Date.now() < clickBlockedUntil) return; // the end of a drag, not a tap
          editScheduleBlock(trip, day, Number(button.dataset.editSchedule), button.dataset.stop || "");
        }),
    );
    // Attractions already shown in the timeline are not listed a second time.
    list.querySelectorAll(".stop").forEach((row) => {
      const id = row.querySelector("[data-edit-stop]")?.dataset.editStop;
      if (id && linked.has(id)) row.remove();
    });
    const extra = list.querySelectorAll(".stop").length;
    if (extra)
      section.insertAdjacentHTML("beforeend", '<h4 class="scheduled-stops-heading">נוספו אחרי שהלוח נבנה</h4>');
    list.querySelector(".empty-state")?.remove();
    list.prepend(section);
    enableDrag(section, trip, day);
    if (lit && !lit.scrolled) {
      const target = section.querySelector(".sb-moved") || section.querySelector(".sb-shifted");
      if (target) {
        lit.scrolled = true;
        setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      }
    }
  };

  /* ---------- Drag & drop inside the day (and onto another day) ---------- */
  // `expect`: the row as it was shown — if a sync changed the day meanwhile, the move is refused instead of moving
  // a different row.
  const shown = (day, idx) => ({ date: day.date, idx, block: day.blocks[idx] || {} });
  const moveWithinDay = (trip, day, fromIdx, toBeforeIdx) =>
    run(trip, null, { reorder: [day.date, fromIdx, toBeforeIdx], expect: shown(day, fromIdx) });
  function moveToDay(trip, day, fromIdx, targetDate) {
    const block = day.blocks[fromIdx];
    const stop = block && R().stopForBlock(trip, block, day.date);
    if (!stop) {
      toast("אפשר להעביר ליום אחר רק מקומות. ארוחות והפסקות נשארות בכל יום.");
      renderStops();
      return;
    }
    if (!trip.dailySchedule.some((x) => x.date === targetDate)) {
      toast('ליום הזה עוד אין לוח. בנה אותו קודם עם "תכנן לי את כל הטיול".');
      renderStops();
      return;
    }
    return run(
      trip,
      (draft) => {
        const st = draft.stops.find((s) => s.id === stop.id);
        if (st) st.date = targetDate;
      },
      { hints: { [stop.id]: "auto" }, goTo: targetDate },
    );
  }
  function movableIndexes(day) {
    const roles = L().roles(day);
    return day.blocks.map((_, i) => i).filter((i) => roles[i] === "move");
  }
  /* Earlier / later by one place in the day (the editor buttons and the keyboard arrows). */
  function step(trip, day, idx, dir) {
    const list = movableIndexes(day);
    const k = list.indexOf(idx);
    const j = k + dir;
    if (k < 0 || j < 0 || j >= list.length) {
      toast(dir < 0 ? "זה כבר הדבר הראשון ביום" : "זה כבר הדבר האחרון ביום");
      return null;
    }
    const before = dir < 0 ? list[j] : list[j + 1] !== undefined ? list[j + 1] : null;
    return moveWithinDay(trip, day, idx, before);
  }
  let clickBlockedUntil = 0;
  function enableDrag(section, trip, day) {
    const list = section.querySelector(".schedule-blocks");
    /* Lifts `li` and follows the finger / mouse: rows make room as it passes, the page scrolls near the edges, and
     * a day pill in the day strip takes it to another day. */
    const startDrag = (e, li) => {
      if (busy) return;
      const pid = e.pointerId;
      const startY = e.clientY,
        startScroll = window.scrollY;
      let moved = false,
        dayTarget = null,
        raf = 0,
        lastX = e.clientX,
        lastY = e.clientY,
        domShift = 0;
      clickBlockedUntil = Date.now() + 60000;
      section.classList.add("sb-dragging");
      li.classList.add("sb-lifted");
      navigator.vibrate?.(12);
      // no page scrolling under the finger while a row is being dragged (touch)
      const noScroll = (ev) => ev.cancelable && ev.preventDefault();
      document.addEventListener("touchmove", noScroll, { passive: false });
      const place = () => {
        li.style.transform = `translateY(${lastY - startY - domShift + (window.scrollY - startScroll)}px)`;
        li.style.pointerEvents = "none";
        const under = document.elementFromPoint(lastX, lastY);
        li.style.pointerEvents = "";
        const pill = under?.closest?.(".day[data-date]");
        document.querySelectorAll(".day.sb-drop-day").forEach((x) => x.classList.remove("sb-drop-day"));
        dayTarget = null;
        if (pill && pill.dataset.date !== day.date) {
          pill.classList.add("sb-drop-day");
          dayTarget = pill.dataset.date;
          return;
        }
        const over = under?.closest?.('li[data-role="move"]');
        if (over && over !== li && list.contains(over)) {
          const r = over.getBoundingClientRect(),
            before = lastY < r.top + r.height / 2;
          const base = li.offsetTop;
          list.insertBefore(li, before ? over : over.nextSibling);
          // keep the lifted row under the finger after the DOM moved
          domShift += li.offsetTop - base;
          li.style.transform = `translateY(${lastY - startY - domShift + (window.scrollY - startScroll)}px)`;
        }
      };
      // The page scrolls only when the finger is held right at the top edge or just above the bottom menu
      // (after a short moment), so a row dropped low on the screen does not run away.
      let zoneSince = 0;
      const autoscroll = () => {
        const top = 64,
          bottom = innerHeight - (document.querySelector(".bottom-nav")?.offsetHeight || 0) - 28;
        const dist = !moved ? 0 : lastY < top ? lastY - top : lastY > bottom ? lastY - bottom : 0;
        if (!dist) zoneSince = 0;
        else if (!zoneSince) zoneSince = performance.now();
        if (dist && performance.now() - zoneSince > 300) {
          window.scrollBy(0, Math.sign(dist) * Math.min(18, 2 + Math.ceil(Math.abs(dist) / 3)));
          place();
        }
        raf = requestAnimationFrame(autoscroll);
      };
      raf = requestAnimationFrame(autoscroll);
      const onMove = (ev) => {
        if (ev.pointerId !== pid) return;
        ev.preventDefault();
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (Math.abs(ev.clientY - startY) > 4) moved = true;
        place();
      };
      const onUp = (ev) => {
        if (ev && ev.pointerId !== pid) return;
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.removeEventListener("touchmove", noScroll);
        clickBlockedUntil = Date.now() + 400; // the tap that ends a drag does not open the editor
        section.classList.remove("sb-dragging");
        li.classList.remove("sb-lifted");
        li.style.transform = "";
        document.querySelectorAll(".day.sb-drop-day").forEach((x) => x.classList.remove("sb-drop-day"));
        if (!moved) {
          renderStops();
          return;
        }
        const from = +li.dataset.idx;
        if (dayTarget) {
          moveToDay(trip, day, from, dayTarget);
          return;
        }
        const seq = [...list.querySelectorAll('li[data-role="move"]')];
        const k = seq.indexOf(li);
        const newOrder = seq.map((x) => +x.dataset.idx);
        if (newOrder.join() === movableIndexes(day).join()) {
          renderStops();
          return;
        }
        const next = seq[k + 1] ? +seq[k + 1].dataset.idx : null;
        moveWithinDay(trip, day, from, next);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    section.querySelectorAll("[data-drag]").forEach((handle) => {
      const li = handle.closest("li");
      handle.addEventListener("keydown", async (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const movable = [...list.querySelectorAll('li[data-role="move"]')];
        const i = movable.indexOf(li);
        const res = await step(trip, day, +li.dataset.idx, e.key === "ArrowUp" ? -1 : 1);
        if (res?.ok)
          setTimeout(() => {
            const again = [...document.querySelectorAll('.schedule-blocks li[data-role="move"]')][
              i + (e.key === "ArrowUp" ? -1 : 1)
            ];
            again?.querySelector("[data-drag]")?.focus();
          }, 80);
      });
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        startDrag(e, li);
      });
    });
    // On a phone: a long press anywhere on a movable row lifts it (a quick swipe still scrolls the page).
    section.querySelectorAll("li.sb-movable > .sb-row").forEach((row) => {
      const li = row.closest("li");
      row.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" || busy) return;
        const x0 = e.clientX,
          y0 = e.clientY,
          pid = e.pointerId;
        let timer = 0;
        const stop = () => {
          clearTimeout(timer);
          row.removeEventListener("pointermove", early);
          row.removeEventListener("pointerup", stop);
          row.removeEventListener("pointercancel", stop);
        };
        const early = (ev) => {
          if (ev.pointerId === pid && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 9) stop(); // scrolling, not a press
        };
        timer = setTimeout(() => {
          stop();
          startDrag({ pointerId: pid, clientX: x0, clientY: y0 }, li);
        }, 380);
        row.addEventListener("pointermove", early);
        row.addEventListener("pointerup", stop);
        row.addEventListener("pointercancel", stop);
      });
      row.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  const minute = (value) => {
    const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const dayOptions = (trip, selected) =>
    TripModel.dates(trip.start, trip.end)
      .map(
        (d, i) =>
          `<option value="${d}"${d === selected ? " selected" : ""}>יום ${i + 1} · ${escapeHTML(R().dayShort(d))}</option>`,
      )
      .join("");
  const moveButtons =
    '<div class="sb-move-row"><button type="button" class="secondary-btn" data-step="-1">⬆ להקדים</button><button type="button" class="secondary-btn" data-step="1">⬇ לדחות</button></div>';

  function editScheduleBlock(trip, day, index, linkedStopId) {
    const original = day.blocks[index];
    if (!original) return;
    const role = L().roleOf(original);
    const stop =
      (linkedStopId && trip.stops.find((s) => s.id === linkedStopId)) || R().stopForBlock(trip, original, day.date);
    const length = minute(original.endTime) - minute(original.startTime);
    const bindSteps = () =>
      $$("[data-step]").forEach(
        (b) =>
          (b.onclick = () => {
            closeModal();
            step(trip, day, index, Number(b.dataset.step));
          }),
      );

    if (role === "travel") {
      openModal(
        `<h2>${escapeHTML(original.activity)}</h2><p>${escapeHTML(original.startTime)}–${escapeHTML(original.endTime)}</p><p>זמן הדרך מחושב אוטומטית לפי המרחק בין המקומות: הליכה עד כחצי שעה, ומעבר לזה תחבורה ציבורית. הוא מתעדכן לבד בכל פעם שמזיזים, מוסיפים או מוחקים מקום.</p><p class="muted">לזמן מדויק לפי השעה והתחבורה בפועל — "הוראות ב-Google Maps" בלשונית המפה.</p>`,
      );
      return;
    }
    if (role === "slack") {
      openModal(
        `<h2>${escapeHTML(original.activity)}</h2><p>${escapeHTML(original.startTime)}–${escapeHTML(original.endTime)}</p><p>זה הזמן שנשאר עד השינה. הוא מתקצר או מתארך לבד כשמוסיפים או מורידים דברים ביום.</p><button type="button" class="primary-btn" id="openDayTimes">שינוי שעת הקימה או השינה</button>`,
      );
      $("#openDayTimes").onclick = () => editDayTimes(trip, day);
      return;
    }
    if (stop) {
      openModal(
        `<h2>עריכת ביקור</h2><form id="scheduleBlockForm"><div class="field"><label for="schedulePlace">המקום</label><input id="schedulePlace" maxlength="160" required value="${escapeHTML(stop.name)}"></div><div class="field"><label for="scheduleDay">יום</label><select id="scheduleDay">${dayOptions(trip, day.date)}</select></div><div class="field-grid"><div class="field"><label for="scheduleStart">שעת התחלה</label><input id="scheduleStart" type="time" required value="${escapeHTML(original.startTime)}"></div><div class="field"><label for="scheduleLength">משך (דקות)</label><input id="scheduleLength" type="number" inputmode="numeric" min="5" max="1440" step="5" required value="${length}"></div></div>${moveButtons}<p class="muted">אחרי השמירה היום מסתדר מחדש: זמני ההליכה והנסיעה מחושבים לפי הסדר החדש.</p><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button><button type="button" class="secondary-btn" id="scheduleStopDetails">פרטי המקום: מפה, הערות ומחיקה</button></form>`,
      );
      bindSteps();
      $("#scheduleStopDetails").onclick = () => {
        closeModal();
        (window.editStop || editStop)(stop.id);
      };
      $("#scheduleBlockForm").onsubmit = async (event) => {
        event.preventDefault();
        const name = $("#schedulePlace").value.trim(),
          date = $("#scheduleDay").value,
          start = minute($("#scheduleStart").value),
          len = Math.round(Number($("#scheduleLength").value));
        if (!name || start === null || !Number.isFinite(len) || len < 5 || len > 1440) {
          $("#scheduleEditError").textContent = "בדוק את שם המקום, השעה והמשך (5–1440 דקות).";
          return;
        }
        const timeChanged = $("#scheduleStart").value !== original.startTime;
        const renamed = norm(name) !== norm(stop.name);
        const hint = date !== day.date ? (timeChanged ? "time" : "auto") : timeChanged ? "time" : "keep";
        const res = await run(
          trip,
          (draft) => {
            const st = draft.stops.find((s) => s.id === stop.id);
            if (!st) throw Error("המקום לא נמצא בטיול");
            if (renamed) {
              st.name = name;
              // A different place: its pin is looked up again so the walk to it is right.
              delete st.lat;
              delete st.lng;
              delete st.placeId;
            }
            st.date = date;
            st.time = $("#scheduleStart").value;
            st.duration = len;
          },
          { hints: { [stop.id]: hint }, goTo: date },
          renamed ? "המקום עודכן" : "הביקור עודכן",
        );
        if (!res.ok && $("#scheduleEditError")) $("#scheduleEditError").textContent = res.message || "";
      };
      return;
    }
    if (role === "fixed") {
      openModal(
        `<h2>עריכת מקטע בלוח</h2><form id="scheduleBlockForm"><p><b>${escapeHTML(original.activity)}</b></p><div class="field-grid"><div class="field"><label for="scheduleStart">התחלה</label><input id="scheduleStart" type="time" required value="${escapeHTML(original.startTime)}"></div><div class="field"><label for="scheduleEnd">סיום</label><input id="scheduleEnd" type="time" required value="${escapeHTML(original.endTime)}"></div></div><p class="muted">שאר היום יסתדר מחדש לפי השעות החדשות.</p><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button></form>`,
      );
      $("#scheduleBlockForm").onsubmit = async (event) => {
        event.preventDefault();
        const s = minute($("#scheduleStart").value),
          e = minute($("#scheduleEnd").value);
        if (s === null || e === null || e <= s) {
          $("#scheduleEditError").textContent = "שעת הסיום חייבת להיות אחרי ההתחלה.";
          return;
        }
        const res = await run(trip, null, {
          transform: (draft) => R().editFixed(draft, day.date, index, s, e),
          expect: shown(day, index),
        });
        if (!res.ok && $("#scheduleEditError")) $("#scheduleEditError").textContent = res.message || "";
      };
      return;
    }
    // A meal, a break or free time.
    openModal(
      `<h2>עריכת מקטע בלוח</h2><form id="scheduleBlockForm"><div class="field"><label for="scheduleActivity">מה עושים?</label><input id="scheduleActivity" maxlength="240" required value="${escapeHTML(original.activity)}"></div><div class="field-grid"><div class="field"><label for="scheduleStart">שעת התחלה</label><input id="scheduleStart" type="time" required value="${escapeHTML(original.startTime)}"></div><div class="field"><label for="scheduleLength">משך (דקות)</label><input id="scheduleLength" type="number" inputmode="numeric" min="5" max="600" step="5" required value="${length}"></div></div>${moveButtons}<div class="field"><label for="schedulePlace">רוצה שזה יהיה ביקור במקום מסוים? (לא חובה)</label><input id="schedulePlace" maxlength="160" placeholder="למשל: Borough Market"><small>מקום שתכתוב כאן יופיע גם במפה ויחושב אליו זמן הליכה או נסיעה.</small></div><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button></form>`,
    );
    bindSteps();
    $("#scheduleBlockForm").onsubmit = async (event) => {
      event.preventDefault();
      const activity = $("#scheduleActivity").value.trim(),
        start = minute($("#scheduleStart").value),
        len = Math.round(Number($("#scheduleLength").value)),
        placeName = $("#schedulePlace").value.trim();
      if (!activity || start === null || !Number.isFinite(len) || len < 5 || len > 600) {
        $("#scheduleEditError").textContent = "בדוק את הפעילות, השעה והמשך.";
        return;
      }
      // Rows named like a walk / ride ("הליכה…", "נסיעה ב…", "חזרה ללינה") are computed by the app and redrawn on every
      // change — a row the traveller writes must not look like one, or it would disappear.
      if (!placeName && L().roleOf({ activity, placeName: "" }) === "travel" && activity !== original.activity) {
        $("#scheduleEditError").textContent =
          "שורות שמתחילות ב'הליכה', 'נסיעה' או 'חזרה ללינה' מחושבות לבד בלוח. נסח אחרת, למשל: 'טיול רגלי לאורך התמזה'.";
        return;
      }
      let res;
      if (placeName) {
        // The row becomes a real place: it is added as a stop and placed at that time; the old row goes away.
        const id = crypto.randomUUID();
        res = await run(
          trip,
          (draft) => {
            const d = draft.dailySchedule.find((x) => x.date === day.date);
            d.blocks.splice(index, 1, {
              ...d.blocks[index],
              activity: "ביקור: " + placeName,
              placeName,
              existingStopId: id,
            });
            draft.stops.push({
              id,
              name: placeName,
              date: day.date,
              time: $("#scheduleStart").value,
              duration: len,
              notes: activity !== original.activity ? activity : "",
            });
          },
          { hints: { [id]: "time" }, expect: shown(day, index) },
          "המקום נוסף ללוח",
        );
      } else
        res = await run(trip, null, {
          transform: (draft) => R().retimeItem(draft, day.date, index, { activity, start, dur: len }),
          expect: shown(day, index),
        });
      if (!res.ok && $("#scheduleEditError")) $("#scheduleEditError").textContent = res.message || "";
    };
  }
  function editDayTimes(trip, day) {
    const head = L().split(day).head;
    const wakeRow = head.find((h) => /^קימה/.test(h.activity));
    const wakeValue = wakeRow ? wakeRow.startTime : day.wakeTime;
    openModal(
      `<h2>שעת קימה ושינה</h2><form id="dayTimesForm"><div class="field-grid"><div class="field"><label for="dayWake">קימה</label><input id="dayWake" type="time" required value="${escapeHTML(wakeValue)}"></div><div class="field"><label for="daySleep">שינה</label><input id="daySleep" type="time" required value="${escapeHTML(day.sleepTime)}"></div></div><p class="muted">שאר היום יסתדר מחדש לפי השעות החדשות. הולכים לישון אחרי חצות? בחר 23:59.</p><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button></form>`,
    );
    $("#dayTimesForm").onsubmit = async (event) => {
      event.preventDefault();
      const wake = minute($("#dayWake").value),
        sleep = minute($("#daySleep").value);
      if (wake === null || sleep === null || sleep <= wake) {
        $("#scheduleEditError").textContent = "שעת השינה חייבת להיות אחרי שעת הקימה.";
        return;
      }
      const res = await run(
        trip,
        null,
        { transform: (draft) => R().setDayTimes(draft, day.date, wake, sleep) },
        "שעות היום עודכנו",
      );
      if (!res.ok && $("#scheduleEditError")) $("#scheduleEditError").textContent = res.message || "";
    };
  }
})();
