/* Triply MVP follow-up: per-traveler budgets, document prepayments and truthful AI proposals. */
(function () {
  "use strict";
  const currencies = ["ILS", "GBP", "USD", "EUR"];
  const money = (value) => Number(value || 0).toFixed(2);
  const makeEqualSplits = (amount, people) => {
    const cents = Math.round(amount * 100),
      base = Math.floor(cents / people.length),
      extra = cents % people.length,
      out = {};
    people.forEach((p, i) => (out[p.id] = (base + (i < extra ? 1 : 0)) / 100));
    return out;
  };
  const validISO = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && Number.isFinite(Date.parse(value + "T00:00:00Z"));

  function enhancedTripForm(edit = false) {
    const t = edit ? currentTrip() : null;
    let scannedDetails = { ...(t?.travelDetails || {}) };
    let prepaidRows = [];
    let peopleDraft = t
      ? t.participants.map((p) => ({ id: p.id, name: p.name, budget: String(p.budget ?? t.budgetPerPerson ?? "") }))
      : [{ name: "משתתף 1", budget: "" }];
    const existingCountLocked = Boolean(t?.expenses.length);
    const initialCurrency = t?.currency || "ILS";
    const participantHTML = () =>
      peopleDraft
        .map(
          (p, i) =>
            `<div class="traveler-budget-row"><label><span>שם משתתף ${i + 1}</span><input data-person-name="${i}" maxlength="80" value="${escapeHTML(p.name)}" placeholder="למשל: עידן" required></label><label><span>תקציב אישי (${escapeHTML($("#tripCurrency")?.value || initialCurrency)})</span><input data-person-budget="${i}" type="number" inputmode="decimal" min="${t ? "0" : "0.01"}" max="100000000" step="0.01" value="${escapeHTML(p.budget)}" placeholder="למשל 5000" ${t ? "" : "required"}></label></div>`,
        )
        .join("");
    const readPeople = () =>
      (peopleDraft = peopleDraft.map((p, i) => ({
        ...p,
        name: $(`[data-person-name="${i}"]`)?.value ?? p.name,
        budget: $(`[data-person-budget="${i}"]`)?.value ?? p.budget,
      })));
    const renderPeople = () => {
      const host = $("#travelerBudgetFields");
      if (host) host.innerHTML = participantHTML();
    };
    const showPrepaid = () => {
      const host = $("#prepaidRows");
      if (!host) return;
      host.innerHTML = prepaidRows.length
        ? prepaidRows
            .map(
              (r, i) =>
                `<div class="prepaid-row"><label><span>הוצאה שחולצה</span><input data-prepaid-name="${i}" maxlength="120" value="${escapeHTML(r.name)}" placeholder="כרטיס טיסה / מלון" required></label><label><span>סכום</span><input data-prepaid-amount="${i}" type="number" min="0.01" max="100000000" step="0.01" value="${escapeHTML(r.amount)}" required></label><label><span>מטבע</span><select data-prepaid-currency="${i}" required><option value="">בחירת מטבע</option>${currencies.map((c) => `<option value="${c}" ${r.currency === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><button type="button" class="small-btn" data-prepaid-remove="${i}" aria-label="הסרת הוצאה">×</button></div>`,
            )
            .join("")
        : '<p class="muted">לא זוהו הוצאות ששולמו מראש. אפשר להוסיף ידנית.</p>';
      prepaidRows.forEach((r, i) => {
        $(`[data-prepaid-name="${i}"]`).oninput = (e) => (r.name = e.target.value);
        $(`[data-prepaid-amount="${i}"]`).oninput = (e) => (r.amount = e.target.value);
        $(`[data-prepaid-currency="${i}"]`).onchange = (e) => (r.currency = e.target.value);
      });
      $$("[data-prepaid-remove]").forEach(
        (b) =>
          (b.onclick = () => {
            prepaidRows.splice(Number(b.dataset.prepaidRemove), 1);
            showPrepaid();
          }),
      );
    };

    openModal(
      `<h2>${t ? "עריכת טיול" : "טיול חדש"}</h2><form id="tripForm"><div class="field"><label for="newCity">יעד</label><input id="newCity" required maxlength="150" value="${escapeHTML(t?.city || "")}" autocomplete="off" placeholder="למשל: לונדון"></div><div class="field-grid"><div class="field"><label for="newStart">מתאריך</label><input id="newStart" type="date" required value="${t?.start || ""}"></div><div class="field"><label for="newEnd">עד תאריך</label><input id="newEnd" type="date" required value="${t?.end || ""}"></div></div><div class="field"><label for="newPeople">מספר נוסעים</label><input id="newPeople" type="number" inputmode="numeric" min="1" max="1000" step="1" required value="${t?.people || 1}" ${existingCountLocked ? "disabled" : ""}></div>${existingCountLocked ? "<small>מספר המשתתפים נעול לאחר רישום הוצאות כדי לשמור על החלוקה שלהן.</small>" : ""}<div class="field"><label for="tripCurrency">מטבע התקציב</label><select id="tripCurrency" ${t?.expenses.length ? "disabled" : ""}>${currencies.map((c) => `<option value="${c}" ${c === initialCurrency ? "selected" : ""}>${c}</option>`).join("")}</select>${t?.expenses.length ? "<small>לא ניתן לשנות מטבע לאחר רישום הוצאות.</small>" : ""}</div><section class="traveler-budgets"><h3>תקציב אישי לכל משתתף</h3><p>היתרה תחושב בנפרד לכל אחד. אפשר להגדיר סכומים שונים.</p><div id="travelerBudgetFields"></div></section><div class="field"><label for="tripHotel">מלון או נקודת יציאה</label><input id="tripHotel" value="${escapeHTML(t?.hotel || "")}" maxlength="250" placeholder="שם המלון או כתובת"></div><details class="document-scan"><summary>העלאת כרטיס טיסה או אישור מלון — מילוי אוטומטי</summary><p>המסמך נשלח ל-AI רק לצורך חילוץ פרטים ואינו נשמר באפליקציה. בדוק את התאריכים, הנוסעים והמחירים לפני השמירה. תקציב אישי נדרש תמיד.</p><div class="field"><label for="tripDocuments">בחירת PDF או תמונה (עד שני קבצים, 4MB לכל קובץ)</label><input id="tripDocuments" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></div><button type="button" class="secondary-btn" id="scanTripDocs">סריקת המסמכים</button><p id="documentStatus" role="status"></p><div id="documentResults"></div><div class="prepaid-editor"><h4>טיסה ומלון ששולמו מראש</h4><p>הסכומים יתווספו להוצאות המשותפות ויתחלקו שווה בשווה. בדוק את המטבע והסכום שחולצו.</p><div id="prepaidRows"></div><button type="button" class="small-btn" id="addPrepaid">＋ הוספת עלות ששולמה מראש</button></div></details><p id="formError" role="alert"></p><button class="primary-btn" type="submit">${t ? "שמירת השינויים" : "יצירת הטיול"}</button></form>`,
    );
    renderPeople();
    showPrepaid();
    $("#newPeople").oninput = () => {
      readPeople();
      const count = Math.max(1, Math.min(1000, Number($("#newPeople").value) || 1));
      while (peopleDraft.length < count) peopleDraft.push({ name: `משתתף ${peopleDraft.length + 1}`, budget: "" });
      peopleDraft = peopleDraft.slice(0, count);
      renderPeople();
    };
    $("#tripCurrency").onchange = () => {
      readPeople();
      renderPeople();
    };
    $("#newStart").onchange = () => {
      $("#newEnd").min = $("#newStart").value;
    };
    $("#addPrepaid").onclick = () => {
      prepaidRows.push({ name: "", amount: "", currency: "" });
      showPrepaid();
    };
    $("#scanTripDocs").onclick = async () => {
      const files = [...$("#tripDocuments").files],
        status = $("#documentStatus"),
        button = $("#scanTripDocs");
      if (!files.length || files.length > 2) {
        status.textContent = "בחר מסמך אחד או שניים.";
        return;
      }
      if (
        files.some(
          (f) =>
            f.size > 4 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type),
        )
      ) {
        status.textContent = "אפשר לבחור PDF או תמונה עד 4MB לכל קובץ.";
        return;
      }
      button.disabled = true;
      status.textContent = "סורק ומחלץ את פרטי הטיול…";
      try {
        const encoded = await Promise.all(
          files.map(async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 32768)
              binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            return { type: file.type, data: btoa(binary) };
          }),
        );
        const data = await aiCall("documents", { trip: { city: $("#newCity").value }, files: encoded });
        const x = data.extracted || {},
          arrival = x.arrival || {},
          departure = x.departure || {};
        scannedDetails = { ...scannedDetails, ...x, arrival, departure };
        const destination = x.destination || x.city;
        if (destination) $("#newCity").value = destination;
        if (x.start && validISO(x.start)) $("#newStart").value = x.start;
        else if (arrival.date && validISO(arrival.date)) $("#newStart").value = arrival.date;
        else if (x.hotelCheckIn && validISO(x.hotelCheckIn)) $("#newStart").value = x.hotelCheckIn;
        if (x.end && validISO(x.end)) $("#newEnd").value = x.end;
        else if (x.hotelCheckOut && validISO(x.hotelCheckOut)) $("#newEnd").value = x.hotelCheckOut;
        else if (departure.date && validISO(departure.date)) $("#newEnd").value = departure.date;
        if (x.people && Number.isInteger(Number(x.people)) && Number(x.people) > 0) {
          if (!existingCountLocked) {
            readPeople();
            const count = Math.min(1000, Number(x.people));
            while (peopleDraft.length < count)
              peopleDraft.push({ name: `משתתף ${peopleDraft.length + 1}`, budget: "" });
            peopleDraft = peopleDraft.slice(0, count);
            $("#newPeople").value = count;
            renderPeople();
          }
        }
        if (x.hotel) $("#tripHotel").value = x.hotel;
        if (Array.isArray(x.prepaidExpenses)) {
          const seen = new Set(prepaidRows.map((r) => `${String(r.name).toLowerCase()}|${r.amount}|${r.currency}`));
          for (const cost of x.prepaidExpenses) {
            const row = {
              name: String(cost.name || "").slice(0, 120),
              amount: cost.amount == null ? "" : String(cost.amount),
              currency: currencies.includes(String(cost.currency || "").toUpperCase())
                ? String(cost.currency).toUpperCase()
                : "",
            };
            if (row.name && row.amount && !seen.has(`${row.name.toLowerCase()}|${row.amount}|${row.currency}`)) {
              prepaidRows.push(row);
              seen.add(`${row.name.toLowerCase()}|${row.amount}|${row.currency}`);
            }
          }
          showPrepaid();
        }
        $("#documentResults").innerHTML =
          `<div class="document-result"><b>פרטי הטיול שחולצו — בדוק ותקן לפני השמירה</b><p>יעד: ${escapeHTML(destination || "לא זוהה")}</p><p>תאריכים: ${escapeHTML($("#newStart").value || "לא זוהו")} עד ${escapeHTML($("#newEnd").value || "לא זוהו")}</p><p>נוסעים: ${escapeHTML(x.people || "לא זוהה")}</p><p>מלון / נקודת התחלה: ${escapeHTML(x.hotel || "לא זוהה")}</p><p>נחיתה: ${escapeHTML(arrival.date || "לא זוהה")} ${escapeHTML(arrival.time || "")} ${escapeHTML(arrival.airport || "")}</p><p>המראה חזרה: ${escapeHTML(departure.date || "לא זוהה")} ${escapeHTML(departure.time || "")} ${escapeHTML(departure.airport || "")}</p><small>${escapeHTML(data.message || "")}</small></div>`;
        status.textContent = "הסריקה הושלמה. בדוק את הפרטים ואת התקציב האישי; הקבצים לא נשמרים.";
      } catch (error) {
        status.textContent = error.message || "סריקת המסמכים נכשלה.";
      } finally {
        button.disabled = false;
      }
    };
    $("#tripForm").onsubmit = async (e) => {
      e.preventDefault();
      const button = e.submitter,
        error = $("#formError");
      button.disabled = true;
      error.textContent = "";
      readPeople();
      try {
        const people = peopleDraft.map((p, i) => {
          const name = String(p.name || "").trim(),
            raw = String(p.budget ?? "").trim(),
            budget = raw === "" ? 0 : Number(raw);
          if (!name) throw Error(`יש למלא שם למשתתף ${i + 1}`);
          if (!Number.isFinite(budget) || budget < 0 || budget > 100000000 || (!t && budget <= 0))
            throw Error(`יש למלא תקציב אישי תקין עבור ${name}`);
          return { id: p.id || crypto.randomUUID(), name, budget };
        });
        const newCosts = [];
        for (const row of prepaidRows) {
          const name = String(row.name || "").trim(),
            originalAmount = Number(row.amount),
            originalCurrency = String(row.currency || "").toUpperCase();
          if (
            !name ||
            !Number.isFinite(originalAmount) ||
            originalAmount <= 0 ||
            !currencies.includes(originalCurrency)
          )
            throw Error("בדוק את שם ההוצאה, הסכום והמטבע של כל עלות ששולמה מראש.");
          const duplicate = (t?.expenses || []).some(
            (old) =>
              old.source === "travel-document" &&
              old.name.toLowerCase() === name.toLowerCase() &&
              Math.abs(Number(old.originalAmount) - originalAmount) < 0.005 &&
              old.originalCurrency === originalCurrency,
          );
          if (duplicate) continue;
          const { rate, date } = await currencyRate(originalCurrency, $("#tripCurrency").value),
            amount = Math.round(originalAmount * rate * 100) / 100;
          newCosts.push({
            id: crypto.randomUUID(),
            name,
            amount,
            shared: true,
            personalParticipantId: null,
            splits: makeEqualSplits(amount, people),
            originalAmount,
            originalCurrency,
            rate,
            rateDate: date,
            source: "travel-document",
          });
        }
        const avgBudget = Math.round((people.reduce((sum, p) => sum + p.budget, 0) / people.length) * 100) / 100;
        const next = TripModel.trip({
          ...t,
          city: $("#newCity").value,
          start: $("#newStart").value,
          end: $("#newEnd").value,
          people: people.length,
          participants: people,
          currency: $("#tripCurrency").value,
          budgetPerPerson: avgBudget,
          hotel: $("#tripHotel").value,
          travelDetails: {
            ...scannedDetails,
            prepaidExpenses: prepaidRows.length
              ? prepaidRows.map((r) => ({ ...r }))
              : scannedDetails.prepaidExpenses || [],
          },
          expenses: [...(t?.expenses || []), ...newCosts],
        });
        if (next.stops.some((s) => s.date < next.start || s.date > next.end))
          throw Error("יש תחנות מחוץ לטווח התאריכים החדש. העבר אותן לימים אחרים לפני השמירה.");
        const before = state.trips;
        state.trips = t ? state.trips.map((x) => (x.id === t.id ? next : x)) : [next, ...state.trips];
        try {
          save();
        } catch (err) {
          state.trips = before;
          throw err;
        }
        renderTrips();
        closeModal();
        selectTrip(next.id);
        toast("הטיול והתקציבים האישיים נשמרו");
      } catch (err) {
        error.textContent = err.message || "לא ניתן לשמור. בדוק את הפרטים ואת החיבור.";
      } finally {
        button.disabled = false;
      }
    };
  }

  function enhancedBudget() {
    const t = currentTrip();
    if (!t) return;
    const summary = TripModel.budgetSummary(t);
    const oldRender = window.__triplyBudgetBase;
    if (oldRender) oldRender();
    const hero = $(".budget-hero");
    if (hero)
      hero.innerHTML = `<div><span>יתרה כוללת לכל המשתתפים · ${escapeHTML(t.currency)}</span><strong class="budget-remaining-total">${money(summary.totalRemaining)}</strong><small>תקציב כולל ${money(summary.totalBudget)} · הוצאות שנרשמו ${money(summary.totalSpent)}</small></div>`;
    const list = $(".participant-balances");
    if (list)
      list.innerHTML = summary.participants
        .map(
          (p) =>
            `<article class="participant-balance"><div class="participant-balance-head"><b>${escapeHTML(p.name)}</b><strong class="${p.remaining < 0 ? "over-budget" : ""}">${money(p.remaining)} <small>${escapeHTML(t.currency)} נותרו</small></strong></div><p>תקציב אישי ${money(p.budget)} · הוצאות ${money(p.spent)} ${escapeHTML(t.currency)}</p></article>`,
        )
        .join("");
  }

  function rememberChatProfile(answer, trip) {
    const text = String(answer || "")
        .trim()
        .slice(0, 1000),
      activities = [
        ["בטן־גב", /בטן[\s-־]?גב|חוף|חופים|ים|beach|swim/i],
        ["אקסטרים", /אקסטרים|הרפתקאות|adrenaline/i],
        ["נופים", /נוף|נופים|תצפית|תצפיות|view/i],
        ["תרבות והיסטוריה", /תרבות|היסטוריה|היסטורי|culture|history/i],
        ["מוזיאונים", /מוזיאון|מוזיאונים|museum/i],
        ["טבע וטיולים", /טבע|פארק|פארקים|טיול רגלי|hiking|nature/i],
        ["קניות", /קניות|שופינג|shopping/i],
        ["חיי לילה", /חיי לילה|מועדון|מועדונים|nightlife/i],
        ["רגוע", /רגוע|נינוח|בלי לחץ|relaxed/i],
      ];
    const isNegated = (match) => {
      const index = text.search(match);
      if (index < 0) return false;
      return /(?:לא\s+(?:אוהב(?:ת)?|רוצה|מתאים)|בלי|נמנע(?:ת)?)\s*(?:את\s+)?$/i.test(
        text.slice(Math.max(0, index - 24), index),
      );
    };
    const selected = activities
      .filter(([, pattern]) => pattern.test(text) && !isNegated(pattern))
      .map(([label]) => label);
    const kind = text
      .match(
        /(?:^|[\s,;])(?:זוגי|חברים|משפחה|טיול\s+לבד|לבד|אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|עם\s+הילדים|my\s+wife|my\s+husband|my\s+partner)(?=$|[\s,;.!?])/i,
      )?.[0]
      ?.trim()
      .replace(/\s+/g, " ");
    const normalizedKind = /אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|my\s+(?:wife|husband|partner)/i.test(kind || "")
      ? "זוגי"
      : kind === "לבד" || kind === "טיול לבד"
        ? "טיול יחיד"
        : /ילדים/i.test(kind || "")
          ? "משפחה"
          : kind;
    let changed = false;
    if (!String(trip.travelType || "").trim() && normalizedKind) {
      trip.travelType = normalizedKind;
      changed = true;
    }
    const current = Array.isArray(trip.activityTypes) ? trip.activityTypes : [];
    const merged = Array.from(new Set(current.concat(selected)));
    if (merged.length !== current.length) {
      trip.activityTypes = merged;
      changed = true;
    }
    const oldNotes = String(preferences.profileNotes || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (text && !oldNotes.some((value) => value.toLocaleLowerCase() === text.toLocaleLowerCase())) {
      preferences.profileNotes = oldNotes.concat([text]).slice(-4).join("\n").slice(0, 1500);
      changed = true;
    }
    if (
      /קצב\s*(?:רגוע|נינוח)|(?:רגוע|נינוח)\s*(?:לגמרי|יותר)?|בלי\s+לחץ/i.test(text) &&
      !isNegated(/(?:רגוע|נינוח)/i)
    ) {
      preferences.pace = "relaxed";
      changed = true;
    } else if (
      /קצב\s*(?:עמוס|מלא)|(?:עמוס|מלא)\s*(?:כמה\s+שיותר|בכל\s+יום)?|להספיק\s+כמה\s+שיותר/i.test(text) &&
      !isNegated(/(?:עמוס|מלא)/i)
    ) {
      preferences.pace = "busy";
      changed = true;
    } else if (/קצב\s*מאוזן|מאוזן/i.test(text) && !isNegated(/מאוזן/i)) {
      preferences.pace = "balanced";
      changed = true;
    }
    if (selected.length) {
      const prior = String(preferences.interests || "")
        .split(/[,،;؛]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      preferences.interests = Array.from(new Set(prior.concat(selected)))
        .join(", ")
        .slice(0, 1000);
    }
    if (!changed) return false;
    try {
      if (typeof profileStorageKey === "function")
        localStorage.setItem(profileStorageKey("preferences"), JSON.stringify(preferences));
      return true;
    } catch {
      return false;
    }
  }

  function enhancedChat() {
    const t = currentTrip();
    if (!t) {
      toast("בחר טיול כדי להתחיל לתכנן");
      return;
    }
    let sending = false;
    openModal(
      `<div class="chat-heading"><h2>מתכננים את ${escapeHTML(t.city)}</h2><p>אפשר להתחיל מבקשה כללית או לציין מקומות משלך. אם צריך, אשאל מה מתאים לך לפני שאציע תוכנית. שום שינוי לא יישמר בלי אישור.</p></div><div id="chatHistory" class="chat-history" role="log" aria-live="polite" aria-label="התכתבות עם מתכנן הטיול"></div><div id="proposalPanel"></div><form id="chatForm" class="chat-composer"><label for="chatMessage">מה תרצה לתכנן או לשנות?</label><textarea id="chatMessage" rows="3" maxlength="3000" required placeholder="${t.dailySchedule?.length ? "למשל: תעביר את העין של לונדון ליום שלישי בבוקר · תוסיף שוק אוכל ביום שישי · מה יש לנו מחר?" : "למשל: תכנן לי טיול שמתאים לנו בניו יורק"}"></textarea><div class="chat-send-row"><p id="chatStatus" role="status"></p><button id="chatSend" class="primary-btn" type="submit">שליחה</button></div></form>`,
    );
    $("#modalContent").classList.add("chat-dialog");
    const originalClose = closeModal;
    $(".modal-close").onclick = () => {
      originalClose();
      $("#modalContent").classList.remove("chat-dialog");
    };
    const draw = () => {
      $("#chatHistory").innerHTML = t.chat.length
        ? t.chat
            .map((m) => {
              const sources = (Array.isArray(m.sources) ? m.sources : [])
                .filter(
                  (source) =>
                    source &&
                    typeof source.name === "string" &&
                    typeof source.url === "string" &&
                    /^https:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com\/|maps\.app\.goo\.gl\/)/i.test(
                      source.url,
                    ),
                )
                .slice(0, 12);
              return `<div class="message ${m.role === "user" ? "from-user" : "from-assistant"}"><b>${m.role === "user" ? "אתה" : "מתכנן הטיול"}</b><p>${escapeHTML(m.text)}</p>${sources.length ? `<div class="maps-sources"><span>מקורות: Google Maps</span>${sources.map((source) => `<a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.name)}</a>`).join("")}</div>` : ""}</div>`;
            })
            .join("")
        : t.dailySchedule?.length
          ? '<div class="message from-assistant"><p>אפשר לבקש ממני להזיז, להוסיף או להוריד מקומות, לשנות שעות ומשך ביקורים, או לשאול על התוכנית. כל שינוי יוצג לאישור, ואחרי האישור הלוח וזמני ההליכה והנסיעה מתעדכנים לבד.</p></div>'
          : '<div class="message from-assistant"><p>ספר לי מה תרצה לעשות בטיול. אם אין לך עדיין מקומות בראש, אשאל על הסגנון שלך ואציע כיוונים.</p></div>';
      $("#chatHistory").scrollTop = $("#chatHistory").scrollHeight;
    };
    draw();
    $("#chatMessage").onkeydown = (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $("#chatForm").requestSubmit();
      }
    };
    $("#chatForm").onsubmit = async (e) => {
      e.preventDefault();
      if (sending) return;
      const input = $("#chatMessage"),
        text = input.value.trim();
      if (!text) return;
      sending = true;
      input.value = "";
      const submit = $("#chatSend"),
        status = $("#chatStatus"),
        history = $("#chatHistory"),
        panel = $("#proposalPanel");
      submit.disabled = true;
      status.textContent = "קורא את הבקשה ובודק את הלוח…";
      panel.replaceChildren();
      const planned = Boolean(t.dailySchedule?.length);
      t.chat.push({ role: "user", text });
      // A request for the whole trip goes to the full planner (interview → plan → preview).
      if (window.TriplyAutoPlan && TriplyAutoPlan.wantsWholeTrip(text) && !(planned && ONE_DAY.test(text))) {
        try {
          save();
        } catch {}
        draw();
        sending = false;
        submit.disabled = false;
        status.textContent = "";
        panel.replaceChildren();
        TriplyAutoPlan.startInChat(t, text, { panel, draw, status });
        return;
      }
      try {
        const previousMessages = t.chat.slice(-9, -1);
        const answeredDiscovery = previousMessages.some(
          (m) => m.role === "assistant" && /איך אתה אוהב לטייל|איזה סגנון טיול מתאים לך/i.test(String(m.text || "")),
        );
        const volunteeredProfile =
          /(?:זוג(?:י|ית)?|בן.{0,4}זוג|בת.{0,4}זוג|אשתי|בעלי|חברים|חברה שלי|ילדים|משפחה|טיול\s+לבד|לבד|couple|wife|husband|partner|friends|family|kids|solo)/i.test(
            text,
          ) &&
          /(?:בטן[\s-־]?גב|חופים?|ים|אקסטרים|הרפתקאות|נופים?|תצפיות|תרבות|היסטוריה|מוזיאונים?|טבע|פארקים?|קניות|שופינג|חיי\s+לילה|adventure|nature|museums?|culture|shopping|nightlife)/i.test(
            text,
          );
        const remembered = answeredDiscovery || volunteeredProfile ? rememberChatProfile(text, t) : false;
        save();
        draw();
        const conversation = previousMessages
          .slice(-6)
          .map((m) => ({ role: m.role, text: String(m.text || "").slice(0, m.role === "assistant" ? 400 : 800) }));
        const compact = compactTrip(t);
        const data = await askPlanner(text, compact, conversation);
        if (!history.isConnected) return;
        const proposal = await buildProposal(t, data, compact, text);
        let assistantText = String(data.message || "").trim();
        if (remembered) assistantText += "\n\nשמרתי את ההעדפות האלה לטיולים הבאים במכשיר הזה. אפשר לשנות אותן בהגדרות.";
        if (proposal.error) {
          assistantText +=
            (assistantText ? "\n\n" : "") +
            `לא הצלחתי להכניס את השינוי ללוח: ${proposal.error} אפשר לנסח אחרת, או לערוך ידנית בלחיצה על השורה בלוח.`;
        } else if (proposal.lines.length) {
          assistantText +=
            (assistantText ? "\n\n" : "") +
            "הכנתי הצעה לבדיקה למטה. שום דבר לא נשמר עד שתאשר; אחרי השמירה אפשר להמשיך לערוך הכל.";
        } else if (proposal.warnings?.length) {
          assistantText += (assistantText ? "\n\n" : "") + proposal.warnings.join(" ");
        } else if (proposal.ignored) {
          assistantText +=
            (assistantText ? "\n\n" : "") +
            "לא נוצר שינוי במסלול. אם רצית לשנות משהו, כתוב לי בדיוק מה להזיז, להוסיף או להסיר.";
        }
        t.chat.push({
          role: "assistant",
          text: assistantText || "לא הבנתי את הבקשה. אפשר לנסח אותה אחרת?",
          sources: Array.isArray(data.sources) ? data.sources : [],
        });
        save();
        draw();
        status.textContent = "";
        if (proposal.error || !proposal.lines.length) return;
        panel.innerHTML = `<h3>הצעה לשינויים · ${proposal.lines.length} פרטים</h3><ul>${proposal.lines.map((x) => "<li>" + escapeHTML(x) + "</li>").join("")}</ul>${proposal.warnings.map((w) => `<p class="ap-warn">⚠ ${escapeHTML(w)}</p>`).join("")}<p>בדוק את ההצעה. שום דבר לא משתנה עד לאישור. זמני ההליכה והנסיעה ושעות הפתיחה הם הערכה.</p><div class="modal-actions"><button id="rejectProposal" class="secondary-btn">ביטול ההצעה</button><button id="acceptProposal" class="primary-btn">אישור ועדכון הטיול</button></div>`;
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        $("#rejectProposal").onclick = () => {
          panel.replaceChildren();
          status.textContent = "ההצעה בוטלה; המסלול נשאר ללא שינוי.";
        };
        $("#acceptProposal").onclick = async (ev) => {
          ev.currentTarget.disabled = true;
          let res = window.TriplyReflow.apply(t, proposal.prepared);
          if (!res.ok && res.conflict) {
            // The trip changed meanwhile (e.g. on another device): the same answer is applied to the new version.
            const again = await buildProposal(t, data, compact, text);
            res = again.error ? { ok: false, message: again.error } : window.TriplyReflow.apply(t, again.prepared);
          }
          if (!res.ok) {
            status.textContent = res.message || "לא ניתן לשמור את השינוי. הטיול הקודם נשמר.";
            panel.replaceChildren();
            return;
          }
          panel.replaceChildren();
          status.textContent = proposal.changedDays
            ? "השינויים נשמרו, והלוח וזמני הדרך עודכנו."
            : `${proposal.lines.length} השינויים נשמרו בטיול.`;
          t.chat.push({ role: "assistant", text: "✓ השינויים נשמרו בטיול." });
          try {
            save();
          } catch {}
          draw();
          if (currentTrip()?.id === t.id) {
            const first = proposal.focusDate;
            if (first && TripModel.dates(t.start, t.end).includes(first)) selectedDate = first;
            if (!TripModel.dates(t.start, t.end).includes(selectedDate)) selectedDate = t.start;
            renderTrip();
          }
        };
      } catch (err) {
        if (status.isConnected) {
          const message = err.message || "הבקשה נכשלה. נסה שוב.";
          t.chat.push({
            role: "assistant",
            text: `לא הצלחתי להשלים את הבקשה: ${message}`,
          });
          try {
            save();
            draw();
          } catch {}
          status.textContent = message;
        }
      } finally {
        sending = false;
        if (submit.isConnected) submit.disabled = false;
      }
    };
  }

  /* ---------- What the chat sends: a short summary of the trip, not the whole saved data ---------- */
  // `\b` does not work with Hebrew letters in JS, so word edges are spelled out (no look-behind: older iPhones).
  const ONE_DAY =
    /(?:ב|ל)?יום\s+(?:ה?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|אחרון)|\d{1,2})|(?:^|[^\u0590-\u05FF])(?:ל|ו|ב|מ)?(?:מחר|מחרתיים|היום)(?![\u0590-\u05FF])|ב-?\d{1,2}[./]\d{1,2}/;
  function compactTrip(t) {
    const ids = new Map(),
      back = new Map();
    t.stops.forEach((s, i) => {
      ids.set(s.id, "s" + (i + 1));
      back.set("s" + (i + 1), s.id);
    });
    const pids = new Map(),
      pback = new Map();
    (t.participants || []).forEach((p, i) => {
      pids.set(p.id, "p" + (i + 1));
      pback.set("p" + (i + 1), p.id);
    });
    const eids = new Map(),
      eback = new Map();
    (t.expenses || []).forEach((x, i) => {
      eids.set(x.id, "e" + (i + 1));
      eback.set("e" + (i + 1), x.id);
    });
    const L = window.TriplyDayLayout;
    const days = (t.dailySchedule || []).map((d) => ({
      date: d.date,
      wake: d.wakeTime,
      sleep: d.sleepTime,
      items: d.blocks
        .filter((b) => (L ? L.roleOf(b) !== "travel" : true))
        .map((b) => {
          const id = b.existingStopId && ids.get(b.existingStopId);
          return `${b.startTime}-${b.endTime} ${id ? `[${id}] ` : ""}${String(b.activity || "").slice(0, 70)}`;
        })
        .slice(0, 30),
    }));
    const td = t.travelDetails || {};
    const pts = t.stops.filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)));
    const center = pts.length
      ? { lat: pts.reduce((a, s) => a + +s.lat, 0) / pts.length, lng: pts.reduce((a, s) => a + +s.lng, 0) / pts.length }
      : td.lodgingPoint && Number.isFinite(Number(td.lodgingPoint.lat))
        ? { lat: +td.lodgingPoint.lat, lng: +td.lodgingPoint.lng }
        : null;
    return {
      ids,
      back,
      pback,
      eback,
      trip: {
        city: t.city,
        start: t.start,
        end: t.end,
        people: t.people,
        currency: t.currency,
        hotel: t.hotel,
        travelType: t.travelType,
        activityTypes: (t.activityTypes || []).slice(0, 12),
        arrival: td.arrival ? { date: td.arrival.date || "", time: td.arrival.time || "" } : {},
        departure: td.departure ? { date: td.departure.date || "", time: td.departure.time || "" } : {},
        center,
      },
      days,
      stops: t.stops.slice(0, 120).map((s) => ({
        id: ids.get(s.id),
        name: String(s.name || "").slice(0, 90),
        he: String(s.notes || "")
          .split(" · ")[0]
          .slice(0, 50),
        date: s.date,
        time: s.time,
        duration: s.duration,
      })),
      participants: (t.participants || []).map((p) => ({ id: pids.get(p.id), name: p.name, budget: p.budget })),
      expenses: (t.expenses || []).slice(0, 40).map((x) => ({
        id: eids.get(x.id),
        name: String(x.name || "").slice(0, 60),
        amount: x.amount,
        shared: x.shared !== false,
        person: x.personalParticipantId ? pids.get(x.personalParticipantId) || "" : "",
      })),
    };
  }
  /* The "edit" mode of the server answers with small change lists; an older server only knows "plan" —
   * then the same short summary goes there (without the day plan, so it never hits the size limit). */
  async function askPlanner(text, c, conversation) {
    const pref = {
      pace: preferences.pace,
      interests: String(preferences.interests || "").slice(0, 300),
      profileNotes: String(preferences.profileNotes || "").slice(0, 600),
    };
    try {
      return await aiCall("edit", {
        message: text,
        trip: c.trip,
        days: c.days,
        stops: c.stops,
        participants: c.participants,
        expenses: c.expenses,
        preferences: pref,
        history: conversation,
      });
    } catch (err) {
      if (!/בקשה לא תקינה/.test(String(err?.message || ""))) throw err;
    }
    const data = await aiCall("plan", {
      message: text,
      trip: {
        city: c.trip.city,
        start: c.trip.start,
        end: c.trip.end,
        people: c.trip.people,
        currency: c.trip.currency,
        hotel: c.trip.hotel,
        travelType: c.trip.travelType,
        activityTypes: c.trip.activityTypes,
        travelDetails: { arrival: c.trip.arrival, departure: c.trip.departure },
        participants: c.participants,
        stops: c.stops.map((s) => ({
          id: s.id,
          name: s.name,
          date: s.date,
          time: s.time,
          duration: s.duration,
          notes: "",
        })),
        expenses: [],
        dailySchedule: [],
      },
      preferences: pref,
      history: conversation,
    });
    return { ...data, fromPlan: true };
  }

  /* Without a day plan: the first free time on that day (after the last place + 30 minutes, from 10:00). */
  function freeTimeOn(trip, date) {
    const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    const end = trip.stops
      .filter((s) => s.date === date && /^\d{2}:\d{2}$/.test(s.time))
      .reduce((m, s) => Math.max(m, toMin(s.time) + (Number(s.duration) || 60) + 30), 10 * 60);
    const v = Math.min(end, 21 * 60);
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  }
  /* ---------- Turning the answer into a checked proposal (nothing is saved here) ---------- */
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  async function buildProposal(t, data, c, text = "") {
    if (!data || typeof data !== "object") return { error: "התשובה לא הייתה תקינה.", lines: [], warnings: [] };
    // "…באותה שעה" / "…ב-14:00": the time the planner gives is kept even when the place also moves to another day.
    const wantsTime = /\d{1,2}[:.]\d{2}|בשעה|באותה (?:ה)?שעה|באותו (?:ה)?זמן/.test(String(text));
    const notes = [];
    const ops = Array.isArray(data.operations) ? data.operations.slice(0, 25) : [];
    const dates = TripModel.dates(t.start, t.end);
    const hints = {};
    const lines = [];
    let ignored = 0;
    const realId = (id) => c.back.get(String(id || "")) || (t.stops.some((s) => s.id === id) ? id : null);
    const touched = new Map(); // stop id → { kind, before }
    const mutate = (draft) => {
      // Trip details, people and expenses keep using the app's own validator.
      const extra = {};
      let changes = data.tripChanges && typeof data.tripChanges === "object" ? { ...data.tripChanges } : {};
      // On a planned trip the destination, dates, travellers and currency are changed in the trip's own form
      // (here they would wipe the day plan).
      if (draft.dailySchedule?.length) {
        const off = ["city", "start", "end", "people", "currency"].filter(
          (k) => changes[k] !== undefined && JSON.stringify(changes[k]) !== JSON.stringify(draft[k]),
        );
        for (const k of ["city", "start", "end", "people", "currency"]) delete changes[k];
        if (off.length && !notes.length)
          notes.push('שינוי יעד, תאריכים, מספר נוסעים או מטבע עושים ב"עריכת פרטי הטיול" — לא נכלל בהצעה.');
      }
      if (Object.keys(changes).length) extra.tripChanges = changes;
      if (Array.isArray(data.participants) && data.participants.length)
        extra.participants = data.participants.map((p) => ({ ...p, id: c.pback.get(String(p.id || "")) || "" }));
      if (Array.isArray(data.expenseOperations) && data.expenseOperations.length)
        extra.expenseOperations = data.expenseOperations.map((x) => ({
          ...x,
          id: c.eback.get(String(x.id || "")) || "",
          personalParticipantId: c.pback.get(String(x.personalParticipantId || x.person || "")) || "",
        }));
      if (Object.keys(extra).length) {
        const p = TripPlanning.apply(draft, { operations: [], ...extra });
        const oldTd = draft.travelDetails || {};
        for (const k of [
          "city",
          "start",
          "end",
          "people",
          "currency",
          "budgetPerPerson",
          "hotel",
          "travelType",
          "activityTypes",
          "travelDetails",
          "participants",
          "expenses",
          "dailySchedule",
          "scheduleStopSnapshot",
        ])
          draft[k] = p.trip[k];
        // Flight changes in words ("טיסה הביתה: יום ג׳, 24.11 18:00 ← 17:45"), not the raw saved data.
        const when = (x) => (x?.date ? window.TriplyReflow.dayShort(x.date) + " " : "") + (x?.time || "");
        const flight = [];
        for (const [key, name] of [
          ["arrival", "נחיתה"],
          ["departure", "טיסה הביתה"],
        ]) {
          const a = oldTd[key] || {},
            b = draft.travelDetails?.[key] || {};
          if (a.date !== b.date || a.time !== b.time) flight.push(`${name}: ${when(a) || "—"} ← ${when(b) || "—"}`);
        }
        lines.push(...p.changes.flatMap((x) => (/^פרטי טיסה ומלון:/.test(x) ? flight : [x])));
      }
      for (const op of ops) {
        if (!op || !["add", "update", "remove", "move"].includes(op.type)) {
          ignored++;
          continue;
        }
        if (op.type === "add") {
          const name = String(op.name || "")
            .trim()
            .slice(0, 200);
          if (!name) {
            ignored++;
            continue;
          }
          const date = dates.includes(op.date) ? op.date : dates.includes(selectedDate) ? selectedDate : dates[0];
          const time = HHMM.test(String(op.time || "")) ? op.time : "";
          const dur = Number(op.duration);
          const st = {
            id: crypto.randomUUID(),
            name,
            date,
            time: time || (draft.dailySchedule?.length ? "12:00" : freeTimeOn(draft, date)),
            duration: Number.isFinite(dur) && dur >= 10 && dur <= 600 ? Math.round(dur) : 60,
            notes: String(op.notes || "").slice(0, 500),
          };
          if (Number.isFinite(Number(op.lat)) && Number.isFinite(Number(op.lng))) {
            st.lat = Number(op.lat);
            st.lng = Number(op.lng);
          }
          draft.stops.push(st);
          hints[st.id] = time ? "time" : "auto";
          touched.set(st.id, { kind: "add" });
          continue;
        }
        const id = realId(op.id);
        const st = id && draft.stops.find((s) => s.id === id);
        if (!st) {
          ignored++;
          continue;
        }
        if (op.type === "remove") {
          draft.stops = draft.stops.filter((s) => s.id !== id);
          touched.set(id, { kind: "remove", name: st.name });
          continue;
        }
        const before = { ...st };
        // A different place instead of this one only when the planner says so explicitly (newName);
        // `name` in an update is just the planner repeating which place it means.
        const newName = String(op.newName || "").trim();
        if (newName && newName.toLocaleLowerCase() !== st.name.toLocaleLowerCase()) {
          st.name = newName.slice(0, 200);
          delete st.lat;
          delete st.lng;
          if (Number.isFinite(Number(op.lat)) && Number.isFinite(Number(op.lng))) {
            st.lat = Number(op.lat);
            st.lng = Number(op.lng);
          }
        }
        const newDate = dates.includes(op.date) ? op.date : st.date;
        const newTime = HHMM.test(String(op.time || "")) ? op.time : "";
        const dur = Number(op.duration);
        if (Number.isFinite(dur) && dur >= 10 && dur <= 600) st.duration = Math.round(dur);
        const dayChanged = newDate !== st.date;
        st.date = newDate;
        if (newTime && (newTime !== st.time || (dayChanged && wantsTime))) {
          st.time = newTime;
          hints[id] = "time";
        } else if (dayChanged) hints[id] = "auto";
        else hints[id] = "keep";
        if (
          JSON.stringify([before.name, before.date, before.time, before.duration]) ===
          JSON.stringify([st.name, st.date, st.time, st.duration])
        ) {
          delete hints[id];
          continue;
        }
        touched.set(id, { kind: "update", before });
      }
    };
    const prepared = await window.TriplyReflow.prepare(t, mutate, { hints });
    if (!prepared.ok) return { error: prepared.message || "השינוי לא תקין.", lines: [], warnings: [] };
    const label = (st) => (st ? `${st.name} · ${window.TriplyReflow.dayShort(st.date)} בשעה ${st.time}` : "");
    for (const [id, x] of touched) {
      const st = prepared.trip.stops.find((s) => s.id === id);
      if (x.kind === "add") lines.push("הוספה: " + label(st));
      else if (x.kind === "remove") lines.push("הסרה: " + x.name);
      else if (st) {
        const what = [];
        if (st.name !== x.before.name) what.push(`שם: ${x.before.name} ← ${st.name}`);
        if (st.date !== x.before.date || st.time !== x.before.time)
          what.push(
            `${window.TriplyReflow.dayShort(x.before.date)} ${x.before.time} ← ${window.TriplyReflow.dayShort(st.date)} ${st.time}`,
          );
        if (Number(st.duration) !== Number(x.before.duration))
          what.push(`משך ${x.before.duration} ← ${st.duration} דק'`);
        lines.push(`עדכון: ${x.before.name}${what.length ? " · " + what.join(" · ") : ""}`);
      }
    }
    if (prepared.changed?.length)
      lines.push(
        `הלוח וזמני ההליכה והנסיעה יחושבו מחדש ב${prepared.changed.length === 1 ? window.TriplyReflow.dayShort(prepared.changed[0]) : "-" + prepared.changed.length + " ימים"}`,
      );
    const focus = [...touched.keys()]
      .map((id) => prepared.trip.stops.find((s) => s.id === id))
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];
    // Opening hours of the places this change puts somewhere new.
    const hours = [];
    for (const [id, x] of touched) {
      if (x.kind === "remove") continue;
      const day = prepared.trip.dailySchedule?.find((d) => d.blocks.some((b) => b.existingStopId === id));
      const b = day?.blocks.find((y) => y.existingStopId === id);
      const open = b && window.TriplyDayLayout?.openOf(b, prepared.trip.stops);
      if (!open) continue;
      const s0 = window.TriplyDayLayout.toMin(b.startTime),
        e0 = window.TriplyDayLayout.toMin(b.endTime);
      if ((open.open !== null && s0 < open.open) || (open.close !== null && e0 > open.close))
        hours.push(
          `${b.activity.replace(/^ביקור:\s*/, "")} ב-${b.startTime}–${b.endTime}, אבל הוא פתוח בערך ${window.TriplyDayLayout.clock(open.open ?? 0)}–${open.close === null ? "?" : window.TriplyDayLayout.clock(open.close)}`,
        );
    }
    return {
      prepared,
      lines: touched.size || lines.length ? lines : [],
      warnings: [...(prepared.warnings || []), ...hours, ...notes],
      changedDays: prepared.changed?.length || 0,
      focusDate: focus?.date || prepared.changed?.[0] || null,
      ignored: ignored && !touched.size,
    };
  }

  window.__triplyBudgetBase = window.renderBudget;
  window.tripForm = enhancedTripForm;
  window.renderBudget = enhancedBudget;
  window.openChat = enhancedChat;
  const chatButton = $("#aiPlanBtn");
  if (chatButton) chatButton.onclick = enhancedChat;
})();
