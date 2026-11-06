// Cloud save + sharing (Supabase table trip_docs, protected by Row Level Security).
// The device copy stays the working copy; this file keeps it in sync with the account.
(function () {
  "use strict";
  const URL_BASE = "https://pjkvfcvqibwcxordyxfv.supabase.co/rest/v1";
  const KEY = typeof AUTH_PUBLIC_KEY === "string" ? AUTH_PUBLIC_KEY : "";
  let uid = null,
    token = null,
    known = {},
    timer = null,
    busy = false,
    again = false,
    available = true,
    started = false,
    gen = 0;
  const syncKey = () => "triply:sync:" + uid;
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + ":" + s.length;
  };
  const tripHash = (t) => hash(JSON.stringify(t));
  const loadKnown = () => {
    try {
      known = JSON.parse(localStorage.getItem(syncKey()) || "{}") || {};
    } catch {
      known = {};
    }
  };
  const saveKnown = () => {
    try {
      localStorage.setItem(syncKey(), JSON.stringify(known));
    } catch {}
  };
  const status = (text) => {
    const el = $("#storageStatus");
    if (el) el.textContent = text;
  };
  async function session() {
    const s = await window.triplyAuth?.getSession?.();
    token = s?.access_token || null;
    if (!token) throw Object.assign(Error("signed out"), { status: 401 });
    return token;
  }
  async function api(path, { method = "GET", body, prefer } = {}) {
    await session();
    const headers = { apikey: KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(URL_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const err = Error(data?.message || data?.error || "HTTP " + res.status);
      err.status = res.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }
  /* ---- Both this device and another one changed the same trip before syncing: merge instead of dropping ----
   * `base` is the last version both sides had (saved with every sync). Per field: whoever changed it wins;
   * expenses, people and chat messages changed on both sides are merged item by item; the plan (places +
   * day plan) changed on both sides keeps this device's version. */
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeById(base, mine, theirs) {
    const map = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x.id).map((x) => [x.id, x]));
    const B = map(base),
      M = map(mine),
      T = map(theirs);
    const out = [];
    for (const [id, t] of T) {
      if (M.has(id)) out.push(B.has(id) && same(M.get(id), B.get(id)) ? t : M.get(id));
      else if (!B.has(id) || !same(t, B.get(id))) out.push(t); // new there, or deleted here but changed there
    }
    for (const [id, m] of M) {
      if (T.has(id)) continue;
      if (!B.has(id) || !same(m, B.get(id))) out.push(m); // new here, or deleted there but changed here
    }
    return out;
  }
  function mergeTrip(base, mine, theirs) {
    const out = { ...theirs };
    let conflict = false;
    const plan = ["stops", "dailySchedule", "scheduleStopSnapshot"];
    const changedHere = (k) => !base || !same(mine[k], base[k]);
    const changedThere = (k) => !base || !same(theirs[k], base[k]);
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    for (const k of keys) {
      if (plan.includes(k) || k === "id") continue;
      if (same(mine[k], theirs[k]) || !changedHere(k)) continue; // theirs (or equal)
      if (!changedThere(k)) {
        out[k] = mine[k];
        continue;
      }
      if (k === "expenses" || k === "participants") out[k] = mergeById(base?.[k], mine[k], theirs[k]);
      else if (k === "chat") {
        const seen = new Set((theirs.chat || []).map((x) => JSON.stringify(x)));
        out.chat = [...(theirs.chat || []), ...(mine.chat || []).filter((x) => !seen.has(JSON.stringify(x)))].slice(
          -80,
        );
      } else {
        out[k] = mine[k];
        conflict = true;
      }
    }
    const planHere = plan.some(changedHere),
      planThere = plan.some(changedThere);
    if (planHere && !plan.every((k) => same(mine[k], theirs[k]))) {
      for (const k of plan) out[k] = mine[k];
      if (planThere) conflict = true;
    }
    try {
      return { trip: TripModel.trip({ ...out, id: mine.id }), conflict };
    } catch {
      return { trip: mine, conflict: true };
    }
  }
  const inPlace = (local, next) => {
    for (const key of Object.keys(local)) if (!(key in next)) delete local[key];
    Object.assign(local, next);
  };
  const localSave = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state.trips));
    } catch {}
  };

  async function pull(g) {
    const rows = await api("/trip_docs?select=id,data,updated_at,deleted,owner_id,share_code");
    if (g !== gen) return;
    const seen = new Set();
    let changed = false,
      notes = [];
    for (const row of rows || []) {
      seen.add(row.id);
      const i = state.trips.findIndex((t) => t.id === row.id),
        k = known[row.id];
      if (row.deleted) {
        if (i >= 0 && k) {
          state.trips.splice(i, 1);
          changed = true;
          notes.push("טיול נמחק ע״י הבעלים");
        }
        delete known[row.id];
        continue;
      }
      let remote;
      try {
        remote = TripModel.trip({ ...row.data, id: row.id });
      } catch {
        continue;
      }
      const owner = row.owner_id === uid;
      if (i < 0) {
        state.trips.push(remote);
        known[row.id] = {
          at: row.updated_at,
          h: tripHash(remote),
          owner,
          code: row.share_code || "",
          b: JSON.stringify(remote),
        };
        changed = true;
        continue;
      }
      const local = state.trips[i];
      if (!k || row.updated_at !== k.at) {
        const localEdited = k && tripHash(local) !== k.h;
        if (!k && tripHash(local) === tripHash(remote)) {
          known[row.id] = {
            at: row.updated_at,
            h: tripHash(remote),
            owner,
            code: row.share_code || "",
            b: JSON.stringify(remote),
          };
          continue;
        }
        if (localEdited) {
          // Both sides changed: merge, keep this device's unsent edits,
          // and send the result. The same object is updated so an open chat or day plan stays live.
          let base = null;
          try {
            base = k?.b ? JSON.parse(k.b) : null;
          } catch {}
          const merged = mergeTrip(base, local, remote);
          inPlace(local, merged.trip);
          known[row.id] = {
            at: row.updated_at,
            h: tripHash(remote),
            owner,
            code: row.share_code || "",
            b: JSON.stringify(remote),
          };
          changed = true;
          notes.push(
            merged.conflict
              ? `"${remote.city}" השתנה גם במכשיר אחר. שילבתי את השינויים; כשהמסלול שונה בשני המקומות, נשמר המסלול מהמכשיר הזה.`
              : `"${remote.city}" עודכן ממכשיר אחר, והשינויים שלך נשמרו`,
          );
          continue;
        }
        // Update the same object, so an open chat or day plan keeps pointing at the live trip.
        inPlace(local, remote);
        known[row.id] = {
          at: row.updated_at,
          h: tripHash(local),
          owner,
          code: row.share_code || "",
          b: JSON.stringify(local),
        };
        changed = true;
        if (k) notes.push(`"${remote.city}" עודכן ממכשיר אחר`);
      } else {
        known[row.id].owner = owner;
        known[row.id].code = row.share_code || "";
      }
    }
    // Access removed (unshared) → drop the local copy that came from the cloud.
    for (const id of Object.keys(known))
      if (!seen.has(id)) {
        const i = state.trips.findIndex((t) => t.id === id);
        if (i >= 0 && !known[id].owner) {
          state.trips.splice(i, 1);
          changed = true;
          notes.push("שיתוף של טיול בוטל");
        }
        if (!known[id].owner || i < 0) delete known[id];
      }
    saveKnown();
    if (changed) {
      localSave();
      renderTrips();
      if (typeof activeId !== "undefined" && activeId) {
        if (currentTrip()) renderTrip();
        else showView("homeView");
      }
    }
    if (notes.length) toast(notes[0]);
  }
  async function push(g) {
    const trips = state.trips;
    for (const t of trips) {
      if (g !== gen) return;
      const k = known[t.id],
        h = tripHash(t);
      if (k && k.h === h) continue;
      if (k) {
        const r = await api("/trip_docs?id=eq." + encodeURIComponent(t.id), {
          method: "PATCH",
          body: { data: t, deleted: false },
          prefer: "return=representation",
        });
        if (Array.isArray(r) && r[0]) known[t.id] = { ...k, at: r[0].updated_at, h, b: JSON.stringify(t) };
        else delete known[t.id];
      } else {
        try {
          const r = await api("/trip_docs", {
            method: "POST",
            body: { id: t.id, data: t },
            prefer: "return=representation",
          });
          known[t.id] = { at: r?.[0]?.updated_at || "", h, owner: true, code: "", b: JSON.stringify(t) };
        } catch (e) {
          if (e.code === "23505") {
            const r = await api("/trip_docs?id=eq." + encodeURIComponent(t.id), {
              method: "PATCH",
              body: { data: t, deleted: false },
              prefer: "return=representation",
            });
            if (r?.[0]) known[t.id] = { at: r[0].updated_at, h, owner: false, code: "", b: JSON.stringify(t) };
          } else throw e;
        }
      }
      saveKnown();
    }
    if (g !== gen) return;
    const ids = new Set(trips.map((t) => t.id));
    for (const [id, k] of Object.entries(known))
      if (!ids.has(id)) {
        if (g !== gen) return;
        if (k.owner)
          await api("/trip_docs?id=eq." + encodeURIComponent(id), { method: "PATCH", body: { deleted: true } });
        else
          await api("/trip_doc_members?trip_id=eq." + encodeURIComponent(id) + "&user_id=eq." + uid, {
            method: "DELETE",
          });
        delete known[id];
        saveKnown();
      }
  }
  async function sync(kind = "both") {
    if (!uid || !available) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    status("שומר בענן…");
    const g = gen;
    try {
      if (!navigator.onLine) throw Object.assign(Error("offline"), { offline: true });
      if (kind !== "push") await pull(g);
      await push(g);
      if (g !== gen) return;
      status("נשמר בענן");
      window.dispatchEvent(new CustomEvent("triply:cloud-ok"));
    } catch (e) {
      if (g !== gen) return;
      if (e.status === 404 || e.code === "42P01" || e.code === "PGRST205") {
        available = false;
        status("שמירה במכשיר זה");
      } else status(e.offline || !navigator.onLine ? "אין חיבור — יישמר כשיחזור" : "השמירה בענן נכשלה, ננסה שוב");
    } finally {
      busy = false;
      if (again && uid) {
        again = false;
        setTimeout(() => sync("push"), 300);
      }
    }
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => sync("push"), 1200);
  };

  // Every local save is also sent to the cloud (debounced).
  const prevSave = save;
  save = function () {
    const r = prevSave.apply(this, arguments);
    if (uid) schedule();
    return r;
  };

  async function joinPending() {
    let code = null;
    try {
      code = sessionStorage.getItem("triply:join");
    } catch {}
    if (!code || !uid) return;
    try {
      sessionStorage.removeItem("triply:join");
    } catch {}
    try {
      const id = await api("/rpc/triply_join", { method: "POST", body: { p_code: code } });
      await pull(gen);
      if (id && state.trips.some((t) => t.id === id)) {
        selectTrip(id);
        toast("הצטרפת לטיול! עכשיו שניכם רואים ועורכים אותו.");
      }
    } catch (e) {
      toast(
        /invite not found/.test(e.message) ? "קישור ההזמנה לא תקף (אולי בוטל)." : "לא הצלחתי להצטרף לטיול. נסה שוב.",
      );
    }
  }
  try {
    const u = new URL(location.href),
      code = u.searchParams.get("join");
    if (code && /^[A-Za-z0-9]{10,32}$/.test(code)) {
      sessionStorage.setItem("triply:join", code);
      u.searchParams.delete("join");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch {}

  function start(user) {
    if (!user?.id || uid === user.id) return;
    uid = user.id;
    available = true;
    loadKnown();
    sync().then(joinPending);
    if (!started) {
      started = true;
      setInterval(() => {
        if (!document.hidden) sync();
      }, 45000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) sync();
      });
      window.addEventListener("online", () => sync());
    }
  }
  // Sign-out: stop syncing at once, so nothing is sent with the old session.
  window.addEventListener("triply:signed-out", () => {
    gen++;
    uid = null;
    token = null;
    known = {};
    again = false;
    clearTimeout(timer);
  });
  const prevActivate = activateSession;
  activateSession = function (s) {
    prevActivate.apply(this, arguments);
    start(s?.user);
    if (uid && available) status("נשמר בענן");
  };
  if (typeof currentUser !== "undefined" && currentUser) start(currentUser);

  // ---- Sharing panel ("חברים") ----
  const inviteLink = (code) => {
    const u = new URL(IS_NATIVE ? WEB_APP_URL : location.href);
    u.search = "";
    u.hash = "";
    u.searchParams.set("join", code);
    return u.toString();
  };
  const newCode = () => {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((x) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 56]).join("");
  };
  async function renderMembers() {
    const panel = $("#membersPanel"),
      t = currentTrip();
    if (!panel || !t) return;
    if (!uid || !available) {
      panel.innerHTML =
        '<div class="empty-state"><h2>שיתוף הטיול</h2><p>כדי לשתף טיול צריך חיבור לאינטרנט וחשבון מחובר.</p></div>';
      return;
    }
    const k = known[t.id];
    if (!k) {
      panel.innerHTML =
        '<div class="share-card"><h2>שיתוף הטיול</h2><p>הטיול נשמר בענן עוד רגע, ואז אפשר יהיה להזמין חברים.</p></div>';
      // A sync that is already running finishes first; redraw when the trip is in the cloud.
      const again = () => {
        if (known[t.id] && currentTrip()?.id === t.id && $("#membersPanel")?.classList.contains("active-panel"))
          renderMembers();
      };
      window.addEventListener("triply:cloud-ok", again, { once: true });
      sync("push").then(again);
      return;
    }
    let members = [];
    try {
      members =
        (await api("/trip_doc_members?trip_id=eq." + encodeURIComponent(t.id) + "&select=user_id,email,joined_at")) ||
        [];
    } catch {}
    if (currentTrip()?.id !== t.id) return;
    const ownerRow = k.owner
      ? `<li><span class="member-dot">${escapeHTML((currentUser?.email || "?").slice(0, 1).toUpperCase())}</span><span>${escapeHTML(currentUser?.email || "")} (את/ה · בעלים)</span></li>`
      : "";
    const list =
      members.length || ownerRow
        ? `<ul class="member-list">${ownerRow}${members.map((m) => `<li><span class="member-dot">${escapeHTML((m.email || "?").slice(0, 1).toUpperCase())}</span><span>${escapeHTML(m.email || "חבר/ה")}${m.user_id === uid ? " (את/ה)" : ""}</span>${k.owner ? `<button type="button" class="text-btn" data-remove-member="${escapeHTML(m.user_id)}">הסרה</button>` : ""}</li>`).join("")}</ul>`
        : '<p class="muted">עדיין אין חברים בטיול.</p>';
    if (k.owner) {
      const link = k.code ? inviteLink(k.code) : "";
      panel.innerHTML = `<div class="share-card"><h2>שיתוף הטיול</h2><p>מי שמקבל את הקישור ומתחבר לחשבון יראה את הטיול ויוכל לערוך אותו איתך. כל שינוי מתעדכן אצל כולם.</p>
        ${link ? `<div class="share-link"><input readonly value="${escapeHTML(link)}" aria-label="קישור הזמנה"><button type="button" class="primary-btn" id="shareInvite">שליחת הקישור</button></div><button type="button" class="text-btn" id="revokeInvite">ביטול הקישור (מי שכבר הצטרף נשאר)</button>` : '<button type="button" class="primary-btn" id="makeInvite">יצירת קישור הזמנה</button>'}
        <h3>מי בטיול</h3>${list}</div>`;
    } else {
      panel.innerHTML = `<div class="share-card"><h2>טיול משותף</h2><p>הוזמנת לטיול הזה. שינויים שלך מתעדכנים אצל כל המשתתפים.</p><h3>מי בטיול</h3>${list}<button type="button" class="secondary-btn" id="leaveTrip">יציאה מהטיול</button></div>`;
    }
    $("#makeInvite")?.addEventListener("click", async () => {
      try {
        const code = newCode();
        const r = await api("/trip_docs?id=eq." + encodeURIComponent(t.id), {
          method: "PATCH",
          body: { share_code: code },
          prefer: "return=representation",
        });
        known[t.id].code = code;
        if (r?.[0]?.updated_at) known[t.id].at = r[0].updated_at;
        saveKnown();
        renderMembers();
      } catch {
        toast("לא הצלחתי ליצור קישור. נסה שוב.");
      }
    });
    $("#revokeInvite")?.addEventListener("click", async () => {
      if (!confirm("לבטל את קישור ההזמנה? מי שכבר הצטרף יישאר בטיול.")) return;
      try {
        const r = await api("/trip_docs?id=eq." + encodeURIComponent(t.id), {
          method: "PATCH",
          body: { share_code: null },
          prefer: "return=representation",
        });
        known[t.id].code = "";
        if (r?.[0]?.updated_at) known[t.id].at = r[0].updated_at;
        saveKnown();
        renderMembers();
      } catch {
        toast("הביטול נכשל");
      }
    });
    $("#shareInvite")?.addEventListener("click", async () => {
      const link = inviteLink(known[t.id].code),
        text = `בוא/י להצטרף לטיול ${t.city} שלי ב-Tropi Trip`;
      if (IS_NATIVE) {
        try {
          await capPlugin("Share").share({ title: "Tropi Trip", text, url: link, dialogTitle: "שליחת קישור הזמנה" });
          return;
        } catch {}
      } else if (navigator.share) {
        try {
          await navigator.share({ title: "Tropi Trip", text, url: link });
          return;
        } catch {}
      }
      try {
        await navigator.clipboard.writeText(link);
        toast("הקישור הועתק — אפשר להדביק בוואטסאפ");
      } catch {
        $(".share-link input")?.select();
        toast("סמן והעתק את הקישור");
      }
    });
    $$("[data-remove-member]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm("להסיר את החבר/ה מהטיול?")) return;
          try {
            await api(
              "/trip_doc_members?trip_id=eq." + encodeURIComponent(t.id) + "&user_id=eq." + b.dataset.removeMember,
              { method: "DELETE" },
            );
            renderMembers();
          } catch {
            toast("ההסרה נכשלה");
          }
        }),
    );
    $("#leaveTrip")?.addEventListener("click", async () => {
      if (!confirm("לצאת מהטיול? הוא יוסר מהרשימה שלך.")) return;
      state.trips = state.trips.filter((x) => x.id !== t.id);
      localSave();
      try {
        await api("/trip_doc_members?trip_id=eq." + encodeURIComponent(t.id) + "&user_id=eq." + uid, {
          method: "DELETE",
        });
      } catch {}
      delete known[t.id];
      saveKnown();
      renderTrips();
      showView("homeView");
      toast("יצאת מהטיול");
    });
  }
  $$('.quick[data-panel="membersPanel"]').forEach((b) => b.addEventListener("click", () => void renderMembers()));
  window.addEventListener("triply:cloud-ok", () => {
    const note = $(".auth-note");
    if (note) note.textContent = "הטיולים נשמרים בחשבון שלך ומסונכרנים בין המכשירים.";
  });
  window.TriplyCloud = {
    sync,
    mergeTrip,
    renderMembers,
    get available() {
      return available;
    },
  };
})();
