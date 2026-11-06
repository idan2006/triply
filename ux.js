(function () {
  "use strict";
  // Trip actions live in one "⋯" menu instead of a row of buttons at the bottom of the page.
  const more = $(".trip-head>.icon-btn");
  if (more) {
    more.setAttribute("aria-label", "עוד פעולות לטיול");
    more.onclick = () => {
      const t = currentTrip();
      if (!t) return;
      openModal(`<h2>${escapeHTML(t.city)}</h2><div class="action-sheet">
        <button type="button" data-act="edit">עריכת פרטי הטיול<small>יעד, תאריכים, נוסעים, מלון ותקציב</small></button>
        <button type="button" data-act="hotels">ערים ומלונות<small>טיול בכמה ערים או כמה מלונות</small></button>
        <button type="button" data-act="export">ייצוא המסלול וההוצאות<small>קובץ לגיבוי או לשיתוף</small></button>
        <button type="button" data-act="archive">${t.archived ? "החזרה מהארכיון" : "העברה לארכיון"}<small>${t.archived ? "הטיול יחזור לרשימה הראשית" : "הטיול יוסתר מהרשימה הראשית"}</small></button>
        <button type="button" data-act="delete" class="danger">מחיקת הטיול<small>אי אפשר לשחזר אחרי מחיקה</small></button></div>`);
      const run = {
        edit: () => {
          closeModal();
          tripForm(true);
        },
        hotels: () => {
          closeModal();
          window.openHotelsEditor();
        },
        export: () => {
          closeModal();
          $("#exportTripBtn")?.click();
        },
        archive: () => {
          closeModal();
          $("#archiveTripBtn")?.click();
        },
        delete: () => {
          closeModal();
          $("#deleteTripBtn")?.click();
        },
      };
      $$(".action-sheet [data-act]").forEach((b) => (b.onclick = () => run[b.dataset.act]()));
    };
  }
})();

// ---- "Today on the trip": open on today's day and show what's now / next ----
(function () {
  "use strict";
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const nowMin = () => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  const toMin = (v) => {
    const m = String(v || "").match(/^(\d{1,2}):(\d{2})/);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const onTrip = (t) => t && !t.archived && t.start <= today() && today() <= t.end;
  // A walk / ride between places (not e.g. "landing and the ride to the hotel", which is its own step).
  const isMove = (b) =>
    !b.placeName &&
    (window.TriplyDayLayout
      ? window.TriplyDayLayout.roleOf(b) === "travel"
      : /^הליכה|^נסיעה בתחבורה|^נסיעה במונית|^חזרה ללינה/.test(b.activity));
  function nowNext(t) {
    const day = t.dailySchedule?.find((d) => d.date === today());
    if (day?.blocks?.length) {
      const n = nowMin(),
        blocks = day.blocks;
      let i = blocks.findIndex((b) => toMin(b.startTime) <= n && n < toMin(b.endTime));
      const cur = i >= 0 ? blocks[i] : null;
      const next = blocks
        .slice(i >= 0 ? i + 1 : 0)
        .find((b) => toMin(b.startTime) >= (cur ? toMin(cur.startTime) : n) && !isMove(b) && b !== cur);
      const move =
        cur && isMove(cur)
          ? cur
          : blocks.slice(i + 1).find((b) => isMove(b) && next && toMin(b.startTime) < toMin(next.startTime));
      // Where to navigate: the next place still ahead (not the one we are standing in).
      const after = i >= 0 ? blocks.slice(i + 1) : blocks.filter((b) => toMin(b.startTime) >= n);
      const goal = after.find((b) => b.placeName) || null;
      const flewHome = blocks.some((b) => /המראה|טיסה הביתה/.test(b.activity) && toMin(b.startTime) <= n);
      const bedtime = n >= toMin(day.sleepTime);
      return { cur, next, move, goal, done: !cur && !next, flewHome, bedtime };
    }
    const stops = t.stops.filter((s) => s.date === today()).sort((a, b) => a.time.localeCompare(b.time)),
      n = nowMin();
    const cur = stops.find((s) => toMin(s.time) <= n && n < toMin(s.time) + Number(s.duration || 60));
    const next = stops.find((s) => toMin(s.time) > n);
    const asBlock = (s) => s && { activity: s.name, placeName: s.name, startTime: s.time, endTime: "" };
    return { cur: asBlock(cur), next: asBlock(next), done: !cur && !next && stops.length > 0 };
  }
  const place = (b) => b?.placeName || "";
  const label = (b) => String(b?.activity || "").replace(/^ביקור:\s*/, "");
  function navUrl(t, b) {
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1");
    u.searchParams.set("destination", `${place(b) || b.activity}, ${t.city}`);
    u.searchParams.set("travelmode", "walking");
    return u.toString();
  }
  function card(t) {
    const { cur, next, done, goal, flewHome, bedtime } = nowNext(t);
    const dayNo = TripModel.dates(t.start, t.end).indexOf(today()) + 1;
    const nowLine = cur
      ? `<div class="today-now"><span>עכשיו</span><b>${escapeHTML(label(cur))}</b>${cur.endTime ? `<small>עד ${escapeHTML(cur.endTime)}</small>` : ""}</div>`
      : "";
    const nextLine = next
      ? `<div class="today-next"><span>הבא</span><b>${escapeHTML(label(next))}</b><small>ב-${escapeHTML(next.startTime)}</small></div>`
      : "";
    const target = goal !== undefined ? goal : next && place(next) ? next : cur && place(cur) ? cur : null;
    const doneText = flewHome
      ? "נסיעה טובה הביתה! ✈"
      : bedtime
        ? "לילה טוב! התוכנית של מחר מחכה ביום הבא."
        : "סיימתם את התוכנית של היום. ערב חופשי!";
    return `<section class="today-card" aria-label="היום בטיול"><div class="today-kicker">היום בטיול · יום ${dayNo}</div>${nowLine}${nextLine}${done ? `<p class="today-done">${doneText}</p>` : ""}${!cur && !next && !done ? '<p class="today-done">אין עדיין תוכנית להיום. לחץ על "תכנן לי את כל הטיול".</p>' : ""}${target ? `<a class="today-nav" href="${escapeHTML(navUrl(t, target))}" target="_blank" rel="noopener">ניווט אל ${escapeHTML(place(target))}</a>` : ""}</section>`;
  }
  const prevSelect = selectTrip;
  selectTrip = function (id) {
    prevSelect(id);
    const t = currentTrip();
    if (onTrip(t) && selectedDate !== today()) {
      selectedDate = today();
      renderTrip();
    }
  };
  const prevStops = renderStops;
  renderStops = () => {
    prevStops();
    const t = currentTrip();
    if (!onTrip(t) || selectedDate !== today()) return;
    const list = $("#itineraryList");
    list?.insertAdjacentHTML("afterbegin", card(t));
  };
  const prevTrips = renderTrips;
  renderTrips = () => {
    prevTrips();
    const t = state.trips.find(onTrip);
    const hero = $(".hero-card");
    if (!hero) return;
    hero.classList.toggle("is-today", Boolean(t));
    if (!t) return;
    const { cur, next } = nowNext(t);
    hero.hidden = false;
    $(".hero-kicker").textContent = "היום בטיול";
    $(".hero-card h2").textContent = t.city;
    $(".hero-card p").textContent = cur
      ? `עכשיו: ${label(cur)}${next ? ` · הבא: ${label(next)} ב-${next.startTime}` : ""}`
      : next
        ? `הבא: ${label(next)} ב-${next.startTime}`
        : "אין עוד תוכנית להיום";
    $(".hero-card button").textContent = "לתוכנית של היום ←";
    $(".hero-card button").onclick = () => selectTrip(t.id);
  };
  renderTrips();
  setInterval(() => {
    if (!document.hidden && $("#homeView.active")) renderTrips();
  }, 60000);
})();

// ---- Weather per day (Open-Meteo, free, no key). Forecast exists ~16 days ahead. ----
(function () {
  "use strict";
  const mem = new Map();
  const ymd = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const store = {
    get(k) {
      try {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        return v && v.exp > Date.now() ? v.data : null;
      } catch {
        return null;
      }
    },
    set(k, data, ms) {
      try {
        localStorage.setItem(k, JSON.stringify({ exp: Date.now() + ms, data }));
      } catch {}
    },
  };
  async function coords(city) {
    const key = "triply:geo:" + city.trim().toLowerCase();
    const hit = store.get(key);
    if (hit) return hit;
    let p = null;
    try {
      const r = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?count=1&language=he&name=" + encodeURIComponent(city),
      );
      const j = await r.json();
      const g = j?.results?.[0];
      if (g) p = { lat: g.latitude, lng: g.longitude };
    } catch {}
    if (!p) {
      try {
        const r = await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(city));
        const j = await r.json();
        const c = j?.features?.[0]?.geometry?.coordinates;
        if (c) p = { lat: c[1], lng: c[0] };
      } catch {}
    }
    if (p) store.set(key, p, 30 * 86400000);
    return p;
  }
  async function forecast(t) {
    const today = ymd(new Date()),
      last = ymd(new Date(Date.now() + 15 * 86400000));
    if (t.end < today) return { past: true };
    if (t.start > last) return { tooFar: true };
    const from = t.start > today ? t.start : today,
      to = t.end < last ? t.end : last,
      key = `triply:wx:${t.city}:${from}:${to}`;
    if (mem.has(key)) return mem.get(key);
    const cached = store.get(key);
    if (cached) {
      mem.set(key, cached);
      return cached;
    }
    const p = await coords(t.city);
    if (!p) return null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${from}&end_date=${to}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const d = j.daily || {},
      days = {};
    (d.time || []).forEach(
      (date, i) =>
        (days[date] = {
          code: d.weather_code[i],
          max: Math.round(d.temperature_2m_max[i]),
          min: Math.round(d.temperature_2m_min[i]),
          rain:
            Number.isFinite(Number(d.precipitation_probability_max?.[i])) &&
            d.precipitation_probability_max?.[i] !== null
              ? Number(d.precipitation_probability_max[i])
              : null,
        }),
    );
    const out = { days };
    mem.set(key, out);
    store.set(key, out, 3 * 3600000);
    return out;
  }
  const kind = (c) =>
    c <= 1
      ? "sun"
      : c <= 3
        ? "cloud"
        : c <= 48
          ? "fog"
          : c <= 67 || (c >= 80 && c <= 82)
            ? "rain"
            : c <= 77 || c === 85 || c === 86
              ? "snow"
              : "storm";
  const names = { sun: "בהיר", cloud: "מעונן חלקית", fog: "ערפל", rain: "גשם", snow: "שלג", storm: "סופת רעמים" };
  const paths = {
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    cloud: "M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
    fog: "M4 10h16M4 14h16M6 18h12M8 6h8",
    rain: "M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2",
    snow: "M20 17.6A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16.3M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01",
    storm: "M19 16.9A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M13 11l-4 6h6l-4 6",
  };
  const icon = (k) =>
    `<svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k]}"/></svg>`;
  let token = 0;
  async function paint() {
    const t = currentTrip();
    if (!t) return;
    const my = ++token;
    let wx = null;
    try {
      wx = await forecast(t);
    } catch {}
    if (my !== token || currentTrip()?.id !== t.id) return;
    $$(".day[data-date]").forEach((b) => {
      b.querySelector(".wx")?.remove();
      const w = wx?.days?.[b.dataset.date];
      if (w) b.insertAdjacentHTML("beforeend", `<span class="wx">${icon(kind(w.code))}${Number(w.max) || 0}°</span>`);
    });
    $(".wx-line")?.remove();
    const title = $(".day-title>div");
    if (!title) return;
    const w = wx?.days?.[selectedDate];
    if (w) {
      const k = kind(w.code),
        wet = (w.rain ?? 0) >= 60 || k === "rain" || k === "storm" || k === "snow";
      title.insertAdjacentHTML(
        "beforeend",
        `<p class="wx-line ${wet ? "wet" : ""}">${icon(k)}<span>${names[k]} · ${Number(w.max) || 0}°/${Number(w.min) || 0}°${w.rain != null && Number.isFinite(Number(w.rain)) ? ` · ${Number(w.rain)}% גשם` : ""}</span></p>${wet ? '<p class="wx-line wx-tip wet">צפוי גשם — כדאי לבקש מהצ׳אט להעביר ליום הזה מוזיאונים ומקומות מקורים.</p>' : ""}`,
      );
    } else if (wx?.tooFar)
      title.insertAdjacentHTML("beforeend", '<p class="wx-line">תחזית מזג האוויר תופיע כשבועיים לפני הטיול.</p>');
  }
  const prevTrip = renderTrip;
  renderTrip = function () {
    prevTrip.apply(this, arguments);
    void paint();
  };
})();

// ---- Cities & hotels editor (trips with several hotels / cities) ----
(function () {
  "use strict";
  const iso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const dayAfter = (d, n = 1) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  window.openHotelsEditor = function () {
    const t = currentTrip();
    if (!t) return;
    let rows = (t.travelDetails?.hotels || []).map((h) => ({
      name: h.name || "",
      city: h.city || "",
      checkIn: h.checkIn || "",
      checkOut: h.checkOut || "",
    }));
    if (!rows.length) rows = [{ name: t.hotel || "", city: t.city, checkIn: t.start, checkOut: t.end }];
    const draw = () => {
      openModal(
        `<h2>ערים ומלונות</h2><p>טיול בכמה ערים או כמה מלונות? הוסף כל מלון עם התאריכים שלו, והתכנון יבנה כל יום מהמלון של אותו לילה.</p><form id="hotelsForm">${rows.map((r, i) => `<fieldset class="hotel-row"><legend>מלון ${i + 1}</legend><div class="field-grid"><div class="field"><label for="hc${i}">עיר</label><input id="hc${i}" value="${escapeHTML(r.city)}" maxlength="120" required></div><div class="field"><label for="hn${i}">שם המלון</label><input id="hn${i}" value="${escapeHTML(r.name)}" maxlength="160"></div></div><div class="field-grid"><div class="field"><label for="hi${i}">צ'ק-אין</label><input id="hi${i}" type="date" min="${t.start}" max="${t.end}" value="${escapeHTML(r.checkIn)}" required></div><div class="field"><label for="ho${i}">צ'ק-אאוט</label><input id="ho${i}" type="date" min="${t.start}" max="${dayAfter(t.end)}" value="${escapeHTML(r.checkOut)}" required></div></div>${rows.length > 1 ? `<button type="button" class="text-btn" data-del-hotel="${i}">הסרת המלון</button>` : ""}</fieldset>`).join("")}<button type="button" class="secondary-btn" id="addHotelRow">＋ עוד עיר או מלון</button><p id="hotelsError" role="alert"></p><button class="primary-btn">שמירה</button></form>`,
      );
      const read = () =>
        (rows = rows.map((_, i) => ({
          city: $("#hc" + i).value.trim(),
          name: $("#hn" + i).value.trim(),
          checkIn: $("#hi" + i).value,
          checkOut: $("#ho" + i).value,
        })));
      $("#addHotelRow").onclick = () => {
        read();
        const last = rows.at(-1);
        let checkIn = last?.checkOut && last.checkOut < t.end ? last.checkOut : "";
        if (!checkIn && last?.checkIn && last.checkIn < t.end) {
          // The previous hotel ran to the end: split its nights in two, so both rows are valid at once.
          const nights = Math.round((Date.parse(t.end) - Date.parse(last.checkIn)) / 86400000);
          checkIn = dayAfter(last.checkIn, Math.max(1, Math.floor(nights / 2)));
          last.checkOut = checkIn;
        }
        rows.push({
          city: last?.city || "",
          name: "",
          checkIn: checkIn || t.start,
          checkOut: t.end > (checkIn || t.start) ? t.end : dayAfter(t.end),
        });
        draw();
      };
      $$("[data-del-hotel]").forEach(
        (b) =>
          (b.onclick = () => {
            read();
            rows.splice(+b.dataset.delHotel, 1);
            draw();
          }),
      );
      $("#hotelsForm").onsubmit = (e) => {
        e.preventDefault();
        read();
        const bad = rows.find((r) => !r.city || !iso(r.checkIn) || !iso(r.checkOut) || r.checkOut <= r.checkIn);
        if (bad) {
          $("#hotelsError").textContent = "לכל מלון צריך עיר, וצ'ק-אאוט אחרי הצ'ק-אין.";
          return;
        }
        rows.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
        for (let i = 1; i < rows.length; i++)
          if (rows[i].checkIn < rows[i - 1].checkOut) {
            $("#hotelsError").textContent = "התאריכים של שני מלונות חופפים. בדוק את הצ'ק-אין והצ'ק-אאוט.";
            return;
          }
        const before = structuredClone(t.travelDetails || {}),
          beforeHotel = t.hotel,
          beforeTrip = structuredClone(t);
        const key = (list) =>
          JSON.stringify(
            (list || []).map((h) => [
              String(h.name || "")
                .trim()
                .toLowerCase(),
              h.city || "",
              h.checkIn,
              h.checkOut,
            ]),
          );
        // The same hotels saved again keep their map points (nothing to look up or re-time).
        const changed = key(rows) !== key(before.hotels) || (rows[0].name && rows[0].name !== t.hotel);
        t.travelDetails = {
          ...(t.travelDetails || {}),
          hotels: rows,
          ...(changed ? { lodgingPoints: undefined } : {}), // looked up again from the new hotels
          hotelCheckIn: rows[0].checkIn,
          hotelCheckOut: rows.at(-1).checkOut,
        };
        if (rows[0].name) t.hotel = rows[0].name;
        try {
          save();
          closeModal();
          renderTrip();
          // With a day plan, the days whose hotel changed are re-timed to start and end at that night's hotel.
          if (changed && t.dailySchedule?.length && window.TriplySchedule?.run)
            window.TriplySchedule.run(
              t,
              null,
              { before: beforeTrip },
              rows.length > 1
                ? `נשמרו ${rows.length} מלונות — כל יום מתחיל ונגמר במלון של אותו לילה`
                : "המלון נשמר, וזמני הדרך חושבו מחדש",
            );
          else toast(rows.length > 1 ? `נשמרו ${rows.length} מלונות` : "המלון נשמר");
        } catch {
          t.travelDetails = before;
          t.hotel = beforeHotel;
          $("#hotelsError").textContent = "השמירה נכשלה";
        }
      };
    };
    draw();
  };
})();

// ---- Import trips from a backup file (e.g. the old chatgpt.site version: Settings → "הורדת גיבוי טיולים") ----
(function () {
  "use strict";
  function pickFile() {
    return new Promise((res) => {
      const i = document.createElement("input");
      i.type = "file";
      i.accept = ".json,application/json";
      i.onchange = () => res(i.files[0] || null);
      i.click();
    });
  }
  window.importTripsFromFile = async function () {
    const file = await pickFile();
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast("הקובץ גדול מדי");
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast("זה לא קובץ גיבוי של Tropi Trip (JSON לא תקין)");
      return;
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.trips) ? data.trips : null;
    if (!list) {
      toast("לא מצאתי טיולים בקובץ הזה");
      return;
    }
    const ok = [];
    let bad = 0;
    for (const raw of list) {
      try {
        const t = TripModel.trip(raw);
        if (t.id && t.city) ok.push(t);
        else bad++;
      } catch {
        bad++;
      }
    }
    if (!ok.length) {
      toast("לא הצלחתי לקרוא אף טיול מהקובץ");
      return;
    }
    const have = new Map(state.trips.map((t) => [t.id, t]));
    const fresh = ok.filter((t) => !have.has(t.id)),
      same = ok.filter((t) => have.has(t.id));
    let replace = false;
    if (same.length)
      replace = confirm(
        `${same.length} מהטיולים בקובץ כבר קיימים כאן. להחליף אותם בגרסה מהקובץ? (ביטול = להשאיר את מה שיש)`,
      );
    const before = state.trips;
    state.trips = [...fresh, ...state.trips.map((t) => (replace && same.find((x) => x.id === t.id)) || t)];
    try {
      save();
    } catch {
      state.trips = before;
      toast("השמירה נכשלה — ייתכן שאין מקום בדפדפן");
      return;
    }
    // Preferences and saved places from the backup fill in what this device does not have yet.
    try {
      if (data?.preferences && typeof data.preferences === "object" && typeof preferences === "object") {
        for (const [k, v] of Object.entries(data.preferences))
          if (v !== undefined && v !== null && v !== "" && (preferences[k] === undefined || preferences[k] === ""))
            preferences[k] = v;
        localStorage.setItem(profileStorageKey("preferences"), JSON.stringify(preferences));
        if (typeof preferencesSummary === "function") preferencesSummary();
      }
      if (Array.isArray(data?.savedPlaces) && Array.isArray(savedPlaces)) {
        const have = new Set(savedPlaces.map((p) => String(p.name || "").toLowerCase()));
        const add = data.savedPlaces
          .filter((p) => p && typeof p.name === "string" && p.name.trim() && !have.has(p.name.toLowerCase()))
          .map((p) => ({ id: String(p.id || crypto.randomUUID()).slice(0, 80), name: p.name.slice(0, 200) }));
        if (add.length) {
          savedPlaces = [...savedPlaces, ...add];
          localStorage.setItem(profileStorageKey("saved"), JSON.stringify(savedPlaces));
        }
      }
    } catch {}
    closeModal();
    renderTrips();
    showView("homeView");
    toast(
      `יובאו ${fresh.length} טיולים${replace && same.length ? ` ועודכנו ${same.length}` : ""}${bad ? ` (${bad} לא נקראו)` : ""}`,
    );
    window.dispatchEvent(new CustomEvent("triply:trips-changed"));
  };
  /* ---- Which version is running, and picking up a new one when the app comes back to the screen ---- */
  const APP_VERSION = 32; // same number as CACHE "triply-shell-v32" in sw.js
  window.TRIPLY_VERSION = APP_VERSION;
  const native = Boolean(window.Capacitor?.isNativePlatform?.());
  let lastCheck = 0;
  const checkVersion = async () => {
    if (native || Date.now() - lastCheck < 60000) return;
    lastCheck = Date.now();
    try {
      const r = await fetch("./sw.js?check=" + Date.now(), { cache: "no-store" });
      const m = (await r.text()).match(/triply-shell-v(\d+)/);
      if (!m || Number(m[1]) <= APP_VERSION) return;
      // an app left open on the phone keeps old code in memory: load the new version (unless a form is open) —
      // once per version, so a cache that still serves the old files cannot cause a reload loop
      let tried = "";
      try {
        tried = sessionStorage.getItem("triply:reloaded-for") || "";
      } catch {}
      if (!document.querySelector(".modal-backdrop.show") && tried !== m[1]) {
        try {
          sessionStorage.setItem("triply:reloaded-for", m[1]);
        } catch {}
        location.reload();
      } else toast("יש גרסה חדשה של האפליקציה — סגור ופתח אותה כדי לקבל אותה");
    } catch {}
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkVersion());
  setTimeout(checkVersion, 4000);
  const btn = $("#settingsBtn");
  if (btn && typeof openSettings === "function") {
    btn.onclick = () => {
      openSettings();
      $(".modal")?.insertAdjacentHTML("beforeend", `<p class="muted app-version">גרסה ${APP_VERSION}</p>`);
      const anchor = $("#backupData");
      if (anchor && !$("#importBackup")) {
        anchor.insertAdjacentHTML(
          "afterend",
          '<button class="secondary-btn" id="importBackup">ייבוא טיולים מקובץ גיבוי</button><p class="muted import-note">בוחרים קובץ גיבוי שהורד מהאפליקציה (הגדרות ← הורדת גיבוי טיולים).</p>',
        );
        $("#importBackup").onclick = window.importTripsFromFile;
      }
    };
  }
  // Empty home: offer import next to "new trip".
  const prev = renderTrips;
  renderTrips = () => {
    prev();
    if (!state.trips.length) {
      const g = $("#tripGrid");
      if (g && !g.querySelector("#emptyImport"))
        g.insertAdjacentHTML(
          "beforeend",
          '<button type="button" class="text-btn" id="emptyImport">יש לך קובץ גיבוי? ייבוא טיולים</button>',
        );
      const b = $("#emptyImport");
      if (b) b.onclick = window.importTripsFromFile;
    }
  };
  renderTrips();
})();
