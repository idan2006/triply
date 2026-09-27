/* Triply — "plan my whole trip": short guided interview → AI picks attractions →
 * ItineraryEngine builds a full, gap-free schedule → user reviews and approves. */
(function () {
  "use strict";

  const INTERESTS = ["אטרקציות מפורסמות", "מוזיאונים", "תרבות והיסטוריה", "נופים ותצפיות", "טבע ופארקים", "קניות ושווקים", "חיי לילה והופעות", "אוכל ושווקי אוכל", "אטרקציות לילדים", "אקסטרים והרפתקאות", "אמנות ועיצוב", "בטן־גב ורגוע"];
  const TYPES = ["זוגי", "חברים", "משפחה עם ילדים", "לבד", "עסקים + טיול"];
  const PACES = [
    ["relaxed", "נינוח", "2–4 מקומות ביום, עם הפסקות"],
    ["balanced", "מאוזן", "3–5 מקומות ביום"],
    ["busy", "עמוס", "להספיק כמה שיותר"],
  ];
  const BUDGETS = ["חסכוני", "רגיל", "לא משנה לי"];
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---------- Intent detection for free chat text ---------- */
  function wantsWholeTrip(text) {
    const s = String(text || "");
    const verb = /(תכנ[ןנ]|תתכנ[ןנ]|לתכנן|תבנ[הי]|בנה|לבנות|תכי[ןנ]|להכין|תארג[ןנ]|תסדר|תמליץ|תציע|plan|build)/i;
    const scope = /(טיול|חופשה|שבוע|סופ["״]?ש|הימים|ימים|מסלול|תוכנית|תכנית|לו["״]?ז|לוח|את הכל|הכול|הכל|מאפס|trip|itinerary|week|vacation)/i;
    const discovery = /(מה\s+(?:כדאי|אפשר|יש|שווה)\s+(?:לעשות|לראות)|לא\s+יודע\s+מה\s+לעשות|תתכנן\s+לי|תתכנני\s+לי)/;
    const narrow = /(תזיז|תעביר|תמחק|תוריד|תחליף|תשנה\s+את\s+השעה|הוצאה|תקציב|משתתף|בשעה\s*\d|ב-?\d{1,2}:\d{2})/;
    const whole = /(כל\s+ה(?:טיול|ימים|שבוע|חופשה)|לכל\s+ה|מאפס|מההתחלה|את\s+הטיול|טיול\s+(?:ל|ב)|את\s+השבוע|את\s+החופשה)/;
    if (narrow.test(s) && !whole.test(s)) return false;
    return (verb.test(s) && scope.test(s)) || discovery.test(s);
  }

  /* ---------- helpers ---------- */
  const esc = (v) => escapeHTML(v);
  const dayName = (iso) => new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"));
  function guessFromText(text) {
    const s = String(text || "");
    const out = { interests: [], travelType: "", pace: "" };
    const map = [
      ["מוזיאונים", /מוזיאו/],
      ["תרבות והיסטוריה", /היסטורי|תרבות|עתיק/],
      ["נופים ותצפיות", /נוף|תצפית/],
      ["טבע ופארקים", /טבע|פארק|גנים/],
      ["קניות ושווקים", /קניות|שופינג|שוק|שווקים|קניון|outlet/i],
      ["חיי לילה והופעות", /חיי לילה|מסיב|מועדו|הופע|מחזמר|בר(?:ים)?\b/],
      ["אוכל ושווקי אוכל", /אוכל|קולינרי|מסעד/],
      ["אטרקציות לילדים", /ילדים|ילד|משפחתי/],
      ["אקסטרים והרפתקאות", /אקסטרים|אדרנלין|הרפתק/],
      ["אמנות ועיצוב", /אמנות|גלרי|אומנות/],
      ["בטן־גב ורגוע", /בטן|רגוע|חוף/],
      ["אטרקציות מפורסמות", /מפורס|חובה|קלאסי|הכי ידוע/],
    ];
    for (const [label, re] of map) if (re.test(s)) out.interests.push(label);
    if (/אשתי|בעלי|חבר(?:ה)? שלי|זוג|בת הזוג|בן הזוג/.test(s)) out.travelType = "זוגי";
    else if (/ילדים|משפחה/.test(s)) out.travelType = "משפחה עם ילדים";
    else if (/חברים|חבר'ה|החבר׳ה/.test(s)) out.travelType = "חברים";
    else if (/לבד|סולו/.test(s)) out.travelType = "לבד";
    if (/רגוע|נינוח|בלי לחץ|לאט/.test(s)) out.pace = "relaxed";
    else if (/עמוס|כמה שיותר|להספיק|אינטנסיבי|מלא מלא/.test(s)) out.pace = "busy";
    return out;
  }
  function persistPreferences(patch) {
    try {
      Object.assign(preferences, patch);
      localStorage.setItem(profileStorageKey("preferences"), JSON.stringify(preferences));
    } catch {}
  }
  async function suggestCall(payload) {
    const session = await aiSession();
    const response = await fetch(AI_SUPABASE_URL + "/functions/v1/trip-planner", {
      method: "POST",
      headers: { apikey: AI_PUBLIC_KEY, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "suggest", ...payload }),
      signal: AbortSignal.timeout(150000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || "שירות ה-AI אינו זמין כעת. נסה שוב בעוד רגע.");
    if (!Array.isArray(data.attractions) || !data.attractions.length) throw Error("ה-AI לא החזיר אטרקציות. נסה שוב.");
    return data;
  }

  /* ---------- Interview ---------- */
  function interviewState(trip, request) {
    const g = guessFromText(request);
    const td = trip.travelDetails || {};
    return {
      travelType: g.travelType || trip.travelType || "",
      interests: [...new Set([...(g.interests || []), ...(Array.isArray(trip.activityTypes) ? trip.activityTypes.filter((x) => INTERESTS.includes(x)) : [])])],
      pace: g.pace || (preferences.paceChosen ? preferences.pace : ""),
      budget: preferences.budgetStyle || "",
      wake: HHMM.test(preferences.wake || "") ? preferences.wake : "08:00",
      sleep: HHMM.test(preferences.sleep || "") ? preferences.sleep : "23:00",
      arrivalTime: td.arrival?.date === trip.start && HHMM.test(td.arrival?.time || "") ? td.arrival.time : "",
      departureTime: td.departure?.date === trip.end && HHMM.test(td.departure?.time || "") ? td.departure.time : "",
      flightsKnown: Boolean((td.arrival?.date === trip.start && td.arrival?.time) || (td.departure?.date === trip.end && td.departure?.time)),
      hotel: trip.hotel || "",
      keepStops: true,
      mustSee: "",
      request: String(request || ""),
    };
  }
  function missingKeys(st, trip) {
    const miss = [];
    if (!st.travelType) miss.push("travelType");
    if (!st.interests.length) miss.push("interests");
    if (!st.pace) miss.push("pace");
    if (!st.flightsKnown) miss.push("flights");
    if (!st.hotel) miss.push("hotel");
    return miss;
  }
  const chips = (name, list, selected, multi) =>
    `<div class="ap-chips" role="${multi ? "group" : "radiogroup"}">${list
      .map((item) => {
        const [value, label, hint] = Array.isArray(item) ? item : [item, item, ""];
        const on = multi ? selected.includes(value) : selected === value;
        return `<button type="button" class="ap-chip${on ? " on" : ""}" data-chip="${name}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</button>`;
      })
      .join("")}</div>`;

  function renderInterview(host, trip, st, onSubmit, onCancel) {
    const miss = missingKeys(st, trip);
    const isMissing = (k) => miss.includes(k);
    const q = (key, title, body, optional) =>
      `<fieldset class="ap-q${isMissing(key) ? " ap-missing" : ""}" data-q="${key}"><legend>${title}${optional ? ' <span class="ap-opt">(לא חובה)</span>' : ""}</legend>${body}</fieldset>`;
    const known = [];
    const ask = [];
    const put = (key, html) => (isMissing(key) ? ask : known).push(html);
    put("travelType", q("travelType", "עם מי אתה נוסע?", chips("travelType", TYPES, st.travelType, false)));
    put("interests", q("interests", "מה הכי מעניין אתכם? (אפשר כמה)", chips("interests", INTERESTS, st.interests, true)));
    put("pace", q("pace", "איזה קצב מתאים לכם?", chips("pace", PACES, st.pace, false)));
    put(
      "flights",
      q(
        "flights",
        "מתי אתם נוחתים ומתי ממריאים חזרה?",
        `<div class="field-grid"><div class="field"><label for="apArr">שעת נחיתה ב-${esc(dayName(trip.start))}</label><input id="apArr" type="time" value="${esc(st.arrivalTime)}"></div><div class="field"><label for="apDep">שעת המראה ב-${esc(dayName(trip.end))}</label><input id="apDep" type="time" value="${esc(st.departureTime)}"></div></div><small>לא יודע עדיין? השאר ריק ואתכנן את היום הראשון והאחרון כימים מלאים.</small>`,
        true,
      ),
    );
    put("hotel", q("hotel", "איפה אתם ישנים?", `<input id="apHotel" maxlength="200" value="${esc(st.hotel)}" placeholder="שם המלון או השכונה — או השאר ריק ואבחר אזור מרכזי">`, true));
    known.push(q("times", "שעות קימה ושינה", `<div class="field-grid"><div class="field"><label for="apWake">קימה</label><input id="apWake" type="time" value="${esc(st.wake)}" required></div><div class="field"><label for="apSleep">שינה</label><input id="apSleep" type="time" value="${esc(st.sleep)}" required></div></div>`));
    known.push(q("budget", "סגנון תקציב לאטרקציות", chips("budget", BUDGETS, st.budget, false), true));
    const stops = Array.isArray(trip.stops) ? trip.stops : [];
    const mustBlock = q(
      "mustSee",
      "יש מקומות שחייבים להיכנס?",
      `<textarea id="apMust" rows="2" maxlength="1500" placeholder="למשל: London Eye, Camden Market, מוזיאון הטבע — מופרד בפסיקים או בשורות">${esc(st.mustSee)}</textarea>${
        stops.length
          ? `<label class="check-row"><input type="checkbox" id="apKeep" ${st.keepStops ? "checked" : ""}> לשמור את ${stops.length} המקומות שכבר במסלול (${esc(stops.slice(0, 4).map((s) => s.name).join(", "))}${stops.length > 4 ? "…" : ""})</label>`
          : ""
      }`,
      true,
    );
    host.innerHTML = `<div class="autoplan">
      <p class="ap-intro">${ask.length ? "כדי לבנות לך טיול מלא — מהקימה ועד השינה, בלי זמנים מתים — חסרים לי רק כמה פרטים:" : "יש לי כמעט את כל מה שצריך. אם תרצה, הוסף מקומות חובה ולחץ על הכפתור."}</p>
      ${ask.join("")}
      ${mustBlock}
      <details class="ap-known"><summary>פרטים שכבר ידועים לי (לחץ לשינוי)</summary>${known.join("")}</details>
      <p class="ap-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="secondary-btn" data-ap="cancel">ביטול</button><button type="button" class="primary-btn" data-ap="go">✨ בנה לי את הטיול</button></div>
    </div>`;
    host.querySelectorAll("[data-chip]").forEach(
      (b) =>
        (b.onclick = () => {
          const name = b.dataset.chip,
            value = b.dataset.value;
          if (name === "interests") {
            st.interests = st.interests.includes(value) ? st.interests.filter((x) => x !== value) : [...st.interests, value];
            b.classList.toggle("on");
            b.setAttribute("aria-pressed", String(b.classList.contains("on")));
            return;
          }
          st[name] = value;
          host.querySelectorAll(`[data-chip="${name}"]`).forEach((x) => {
            x.classList.toggle("on", x === b);
            x.setAttribute("aria-pressed", String(x === b));
          });
        }),
    );
    host.querySelector('[data-ap="cancel"]').onclick = onCancel;
    host.querySelector('[data-ap="go"]').onclick = () => {
      const val = (id) => host.querySelector("#" + id)?.value ?? "";
      st.arrivalTime = val("apArr") || (st.flightsKnown ? st.arrivalTime : "");
      st.departureTime = val("apDep") || (st.flightsKnown ? st.departureTime : "");
      if (host.querySelector("#apHotel")) st.hotel = val("apHotel").trim();
      st.wake = val("apWake") || st.wake;
      st.sleep = val("apSleep") || st.sleep;
      st.mustSee = val("apMust");
      st.keepStops = host.querySelector("#apKeep") ? host.querySelector("#apKeep").checked : true;
      const err = host.querySelector(".ap-error");
      if (!HHMM.test(st.wake) || !HHMM.test(st.sleep) || st.sleep <= st.wake) {
        err.textContent = "שעת השינה צריכה להיות אחרי שעת הקימה.";
        return;
      }
      if (!st.pace) st.pace = "balanced";
      if (!st.interests.length) st.interests = ["אטרקציות מפורסמות"];
      onSubmit(st);
    };
  }

  /* ---------- Build the plan ---------- */
  function splitList(text) {
    return String(text || "")
      .split(/[,\n،;]+|\s+and\s+/i)
      .map((s) => s.replace(/^\s*(?:את|ה?מקום)\s+/, "").trim())
      .filter((s) => s.length > 1 && s.length <= 120);
  }

  async function buildPlan(trip, st, onStep) {
    const stops = st.keepStops ? trip.stops || [] : [];
    const mustSee = splitList(st.mustSee);
    onStep("בוחר אטרקציות שמתאימות לסגנון שלכם…");
    const data = await suggestCall({
      request: [st.request, st.mustSee ? "מקומות חובה: " + st.mustSee : ""].filter(Boolean).join("\n"),
      trip: { city: trip.city, start: trip.start, end: trip.end, people: trip.people, hotel: st.hotel, travelType: st.travelType, activityTypes: st.interests, stops: stops.map((s) => ({ name: s.name })) },
      answers: { mustSee, pace: st.pace, interests: st.interests, travelType: st.travelType, budget: st.budget, exclude: [] },
    });
    onStep("משבץ לפי אזורים, זמני הליכה ונסיעה, שעות פתיחה וארוחות…");
    const norm = ItineraryEngine.norm;
    const attractions = data.attractions.map((a, rank) => {
      const linked = stops.find((s) => [a.requestedAs, a.name, a.nameHe].some((v) => v && norm(v) === norm(s.name)));
      return { ...a, rank, existingStopId: linked ? linked.id : "", mustSee: a.mustSee || Boolean(linked) };
    });
    const home = trip.travelDetails?.lodgingPoint && st.hotel && trip.travelDetails.lodgingPoint.name === st.hotel ? trip.travelDetails.lodgingPoint : data.lodging;
    const result = ItineraryEngine.plan({
      start: trip.start,
      end: trip.end,
      pace: st.pace,
      wake: st.wake,
      sleep: st.sleep,
      arrival: st.arrivalTime ? { date: trip.start, time: st.arrivalTime } : {},
      departure: st.departureTime ? { date: trip.end, time: st.departureTime } : {},
      attractions,
      cityCenter: data.cityCenter,
      home: home && Number.isFinite(home.lat) ? home : null,
    });
    const problems = ItineraryEngine.checkSchedule(result.dailySchedule);
    if (problems.length) throw Error("בדיקת הלוח נכשלה: " + problems[0]);
    // Proposal for the app's validator: stops to add / move / remove.
    const operations = [];
    const placedIds = new Set();
    for (const s of result.stops) {
      if (s.existingStopId) {
        const old = stops.find((x) => x.id === s.existingStopId);
        placedIds.add(s.existingStopId);
        operations.push({ type: "update", id: s.existingStopId, name: old.name, date: s.date, time: s.time, duration: s.duration, notes: old.notes || s.notes });
      } else operations.push({ type: "add", name: s.name, date: s.date, time: s.time, duration: s.duration, notes: s.notes, lat: s.lat, lng: s.lng });
    }
    const removed = [];
    for (const s of trip.stops || [])
      if (!placedIds.has(s.id)) {
        operations.push({ type: "remove", id: s.id });
        removed.push(s.name);
      }
    const travelDetails = { ...(trip.travelDetails || {}) };
    if (st.arrivalTime) travelDetails.arrival = { ...(travelDetails.arrival || {}), date: trip.start, time: st.arrivalTime };
    if (st.departureTime) travelDetails.departure = { ...(travelDetails.departure || {}), date: trip.end, time: st.departureTime };
    const tripChanges = { travelType: st.travelType.slice(0, 80), activityTypes: st.interests.slice(0, 12) };
    if (st.hotel && st.hotel !== trip.hotel) tripChanges.hotel = st.hotel.slice(0, 250);
    if (st.arrivalTime || st.departureTime) {
      const tdChange = {};
      if (st.arrivalTime) tdChange.arrival = { date: trip.start, time: st.arrivalTime, airport: travelDetails.arrival?.airport || "" };
      if (st.departureTime) tdChange.departure = { date: trip.end, time: st.departureTime, airport: travelDetails.departure?.airport || "" };
      tripChanges.travelDetails = tdChange;
    }
    const preview = TripPlanning.apply(trip, { operations, tripChanges });
    const schedule = TripPlanning.validateSchedule(preview.trip, result.dailySchedule);
    for (const day of schedule)
      for (const block of day.blocks)
        if (block.placeName && !block.existingStopId) {
          const added = preview.stops.find((stop) => stop.date === day.date && stop.time === block.startTime && stop.name.toLocaleLowerCase() === block.placeName.toLocaleLowerCase());
          if (added) block.existingStopId = added.id;
        }
    const requested = mustSee.concat(stops.map((s) => s.name));
    const lodgingName = st.hotel || (data.lodging?.name ? `${data.lodging.name} (הנחה — לא הגדרת מלון)` : "מרכז העיר (הנחה)");
    const placed = new Set(result.stops.map((x) => ItineraryEngine.norm(x.name)));
    const missingMust = attractions.filter((a) => a.mustSee && !placed.has(ItineraryEngine.norm(a.name))).map((a) => a.nameHe || a.name);
    const mustCount = attractions.filter((a) => a.mustSee).length;
    return { data, result, preview, schedule, removed, requested, mustCount, missingMust, lodgingName, lodgingPoint: home };
  }

  function renderPreview(host, trip, st, plan, actions) {
    const { result, schedule, data } = plan;
    const attractionCount = schedule.reduce((n, d) => n + d.blocks.filter((b) => b.placeName).length, 0);
    const fillers = schedule.reduce((n, d) => n + d.blocks.filter((b) => /זמן חופשי/.test(b.activity) && ItineraryEngine.toMin(b.endTime) - ItineraryEngine.toMin(b.startTime) >= 60).length, 0);
    const days = schedule
      .map((d, i) => {
        const places = d.blocks.filter((b) => b.placeName);
        return `<details class="ap-day"${i === 0 ? " open" : ""}><summary><b>${esc(dayName(d.date))}</b> · ${places.length} מקומות · ${esc(d.wakeTime)}–${esc(d.sleepTime)}<span>${esc(places.map((b) => b.activity.replace(/^ביקור:\s*/, "")).join(" · "))}</span></summary><ol class="ap-blocks">${d.blocks
          .map((b) => `<li class="${b.placeName ? "ap-place" : /הליכה|נסיעה|חזרה ללינה/.test(b.activity) ? "ap-move" : ""}"><time>${esc(b.startTime)}–${esc(b.endTime)}</time><span>${esc(b.activity)}</span></li>`)
          .join("")}</ol></details>`;
      })
      .join("");
    const reqOk = plan.mustCount && !plan.missingMust.length ? `<p class="ap-ok">✓ כל ${plan.mustCount} המקומות שביקשת נכנסו ללוח.</p>` : "";
    host.innerHTML = `<div class="autoplan">
      <div class="ap-summary"><strong>${schedule.length} ימים · ${attractionCount} אטרקציות · לוח מלא מהקימה ועד השינה</strong>
      <p>${esc(data.message || "")}</p>
      <p class="muted">נקודת יציאה: ${esc(plan.lodgingName)}. ארוחות מופיעות כהפסקות באזור (בלי המלצות מסעדות, אלא אם תבקש). זמני ההליכה והנסיעה ושעות הפתיחה הם הערכה — כדאי לבדוק לפני היציאה.</p>
      ${reqOk}
      ${result.warnings.map((w) => `<p class="ap-warn">⚠ ${esc(w)}</p>`).join("")}
      ${plan.removed.length ? `<p class="ap-warn">יוסרו מהמסלול (לפי הבחירה שלך): ${esc(plan.removed.join(", "))}</p>` : ""}
      ${fillers ? `<p class="ap-warn">בחלק מהימים נשאר זמן חופשי כי נגמרו הצעות באזור. אפשר ללחוץ "תכנן מחדש" או לבקש בצ'אט להוסיף מקומות.</p>` : ""}
      </div>
      ${days}
      <p class="ap-error" role="alert"></p>
      <div class="modal-actions"><button type="button" class="secondary-btn" data-ap="redo">תכנן מחדש</button><button type="button" class="secondary-btn" data-ap="back">שינוי העדפות</button><button type="button" class="primary-btn" data-ap="accept">אישור ושמירת הטיול</button></div>
      <p class="muted">שום דבר לא נשמר עד שתאשר. אחרי השמירה אפשר לערוך כל מקטע ידנית או לבקש שינויים בצ'אט.</p>
    </div>`;
    host.querySelector('[data-ap="redo"]').onclick = actions.redo;
    host.querySelector('[data-ap="back"]').onclick = actions.back;
    host.querySelector('[data-ap="accept"]').onclick = actions.accept;
  }

  function acceptPlan(trip, st, plan) {
    const keys = ["city", "start", "end", "people", "participants", "currency", "budgetPerPerson", "hotel", "travelDetails", "travelType", "activityTypes", "stops", "expenses", "dailySchedule", "scheduleStopSnapshot"];
    const before = Object.fromEntries(keys.map((k) => [k, structuredClone(trip[k])]));
    try {
      for (const k of keys) if (k in plan.preview.trip) trip[k] = plan.preview.trip[k];
      trip.dailySchedule = plan.schedule;
      trip.scheduleStopSnapshot = JSON.stringify(plan.preview.stops);
      if (plan.lodgingPoint && Number.isFinite(plan.lodgingPoint.lat))
        trip.travelDetails = { ...(trip.travelDetails || {}), lodgingPoint: { name: st.hotel || plan.lodgingPoint.name || "", lat: plan.lodgingPoint.lat, lng: plan.lodgingPoint.lng } };
      save();
      persistPreferences({ pace: st.pace, paceChosen: true, wake: st.wake, sleep: st.sleep, budgetStyle: st.budget, interests: st.interests.join(", ") });
      return true;
    } catch (error) {
      for (const k of keys) trip[k] = before[k];
      throw error;
    }
  }

  /* ---------- Flow controller (works in a modal or inside the chat) ---------- */
  function run(trip, request, host, { onClose, onSaved, chatNote } = {}) {
    const st = interviewState(trip, request);
    let token = 0;
    const showInterview = () =>
      renderInterview(host, trip, st, go, () => {
        token++;
        onClose && onClose();
      });
    const go = async () => {
      const my = ++token;
      host.innerHTML = `<div class="autoplan ap-progress"><div class="ap-spinner" aria-hidden="true"></div><p class="ap-step" role="status">מתחיל…</p><p class="muted">זה לוקח בדרך כלל 15–40 שניות.</p></div>`;
      const step = (text) => {
        const el = host.querySelector(".ap-step");
        if (el) el.textContent = text;
      };
      try {
        const plan = await buildPlan(trip, st, step);
        if (my !== token || !host.isConnected) return;
        renderPreview(host, trip, st, plan, {
          redo: go,
          back: showInterview,
          accept: () => {
            try {
              acceptPlan(trip, st, plan);
              chatNote && chatNote(`שמרתי את הטיול: ${plan.schedule.length} ימים עם ${plan.result.stops.length} אטרקציות, מהקימה ועד השינה. אפשר לערוך כל מקטע ידנית, או לכתוב לי כאן מה לשנות (למשל "תזיז את London Eye ליום שלישי").`);
              onSaved && onSaved(plan);
            } catch (error) {
              const e = host.querySelector(".ap-error");
              if (e) e.textContent = error.message || "לא ניתן לשמור. הטיול הקודם נשמר.";
            }
          },
        });
      } catch (error) {
        if (my !== token || !host.isConnected) return;
        host.innerHTML = `<div class="autoplan"><p class="ap-warn">${esc(error.message || "התכנון נכשל")}</p><p class="muted">לא נשמר שום שינוי בטיול.</p><div class="modal-actions"><button type="button" class="secondary-btn" data-ap="back">חזרה לשאלות</button><button type="button" class="primary-btn" data-ap="retry">נסה שוב</button></div></div>`;
        host.querySelector('[data-ap="back"]').onclick = showInterview;
        host.querySelector('[data-ap="retry"]').onclick = go;
      }
    };
    showInterview();
  }

  function openModalFlow(request = "") {
    const trip = currentTrip();
    if (!trip) return toast("בחר טיול כדי להתחיל לתכנן");
    openModal(`<div class="chat-heading"><h2>✨ תכנון מלא ל${esc(trip.city)}</h2><p>אני בוחר את המקומות, ומנוע התכנון משבץ אותם לפי אזורים, זמני הגעה, שעות פתיחה וארוחות — מהקימה ועד השינה.</p></div><div id="autoPlanHost"></div>`);
    $("#modalContent").classList.add("chat-dialog");
    run(trip, request, $("#autoPlanHost"), {
      onClose: () => closeModal(),
      onSaved: (plan) => {
        closeModal();
        $("#modalContent").classList.remove("chat-dialog");
        selectedDate = trip.start;
        renderTrip();
        toast(`הטיול נשמר · ${plan.result.stops.length} אטרקציות ב-${plan.schedule.length} ימים`);
      },
    });
  }

  function startInChat(trip, text, ctx) {
    const note = (msg) => {
      trip.chat.push({ role: "assistant", text: msg });
      try {
        save();
      } catch {}
      ctx.draw();
    };
    note("בשמחה! אני אבנה לך את כל הטיול מאפס — מהקימה ועד השינה, עם זמני הליכה ונסיעה וארוחות. כדי שזה יתאים בדיוק לך, סמן למטה את מה שחסר לי ולחץ \"בנה לי את הטיול\".");
    run(trip, text, ctx.panel, {
      onClose: () => ctx.panel.replaceChildren(),
      chatNote: note,
      onSaved: () => {
        ctx.panel.replaceChildren();
        selectedDate = trip.start;
        if (currentTrip()?.id === trip.id) renderTrip();
      },
    });
    ctx.panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  window.TriplyAutoPlan = { wantsWholeTrip, open: openModalFlow, startInChat, splitList, guessFromText };
  const btn = document.getElementById("autoPlanBtn");
  if (btn) btn.onclick = () => openModalFlow("");
})();
