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

  /* Runs one change of the day plan: re-times the affected days (walking / transit included), saves, redraws.
   * Returns the result so callers can react; shows the outcome in a toast. */
  let busy = false;
  async function run(trip, mutate, opts = {}, note) {
    if (busy) return { ok: false, message: "רגע, השינוי הקודם עוד נשמר…" };
    busy = true;
    document.querySelector(".full-day-schedule")?.classList.add("sb-busy");
    try {
      const res = await R().commit(trip, mutate, opts);
      if (!res.ok) {
        toast(res.message || "לא ניתן לשמור את השינוי");
        renderTrip();
        return res;
      }
      if (opts.goTo) selectedDate = opts.goTo;
      closeModal();
      renderTrip();
      if ($('.quick[data-panel="mapPanel"]')?.classList.contains("active")) window.openDayMap?.();
      const warn = (res.changed || []).flatMap((d) =>
        L().hourWarnings(
          res.trip.dailySchedule.find((x) => x.date === d),
          res.trip.stops,
        ),
      );
      const text = R().summary(res, note || "הלוח עודכן");
      setTimeout(() => toast(warn.length ? `${text} · שים לב: ${warn[0]}` : text), 60);
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
    const rows = day.blocks
      .map((block, index) => {
        const stop = stopFor(block);
        const movable = roles[index] === "move";
        return `<li class="schedule-block ${kind(block)}${movable ? " sb-movable" : ""}" data-idx="${index}" data-role="${roles[index]}">${movable ? `<button type="button" class="sb-handle" data-drag="${index}" aria-label="גרירה של ${escapeHTML(block.activity)} — אפשר גם עם החצים למעלה ולמטה">${grip}</button>` : ""}<button type="button" class="sb-row" data-edit-schedule="${index}"${stop ? ` data-stop="${escapeHTML(stop.id)}"` : ""} aria-label="עריכה: ${escapeHTML(block.activity)}"><time>${escapeHTML(block.startTime)}</time><span class="sb-text"><strong>${escapeHTML(block.activity)}</strong>${block.placeName && !block.activity.includes(block.placeName) ? `<small>${escapeHTML(block.placeName)}</small>` : ""}</span><span class="sb-end">עד ${escapeHTML(block.endTime)}</span></button></li>`;
      })
      .join("");
    section.innerHTML = `<div class="full-day-heading"><h4>לוח היום</h4><button type="button" class="text-btn" id="editDayTimes">קימה ${escapeHTML(day.wakeTime)} · שינה ${escapeHTML(day.sleepTime)} · שינוי</button></div>
      ${stale ? '<div class="schedule-warning"><p>יש שינויים במקומות שעוד לא נכנסו ללוח.</p><button type="button" class="small-btn" id="syncSchedule">עדכון הלוח וזמני הדרך עכשיו</button></div>' : ""}
      <ol class="schedule-blocks">${rows}</ol>
      <p class="schedule-caveat">גוררים שורה בעזרת הנקודות שבצד כדי להקדים או לאחר אותה, או מקום אל יום אחר בשורת הימים. לחיצה על שורה פותחת עריכה (גם להעברה ליום אחר). זמני ההליכה והנסיעה מחושבים מחדש אחרי כל שינוי; הם ושעות הפתיחה הם הערכה.</p>`;
    section.querySelector("#editDayTimes").onclick = () => editDayTimes(trip, day);
    section
      .querySelector("#syncSchedule")
      ?.addEventListener("click", () => run(trip, null, { allDates: true }, "הלוח עודכן לפי המקומות"));
    section
      .querySelectorAll("[data-edit-schedule]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            editScheduleBlock(trip, day, Number(button.dataset.editSchedule), button.dataset.stop || "")),
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
  };

  /* ---------- Drag & drop inside the day (and onto another day) ---------- */
  const moveWithinDay = (trip, day, fromIdx, toBeforeIdx) =>
    run(trip, null, { reorder: [day.date, fromIdx, toBeforeIdx] });
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
  function enableDrag(section, trip, day) {
    const list = section.querySelector(".schedule-blocks");
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
        if (busy) return;
        e.preventDefault();
        const pid = e.pointerId;
        const startY = e.clientY;
        let moved = false,
          dayTarget = null,
          raf = 0,
          lastY = e.clientY,
          domShift = 0;
        section.classList.add("sb-dragging");
        li.classList.add("sb-lifted");
        const autoscroll = () => {
          const edge = 70;
          const y = lastY;
          if (moved && y < edge) window.scrollBy(0, -14);
          else if (moved && y > innerHeight - edge) window.scrollBy(0, 14);
          raf = requestAnimationFrame(autoscroll);
        };
        raf = requestAnimationFrame(autoscroll);
        const onMove = (ev) => {
          if (ev.pointerId !== pid) return;
          ev.preventDefault();
          lastY = ev.clientY;
          if (Math.abs(ev.clientY - startY) > 4) moved = true;
          li.style.transform = `translateY(${ev.clientY - startY - domShift}px)`;
          li.style.pointerEvents = "none";
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
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
              before = ev.clientY < r.top + r.height / 2;
            const base = li.offsetTop;
            list.insertBefore(li, before ? over : over.nextSibling);
            // keep the lifted row under the finger after the DOM moved
            domShift += li.offsetTop - base;
            li.style.transform = `translateY(${ev.clientY - startY - domShift}px)`;
          }
        };
        const onUp = (ev) => {
          if (ev && ev.pointerId !== pid) return;
          cancelAnimationFrame(raf);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          section.classList.remove("sb-dragging");
          li.classList.remove("sb-lifted");
          li.style.transform = "";
          document.querySelectorAll(".day.sb-drop-day").forEach((x) => x.classList.remove("sb-drop-day"));
          if (!moved) return;
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
      });
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
        `<h2>עריכת ביקור</h2><form id="scheduleBlockForm"><div class="field"><label for="schedulePlace">המקום</label><input id="schedulePlace" maxlength="160" required value="${escapeHTML(stop.name)}"></div><div class="field"><label for="scheduleDay">יום</label><select id="scheduleDay">${dayOptions(trip, day.date)}</select></div><div class="field-grid"><div class="field"><label for="scheduleStart">שעת התחלה</label><input id="scheduleStart" type="time" required value="${escapeHTML(original.startTime)}"></div><div class="field"><label for="scheduleLength">משך (דקות)</label><input id="scheduleLength" type="number" inputmode="numeric" min="10" max="600" step="5" required value="${length}"></div></div>${moveButtons}<p class="muted">אחרי השמירה היום מסתדר מחדש: זמני ההליכה והנסיעה מחושבים לפי הסדר החדש.</p><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button><button type="button" class="secondary-btn" id="scheduleStopDetails">פרטי המקום: מפה, הערות ומחיקה</button></form>`,
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
        if (!name || start === null || !Number.isFinite(len) || len < 10 || len > 600) {
          $("#scheduleEditError").textContent = "בדוק את שם המקום, השעה והמשך (10–600 דקות).";
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
        const res = await run(trip, null, { transform: (draft) => R().editFixed(draft, day.date, index, s, e) });
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
          { hints: { [id]: "time" } },
          "המקום נוסף ללוח",
        );
      } else
        res = await run(trip, null, {
          transform: (draft) => R().retimeItem(draft, day.date, index, { activity, start, dur: len }),
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
