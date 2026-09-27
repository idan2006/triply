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
      ["קניות ושווקים", /קניות(?!\s*(?:מה|ב|ל)סופר)|שופינג|שוק(?!\s*אוכל)|שווקים|קניון|outlet/i],
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

  /* ---------- Free-text preferences ("we go to bed at 00:00, 3 meals: ...") ---------- */
  const HEB_NUM = { "אחת עשרה": 11, "שתים עשרה": 12, אחת: 1, אחד: 1, שתיים: 2, שתי: 2, שני: 2, שניים: 2, שלוש: 3, שלושה: 3, ארבע: 4, חמש: 5, שש: 6, שבע: 7, שמונה: 8, תשע: 9, עשר: 10 };
  const hhmm = (h, m) => `${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
  function findTime(text, words, kind) {
    let s = text;
    // Hebrew number words → digits ("לישון באחת עשרה" → "לישון ב11")
    for (const [w, n] of Object.entries(HEB_NUM)) s = s.replace(new RegExp(`(?<=[\\sבל-])${w}(?=[\\s,.;]|$)`, "g"), String(n));
    const m = s.match(new RegExp(`(?:${words})[^\\d\\n.,;]{0,16}?(\\d{1,2})(?:[:.](\\d{2}))?(\\s*(?:בלילה|בערב|בבוקר|בצהריים|בחצות))?`));
    if (!m) return kind === "sleep" && new RegExp(`(?:${words})[^\\n.,;]{0,16}חצות`).test(s) ? "00:00" : "";
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const when = (m[3] || "").trim();
    if (h > 24 || min > 59) return "";
    if (kind === "sleep") {
      if (h === 24 || when === "בחצות") h = 0;
      else if (h === 12) h = 0; // "לישון ב-12" = midnight
      else if (h >= 6 && h <= 11 && when !== "בבוקר") h += 12; // "לישון ב-11" = 23:00
    } else if (kind === "wake" && when === "בצהריים" && h < 12) h += 12;
    return hhmm(h % 24, min);
  }
  function parsePrefs(text) {
    const s = String(text || "").replace(/\s+/g, " ");
    const out = { ...guessFromText(s), wake: "", sleep: "", meals: {}, linger: 0, stroll: false };
    out.wake = findTime(s, "לקום|קמים|קם|קימה|להתעורר|מתעוררים|מתעורר|מתחילים את היום", "wake");
    out.sleep = findTime(s, "לישון|הולכים לישון|הולך לישון|שינה|לשכב|נרדמים|חוזרים למלון|לחזור למלון", "sleep");
    const mealTypes = [
      ["restaurant", /מסעד/],
      ["street", /אוכל רחוב|סטריט|דוכנ|שוק אוכל|פוד טראק|street food/i],
      ["supermarket", /סופר|מכולת|מצרכים/],
      ["cafe", /בית קפה|בתי קפה|קפה ומאפה/],
      ["hotel", /במלון|ארוחת בוקר כלולה|בוקר כלול/],
    ];
    const slots = { breakfast: /בוקר/, lunch: /צהר/, dinner: /ערב/ };
    const meals = {};
    // Explicit pairs: "ארוחת ערב במסעדה", "צהריים אוכל רחוב", "בוקר מהסופר"
    for (const part of s.split(/[,.;]|\s(?:ו|וגם\s)(?=ארוח|ב?בוקר|ב?צהר|ב?ערב)/)) {
      const slotKeys = Object.keys(slots).filter((k) => slots[k].test(part));
      const type = mealTypes.find(([, re]) => re.test(part));
      if (slotKeys.length === 1 && type) meals[slotKeys[0]] = type[0];
    }
    // "each day one restaurant, one street food, one supermarket" → breakfast / lunch / dinner
    const mentioned = mealTypes.filter(([, re]) => re.test(s)).map(([k]) => k).filter((k) => !Object.values(meals).includes(k));
    if (mentioned.length) {
      const rank = { supermarket: 0, hotel: 0, cafe: 1, street: 2, restaurant: 3 };
      const free = ["breakfast", "lunch", "dinner"].filter((k) => !meals[k]);
      const left = mentioned.sort((a, b) => rank[a] - rank[b]);
      if (left.length >= free.length) free.forEach((k, i) => (meals[k] = left[i]));
      else
        for (const k of left) {
          const want = k === "restaurant" ? "dinner" : k === "supermarket" || k === "hotel" || k === "cafe" ? "breakfast" : "lunch";
          const slot = free.includes(want) ? want : free.find((x) => !meals[x]);
          if (slot && !meals[slot]) meals[slot] = k;
        }
    }
    out.meals = meals;
    if (/לטייל|להסתובב|לשוטט|ללכת הרבה|הרבה הליכה|אוהבים ללכת|אוהב ללכת|ברגל|הליכות|בלי למהר|להרגיש את העיר/.test(s)) {
      out.stroll = true;
      out.linger = /הרבה|מאוד|שעות/.test(s) ? 45 : 30;
    }
    return out;
  }
  const MEAL_WORD = { restaurant: "מסעדה", street: "אוכל רחוב", supermarket: "מהסופר", cafe: "בית קפה", hotel: "במלון" };
  function prefsSummary(st) {
    const bits = [];
    if (st.wake) bits.push(`קימה ${st.wake}`);
    if (st.sleep) bits.push(`שינה ${st.sleep}`);
    const m = st.meals || {};
    const ml = [["breakfast", "בוקר"], ["lunch", "צהריים"], ["dinner", "ערב"]].filter(([k]) => m[k]).map(([k, he]) => `${he}: ${MEAL_WORD[m[k]]}`);
    if (ml.length) bits.push(ml.join(" · "));
    if (st.stroll) bits.push(`${st.linger} דק' לשוטט אחרי כל מקום, יותר זמן בפארקים ובשווקים`);
    if (st.pace) bits.push({ relaxed: "קצב נינוח", balanced: "קצב מאוזן", busy: "קצב עמוס" }[st.pace]);
    if (st.travelType) bits.push(st.travelType);
    if (st.interests && st.interests.length) bits.push(st.interests.slice(0, 4).join(", "));
    return bits;
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
      notes: String(preferences.planNotes || ""),
      meals: preferences.meals && typeof preferences.meals === "object" ? { ...preferences.meals } : {},
      linger: Number(preferences.linger) || 0,
      stroll: preferences.stroll === true,
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
    const notesBlock = `<fieldset class="ap-q ap-notes"><legend>ספר לי איך אתם אוהבים לטייל</legend><textarea id="apNotes" rows="4" maxlength="2000" placeholder="למשל: אנחנו קמים ב-9 והולכים לישון ב-12 בלילה. 3 ארוחות ביום — בוקר מהסופר, צהריים אוכל רחוב וערב במסעדה. אוהבים ללכת הרבה ברגל ולהסתובב בעיר ובפארקים, פחות מוזיאונים.">${esc(st.notes)}</textarea><div class="ap-understood" aria-live="polite"></div></fieldset>`;
    host.innerHTML = `<div class="autoplan">
      ${notesBlock}
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
    const understood = host.querySelector(".ap-understood");
    const applyNotes = () => {
      const text = host.querySelector("#apNotes").value;
      st.notes = text;
      const p = parsePrefs(text);
      if (p.wake) st.wake = p.wake;
      if (p.sleep) st.sleep = p.sleep;
      if (Object.keys(p.meals).length) st.meals = p.meals;
      if (p.stroll) {
        st.stroll = true;
        st.linger = p.linger;
      }
      if (p.pace) st.pace = p.pace;
      if (p.travelType) st.travelType = p.travelType;
      if (p.interests.length) st.interests = [...new Set([...st.interests, ...p.interests])];
      const w = host.querySelector("#apWake"),
        sl = host.querySelector("#apSleep");
      if (w && p.wake) w.value = p.wake;
      if (sl && p.sleep) sl.value = p.sleep;
      host.querySelectorAll("[data-chip]").forEach((b) => {
        const on = b.dataset.chip === "interests" ? st.interests.includes(b.dataset.value) : st[b.dataset.chip] === b.dataset.value;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      const bits = prefsSummary(st);
      if (!text.trim()) understood.innerHTML = "";
      else if (bits.length) understood.innerHTML = `<b>הבנתי:</b> ${bits.map((b) => `<span>${esc(b)}</span>`).join("")}`;
      else understood.innerHTML = `<span class="muted">כתוב גם שעות קימה ושינה, איזה ארוחות, או כמה אתם אוהבים ללכת — ואתאים את הלוח.</span>`;
    };
    let notesTimer;
    host.querySelector("#apNotes").addEventListener("input", () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(applyNotes, 250);
    });
    applyNotes();
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
      st.notes = host.querySelector("#apNotes")?.value || st.notes;
      const afterMidnight = st.sleep <= "05:00";
      if (!HHMM.test(st.wake) || !HHMM.test(st.sleep) || (st.sleep <= st.wake && !afterMidnight)) {
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



  window.TriplyPrefs = { parse: (t) => parsePrefs(t) };
  /* ---------- Real opening hours from OpenStreetMap (read from the browser) ---------- */
  const OSM_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  function parseOpeningHours(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    if (/^24\/7$/.test(text)) return { openFrom: "", openTo: "", closedDays: [] };
    const hm = (v) => { const m = v.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : NaN; };
    const week = Array(7).fill(undefined);
    let explicit = false;
    for (let rule of text.split(";")) {
      rule = rule.trim();
      if (!rule) continue;
      if (/\b(PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|easter|sunrise|sunset)\b/i.test(rule)) continue;
      const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
      if (!m) return null;
      let days = [0, 1, 2, 3, 4, 5, 6];
      if (m[1]) {
        explicit = true;
        days = [];
        for (const part of m[1].split(",")) {
          const [a, b] = part.split("-").map((d) => OSM_DAYS.indexOf(d));
          if (b === undefined) days.push(a);
          else for (let d = a, n = 0; n < 7; d = (d + 1) % 7, n++) { days.push(d); if (d === b) break; }
        }
      }
      const times = m[2].trim();
      if (/^(off|closed)$/i.test(times)) { for (const d of days) week[d] = null; continue; }
      const ranges = times.split(",").map((r) => r.trim().split("-").map(hm));
      if (!ranges.length || ranges.some((r) => r.length !== 2 || r.some((x) => !Number.isFinite(x)))) return null;
      const from = Math.min(...ranges.map((r) => r[0]));
      const to = Math.max(...ranges.map((r) => (r[1] <= r[0] ? 1439 : r[1])));
      for (const d of days) week[d] = [from, to];
    }
    if (!week.some((d) => d !== undefined)) return null;
    for (let d = 0; d < 7; d++) if (week[d] === undefined) week[d] = explicit ? null : week[d];
    const open = week.filter(Array.isArray);
    if (!open.length) return null;
    const clock = (v) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
    const from = Math.max(...open.map((d) => d[0])), to = Math.min(...open.map((d) => d[1]));
    if (to <= from) return null;
    return { openFrom: clock(from), openTo: to >= 1439 ? "23:59" : clock(to), closedDays: week.map((d, i) => (d === null ? i : -1)).filter((i) => i >= 0) };
  }
  async function enrichOpeningHours(list) {
    const withOsm = (list || []).filter((a) => a && a.osm && ["N", "W", "R"].includes(a.osm.type) && Number.isFinite(+a.osm.id));
    if (!withOsm.length) return 0;
    const kind = { N: "node", W: "way", R: "relation" };
    const q = `[out:json][timeout:8];(${withOsm.map((a) => `${kind[a.osm.type]}(${+a.osm.id});`).join("")});out tags;`;
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return 0;
      const data = await res.json();
      const hours = new Map();
      for (const el of data.elements || []) if (el.tags && el.tags.opening_hours) hours.set(String(el.type)[0].toUpperCase() + el.id, el.tags.opening_hours);
      let used = 0;
      for (const a of withOsm) {
        const h = parseOpeningHours(hours.get(a.osm.type + a.osm.id));
        if (!h) continue;
        Object.assign(a, h, { hoursVerified: true });
        used++;
      }
      return used;
    } catch {
      return 0;
    }
  }
  window.TriplyOpeningHours = { parse: parseOpeningHours };

  /* ---------- Several cities / hotels in one trip ---------- */
  const isoDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
  const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  function tripSegments(trip) {
    const hotels = (trip.travelDetails?.hotels || [])
      .filter((h) => h && isoDay(h.checkIn) && isoDay(h.checkOut) && h.checkOut > h.checkIn && h.checkOut > trip.start && h.checkIn <= trip.end)
      .slice()
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const distinct = new Set(hotels.map((h) => ItineraryEngine.norm(`${h.city || ""}|${h.name || ""}`)));
    if (hotels.length < 2 || distinct.size < 2) return [];
    const segs = [];
    hotels.forEach((h, i) => {
      const start = i === 0 ? trip.start : h.checkIn < trip.start ? trip.start : h.checkIn;
      const end = i === hotels.length - 1 ? trip.end : addDays(hotels[i + 1].checkIn, -1);
      if (end >= start) segs.push({ start, end: end > trip.end ? trip.end : end, city: String(h.city || trip.city).trim(), hotel: String(h.name || "").trim() });
    });
    return segs.length > 1 ? segs : [];
  }
  const km = (a, b) => {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return Infinity;
    const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
    return Math.sqrt(x * x + y * y) * 6371;
  };
  async function geocodeHotel(name, city, near) {
    try {
      const q = encodeURIComponent(`${name}, ${city}`);
      const bias = near && Number.isFinite(near.lat) ? `&lat=${near.lat}&lon=${near.lng}` : "";
      const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${q}${bias}`);
      const c = (await res.json())?.features?.[0]?.geometry?.coordinates;
      if (c && (!near || km(near, { lat: c[1], lng: c[0] }) < 40)) return { name, lat: c[1], lng: c[0] };
    } catch {}
    return null;
  }
  function transferTime(trip, seg) {
    const legs = trip.travelDetails?.flights || [];
    const leg = legs.slice(1).find((l) => (l.arriveDate || l.date) === seg.start && HHMM.test(l.arriveTime || ""));
    return leg ? leg.arriveTime : "13:00";
  }
  const toCity = (c) => (/^[\u0590-\u05FF]/.test(c) ? "ל" : "ל-") + c;
  async function multiCityPlan(trip, st, stops, mustSee, segs, onStep) {
    const norm = ItineraryEngine.norm;
    const cities = [...new Map(segs.map((g) => [norm(g.city), g.city])).values()];
    onStep(`בוחר אטרקציות ב${cities.join(" וב")}…`);
    const pools = await Promise.all(
      cities.map((city) => {
        const mine = segs.filter((g) => norm(g.city) === norm(city));
        return suggestCall({
          request: [st.request, st.notes ? "העדפות המטיילים: " + st.notes : "", st.mustSee ? "מקומות חובה (רק אם הם נמצאים ב-" + city + "): " + st.mustSee : ""].filter(Boolean).join("\n"),
          trip: { city, start: mine[0].start, end: mine.at(-1).end, people: trip.people, hotel: mine[0].hotel, travelType: st.travelType, activityTypes: st.interests, stops: [] },
          answers: { mustSee: [], pace: st.pace, interests: st.interests, travelType: st.travelType, budget: st.budget, exclude: [] },
        }).then((d) => ({ city, data: d }));
      })
    );
    // Requested places: put each one in the city it is closest to.
    const wanted = mustSee.concat(stops.map((s) => s.name));
    const poolOf = new Map(pools.map((p) => [norm(p.city), p]));
    onStep("בודק שעות פתיחה אמיתיות במפה…");
    await Promise.all(pools.map((p) => enrichOpeningHours(p.data.attractions)));
    for (const p of pools) p.data.attractions = (p.data.attractions || []).filter((a) => km(p.data.cityCenter, a) <= 50 || !Number.isFinite(a.lat));
    onStep("משבץ כל עיר לפי אזורים, זמני הליכה ושעות פתיחה…");
    const used = new Set();
    const merged = { dailySchedule: [], stops: [], warnings: [] };
    let firstHome = null, rank = 0;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i], p = poolOf.get(norm(g.city)), d = p.data;
      const pool = d.attractions.filter((a) => !used.has(norm(a.name))).map((a) => {
        const linked = stops.find((s) => [a.requestedAs, a.name, a.nameHe].some((v) => v && norm(v) === norm(s.name)));
        const req = wanted.some((w) => [a.requestedAs, a.name, a.nameHe].some((v) => v && norm(v) === norm(w)));
        return { ...a, rank: rank++, existingStopId: linked ? linked.id : "", mustSee: Boolean(linked) || req };
      });
      const firstOfCity = segs.find((x) => norm(x.city) === norm(g.city));
      let home = firstOfCity === g ? d.lodging : null;
      if ((!home || !Number.isFinite(home.lat)) && g.hotel) home = await geocodeHotel(g.hotel, g.city, d.cityCenter);
      if (!home) home = d.lodging;
      if (i === 0) firstHome = home;
      const transfer = i > 0 ? transferTime(trip, g) : null;
      const r = ItineraryEngine.plan({
        start: g.start,
        end: g.end,
        pace: st.pace,
        wake: st.wake,
        sleep: st.sleep,
        meals: st.meals,
        linger: st.linger,
        stroll: st.stroll,
        arrival: i === 0 ? (st.arrivalTime ? { date: trip.start, time: st.arrivalTime } : {}) : { date: g.start, time: transfer, label: `הגעה ${toCity(g.city)}${g.hotel ? " ונסיעה " + toCity(g.hotel) : ""}` },
        departure: i === segs.length - 1 && st.departureTime ? { date: trip.end, time: st.departureTime } : {},
        attractions: pool,
        cityCenter: d.cityCenter,
        home: home && Number.isFinite(home.lat) ? home : null,
      });
      if (i > 0) {
        const day = r.dailySchedule[0];
        const wake = ItineraryEngine.toMin(st.wake), arr = ItineraryEngine.toMin(day?.blocks?.[0]?.startTime);
        if (day && wake !== null && arr !== null && arr - wake >= 30) {
          day.blocks.unshift({ startTime: st.wake, endTime: day.blocks[0].startTime, activity: `קימה, צ'ק-אאוט ונסיעה ${toCity(g.city)}`, placeName: "" });
          day.wakeTime = st.wake;
        }
      }
      for (const s of r.stops) used.add(norm(s.name));
      merged.dailySchedule.push(...r.dailySchedule);
      merged.stops.push(...r.stops);
      merged.warnings.push(...(r.warnings || []).map((w) => `${g.city}: ${w}`));
    }
    const all = pools.flatMap((p) => p.data.attractions);
    const attractions = all.map((a) => ({ ...a, mustSee: wanted.some((w) => [a.requestedAs, a.name, a.nameHe].some((v) => v && norm(v) === norm(w))) }));
    const data = { ...pools[0].data, attractions: all, message: pools.map((p) => p.data.message).filter(Boolean).join(" ") };
    return { data, attractions, home: firstHome, result: merged };
  }

  async function buildPlan(trip, st, onStep) {
    const stops = st.keepStops ? trip.stops || [] : [];
    const mustSee = splitList(st.mustSee);
    let data, attractions, home, result;
    const segs = tripSegments(trip);
    if (segs.length > 1) ({ data, attractions, home, result } = await multiCityPlan(trip, st, stops, mustSee, segs, onStep));
    else {
      onStep("בוחר אטרקציות שמתאימות לסגנון שלכם…");
      data = await suggestCall({
        request: [st.request, st.notes ? "העדפות המטיילים: " + st.notes : "", st.mustSee ? "מקומות חובה: " + st.mustSee : ""].filter(Boolean).join("\n"),
        trip: { city: trip.city, start: trip.start, end: trip.end, people: trip.people, hotel: st.hotel, travelType: st.travelType, activityTypes: st.interests, stops: stops.map((s) => ({ name: s.name })) },
        answers: { mustSee, pace: st.pace, interests: st.interests, travelType: st.travelType, budget: st.budget, exclude: [] },
      });
      onStep("בודק שעות פתיחה אמיתיות במפה…");
      await enrichOpeningHours(data.attractions);
      onStep("משבץ לפי אזורים, זמני הליכה ונסיעה, שעות פתיחה וארוחות…");
      const norm = ItineraryEngine.norm;
      attractions = data.attractions.map((a, rank) => {
        const linked = stops.find((s) => [a.requestedAs, a.name, a.nameHe].some((v) => v && norm(v) === norm(s.name)));
        return { ...a, rank, existingStopId: linked ? linked.id : "", mustSee: a.mustSee || Boolean(linked) };
      });
      home = trip.travelDetails?.lodgingPoint && st.hotel && trip.travelDetails.lodgingPoint.name === st.hotel ? trip.travelDetails.lodgingPoint : data.lodging;
      result = ItineraryEngine.plan({
        start: trip.start,
        end: trip.end,
        pace: st.pace,
        wake: st.wake,
        sleep: st.sleep,
        meals: st.meals,
        linger: st.linger,
        stroll: st.stroll,
        arrival: st.arrivalTime ? { date: trip.start, time: st.arrivalTime } : {},
        departure: st.departureTime ? { date: trip.end, time: st.departureTime } : {},
        attractions,
        cityCenter: data.cityCenter,
        home: home && Number.isFinite(home.lat) ? home : null,
      });
    }
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
    const lodgingName = segs.length > 1 ? segs.map((g) => g.hotel ? `${g.hotel} (${g.city})` : g.city).join(" ← ") : st.hotel || (data.lodging?.name ? `${data.lodging.name} (הנחה — לא הגדרת מלון)` : "מרכז העיר (הנחה)");
    const placed = new Set(result.stops.map((x) => ItineraryEngine.norm(x.name)));
    const missingMust = attractions.filter((a) => a.mustSee && !placed.has(ItineraryEngine.norm(a.name))).map((a) => a.nameHe || a.name);
    const mustCount = attractions.filter((a) => a.mustSee).length;
    window.__triplyLastPlan = { data, result };
    return { data, result, preview, schedule, removed, requested, mustCount, missingMust, lodgingName, lodgingPoint: home };
  }

  function renderPreview(host, trip, st, plan, actions) {
    const { result, schedule, data } = plan;
    const attractionCount = schedule.reduce((n, d) => n + d.blocks.filter((b) => b.placeName).length, 0);
    const fillers = schedule.reduce((n, d) => n + d.blocks.filter((b) => /זמן חופשי/.test(b.activity) && ItineraryEngine.toMin(b.endTime) - ItineraryEngine.toMin(b.startTime) >= 60).length, 0);
    const days = schedule
      .map((d, i) => {
        const places = d.blocks.filter((b) => b.placeName);
        return `<details class="ap-day" style="animation-delay:${i * 120}ms"${i === 0 ? " open" : ""}><summary><b>${esc(dayName(d.date))}</b> · ${places.length} מקומות · ${esc(d.wakeTime)}–${esc(d.sleepTime)}<span>${esc(places.map((b) => b.activity.replace(/^ביקור:\s*/, "")).join(" · "))}</span></summary><ol class="ap-blocks">${d.blocks
          .map((b) => `<li class="${b.placeName ? "ap-place" : /הליכה|נסיעה|חזרה ללינה/.test(b.activity) ? "ap-move" : ""}"><time>${esc(b.startTime)}–${esc(b.endTime)}</time><span>${esc(b.activity)}</span></li>`)
          .join("")}</ol></details>`;
      })
      .join("");
    const placedNames = new Set(result.stops.map((x) => ItineraryEngine.norm(x.name)));
    const verifiedHours = (data.attractions || []).filter((a) => a.hoursVerified && placedNames.has(ItineraryEngine.norm(a.name))).length;
    const reqOk = plan.mustCount && !plan.missingMust.length ? `<p class="ap-ok">✓ כל ${plan.mustCount} המקומות שביקשת נכנסו ללוח.</p>` : "";
    host.innerHTML = `<div class="autoplan">
      <div class="ap-summary"><strong>${schedule.length} ימים · ${attractionCount} אטרקציות · לוח מלא מהקימה ועד השינה</strong>
      <p>${esc(data.message || "")}</p>
      <p class="muted">נקודת יציאה: ${esc(plan.lodgingName)}. ארוחות מופיעות כהפסקות באזור (בלי המלצות מסעדות, אלא אם תבקש). זמני ההליכה והנסיעה הם הערכה${verifiedHours ? `. שעות הפתיחה של ${verifiedHours} מקומות נבדקו מול OpenStreetMap; לשאר זו הערכה` : " ושעות הפתיחה הם הערכה"} — כדאי לבדוק לפני היציאה.</p>
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
      persistPreferences({ pace: st.pace, paceChosen: true, wake: st.wake, sleep: st.sleep, budgetStyle: st.budget, interests: st.interests.join(", "), planNotes: String(st.notes || "").slice(0, 2000), meals: st.meals || {}, linger: st.linger || 0, stroll: Boolean(st.stroll) });
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
      const stages = ["מבין מה מתאים לכם", `בוחר אטרקציות ב${trip.city}`, "בודק מיקומים ושעות פתיחה במפה", "בונה את הימים לפי אזורים והליכה"];
      const tips = ["אחרי השמירה אפשר ללחוץ על כל שורה בלוח כדי לערוך אותה.", "מקומות קרובים נכנסים לאותו יום, כדי שתלכו ברגל ולא תבלו בתחבורה.", "בזמן הטיול האפליקציה נפתחת על היום של היום, עם כפתור ניווט למקום הבא.", "אפשר לכתוב בצ׳אט \"תזיז את המוזיאון ליום גשום\" והוא יעדכן את הלוח.", "טיול בכמה ערים? בתפריט ⋯ יש \"ערים ומלונות\"."];
      host.innerHTML = `<div class="autoplan ap-progress ap-live"><h3 class="ap-live-title">מתכנן את ${esc(trip.city)}…</h3><div class="ap-bar" aria-hidden="true"><i></i></div><ol class="ap-stages">${stages.map((x, i) => `<li data-stage="${i}">${esc(x)}</li>`).join("")}</ol><p class="ap-step" role="status">מתחיל…</p><p class="ap-tip muted"></p><p class="muted ap-elapsed"></p></div>`;
      const t0 = Date.now();
      let stage = 0;
      const setStage = (n) => {
        stage = Math.max(stage, n);
        host.querySelectorAll("[data-stage]").forEach((li) => li.className = +li.dataset.stage < stage ? "done" : +li.dataset.stage === stage ? "now" : "");
      };
      setStage(0);
      const tick = setInterval(() => {
        if (!host.isConnected || my !== token) return clearInterval(tick);
        const sec = Math.round((Date.now() - t0) / 1000);
        if (sec >= 2 && stage < 1) setStage(1);
        if (sec >= 14 && stage < 2) setStage(2);
        const bar = host.querySelector(".ap-bar i");
        if (bar) bar.style.width = `${Math.min(92, stage >= 3 ? 95 : 100 * (1 - Math.exp(-sec / 22)))}%`;
        const tip = host.querySelector(".ap-tip");
        if (tip && sec % 6 === 0) tip.textContent = tips[(sec / 6) % tips.length];
        const el = host.querySelector(".ap-elapsed");
        if (el) el.textContent = sec < 45 ? `עברו ${sec} שניות · בדרך כלל 20–40 שניות` : `עברו ${sec} שניות · השרת עמוס קצת, עוד רגע…`;
      }, 1000);
      host.querySelector(".ap-tip").textContent = tips[0];
      const step = (text) => {
        const el = host.querySelector(".ap-step");
        if (el) el.textContent = text;
        if (/שעות פתיחה/.test(text)) setStage(2);
        if (/משבץ/.test(text)) setStage(3);
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
