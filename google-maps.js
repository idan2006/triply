'use strict';
/* Day map without any API key: Leaflet + OpenStreetMap tiles, place search via Photon (OSM).
 * Travel times are estimates from the itinerary engine; each leg opens real directions in Google Maps. */
(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let leafletPromise = null;
  let map = null;
  let layer = null;
  let drawing = false;
  let requestedAgain = false;
  const geoCache = new Map();

  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.append(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => (window.L ? resolve(window.L) : reject(new Error('המפה לא נטענה.')));
      script.onerror = () => { leafletPromise = null; reject(new Error('המפה לא נטענה. בדוק את החיבור לאינטרנט ונסה שוב.')); };
      document.head.append(script);
    });
    return leafletPromise;
  }

  const valid = p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
  const km = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const up5 = v => Math.ceil(v / 5) * 5;

  /* Estimated minutes for one leg in the chosen mode. */
  function legEstimate(a, b, mode) {
    const street = km(a, b) * 1.3;
    if (street < 0.1) return { min: 0, how: 'walk', street };
    if (mode === 'WALKING' && street <= 3.5) return { min: Math.max(3, Math.round((street / 4.5) * 60)), how: 'walk', street };
    if (mode === 'WALKING') return { min: Math.min(120, up5(12 + (street / 17) * 60)), how: 'transit', street, far: true };
    if (mode === 'DRIVING') return { min: Math.max(5, up5(6 + (street / 22) * 60)), how: 'car', street };
    // Public transport: short hops are still on foot.
    if (street <= 1.6) return { min: Math.max(3, Math.round((street / 4.5) * 60)), how: 'walk', street };
    return { min: Math.min(120, up5(12 + (street / 17) * 60)), how: 'transit', street };
  }
  const HOW = { walk: ['🚶', 'הליכה'], transit: ['🚇', 'תחבורה ציבורית'], car: ['🚗', 'נסיעה'] };
  const GMODE = { WALKING: 'walking', TRANSIT: 'transit', DRIVING: 'driving' };

  async function cityCenter(trip) {
    if (valid(trip.travelDetails?.cityPoint)) return trip.travelDetails.cityPoint;
    return geocode(trip.city, null);
  }

  async function geocode(query, near) {
    const key = query + '|' + (near ? near.lat.toFixed(2) + ',' + near.lng.toFixed(2) : '');
    if (geoCache.has(key)) return geoCache.get(key);
    let out = null;
    try {
      const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
      const res = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}${bias}`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      const c = data?.features?.[0]?.geometry?.coordinates;
      if (c) out = { lat: c[1], lng: c[0] };
    } catch { /* estimated positions are optional */ }
    geoCache.set(key, out);
    return out;
  }

  async function pointOf(stop, trip, center) {
    if (valid(stop)) return { lat: Number(stop.lat), lng: Number(stop.lng) };
    const p = await geocode(`${stop.name} ${trip.city}`, center);
    if (p && center && km(p, center) > 60) return null; // wrong city match
    return p;
  }

  function showMapPanel() {
    const tab = $('.quick[data-panel="mapPanel"]');
    if (!tab) return;
    $$('.quick').forEach(button => {
      const active = button === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('.panel').forEach(panel => panel.classList.toggle('active-panel', panel.id === 'mapPanel'));
  }

  const placeQuery = (p, trip) => (valid(p.pt) ? `${p.pt.lat},${p.pt.lng}` : `${p.name}, ${trip.city}`);
  function directionsUrl(trip, from, to, mode) {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', placeQuery(from, trip));
    url.searchParams.set('destination', placeQuery(to, trip));
    url.searchParams.set('travelmode', GMODE[mode] || 'walking');
    return url.toString();
  }
  function dayRouteUrl(trip, points, mode) {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', placeQuery(points[0], trip));
    url.searchParams.set('destination', placeQuery(points.at(-1), trip));
    url.searchParams.set('travelmode', GMODE[mode] || 'walking');
    const middle = points.slice(1, -1);
    if (middle.length) url.searchParams.set('waypoints', middle.map(p => placeQuery(p, trip)).join('|'));
    return url.toString();
  }

  async function ensureMap(L) {
    if (!map) {
      map = L.map('tripDayMap', { zoomControl: true, attributionControl: true }).setView([30, 10], 3);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 50);
    return map;
  }

  function pin(L, label, home) {
    return L.divIcon({
      className: 'tm-pin-wrap',
      html: `<span class="tm-pin${home ? ' tm-home' : ''}">${label}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  async function showDayMap() {
    showMapPanel();
    if (drawing) { requestedAgain = true; return; }
    drawing = true;
    const status = $('#mapStatus');
    const list = $('#mapStopList');
    const external = $('#externalDayRoute');
    try {
      const trip = typeof currentTrip === 'function' ? currentTrip() : null;
      if (!trip) { status.textContent = 'פתח טיול כדי לראות את המסלול על המפה.'; return; }
      const stops = trip.stops.filter(stop => stop.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
      const mode = $('#mapTravelMode')?.value || 'WALKING';
      $('#dayMapSubtitle').textContent = `${typeof dateLabel === 'function' ? dateLabel(selectedDate) : selectedDate} · ${trip.city}`;
      status.textContent = 'טוען מפה…';
      const L = await loadLeaflet();
      const m = await ensureMap(L);
      const center = await cityCenter(trip);
      if (!stops.length) {
        list.replaceChildren();
        external.hidden = true;
        if (center) m.setView([center.lat, center.lng], 12);
        status.textContent = 'עדיין אין תחנות ביום הזה. הוסף מקום במסלול כדי לראות אותו על המפה.';
        return;
      }
      status.textContent = 'מאתר את המקומות…';
      const lodging = trip.travelDetails?.lodgingPoint;
      const home = valid(lodging) ? { name: trip.hotel || 'המלון', pt: { lat: Number(lodging.lat), lng: Number(lodging.lng) }, home: true }
        : trip.hotel ? { name: trip.hotel, pt: await geocode(`${trip.hotel} ${trip.city}`, center), home: true } : null;
      const points = [];
      for (const stop of stops) points.push({ name: stop.name, stop, pt: await pointOf(stop, trip, center) });
      const route = [...(home ? [home] : []), ...points, ...(home ? [{ ...home }] : [])];

      // Markers and legs
      const bounds = [];
      if (valid(home?.pt)) {
        L.marker([home.pt.lat, home.pt.lng], { icon: pin(L, '🏨', true), title: home.name }).addTo(layer).bindPopup(escapeHTML(home.name));
        bounds.push([home.pt.lat, home.pt.lng]);
      }
      points.forEach((p, i) => {
        if (!valid(p.pt)) return;
        L.marker([p.pt.lat, p.pt.lng], { icon: pin(L, String(i + 1)), title: p.name }).addTo(layer)
          .bindPopup(`<b>${escapeHTML(p.name)}</b><br>${escapeHTML(p.stop.time)} · ${Number(p.stop.duration) || 60} דק'`);
        bounds.push([p.pt.lat, p.pt.lng]);
      });
      const legs = [];
      let totalMin = 0, totalKm = 0;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        if (!valid(a.pt) || !valid(b.pt)) { legs.push(null); continue; }
        const est = legEstimate(a.pt, b.pt, mode);
        legs.push({ ...est, from: a, to: b });
        totalMin += est.min; totalKm += est.street;
        if (est.min) {
          L.polyline([[a.pt.lat, a.pt.lng], [b.pt.lat, b.pt.lng]], {
            color: est.how === 'walk' ? '#CC2B66' : est.how === 'transit' ? '#3A0F24' : '#7A4A63',
            weight: 4, opacity: 0.85, dashArray: est.how === 'walk' ? '2 8' : null, lineCap: 'round',
          }).addTo(layer);
        }
      }
      if (bounds.length > 1) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      else if (bounds.length === 1) m.setView(bounds[0], 15);
      else if (center) m.setView([center.lat, center.lng], 12);

      // List: stops with the leg before each one
      const legRow = leg => {
        if (!leg || !leg.min) return '';
        const [icon, word] = HOW[leg.how];
        return `<li class="map-leg"><span aria-hidden="true">${icon}</span><div><small>${leg.far ? 'רחוק להליכה — ' : ''}${word} · כ-${leg.min} דק' · ${leg.street.toFixed(1)} ק״מ</small><a href="${directionsUrl(trip, leg.from, leg.to, leg.how === 'transit' ? 'TRANSIT' : mode)}" target="_blank" rel="noopener">הוראות ב-Google Maps ↗</a></div></li>`;
      };
      let html = '';
      const offset = home ? 1 : 0;
      if (home) html += `<li class="map-home"><span aria-hidden="true">🏨</span><div><b>${escapeHTML(home.name)}</b><small>יציאה מהמלון</small></div></li>`;
      points.forEach((p, i) => {
        html += legRow(legs[i + offset - 1]);
        html += `<li><span>${i + 1}</span><div><b>${escapeHTML(p.name)}</b><small>${escapeHTML(p.stop.time)} · ${Number(p.stop.duration) || 60} דקות${valid(p.pt) ? '' : ' · לא נמצא על המפה'}</small></div></li>`;
      });
      if (home) html += legRow(legs.at(-1)) + `<li class="map-home"><span aria-hidden="true">🏨</span><div><b>חזרה ל${escapeHTML(home.name)}</b></div></li>`;
      list.innerHTML = html;

      const located = route.filter(p => valid(p.pt));
      external.hidden = located.length < 2;
      if (located.length >= 2) {
        external.href = dayRouteUrl(trip, located, mode === 'TRANSIT' ? 'TRANSIT' : mode);
        external.textContent = 'פתיחת כל המסלול ב-Google Maps ↗';
      }
      const missing = points.filter(p => !valid(p.pt)).length;
      status.textContent = `${points.length} תחנות · כ-${totalKm.toFixed(1)} ק״מ · כ-${totalMin} דק' בדרך (הערכה)` + (missing ? ` · ${missing} מקומות לא נמצאו על המפה` : '');
    } catch (error) {
      status.textContent = error.message || 'לא ניתן להציג את המפה כרגע.';
    } finally {
      drawing = false;
      if (requestedAgain) { requestedAgain = false; void showDayMap(); }
    }
  }

  /* Place search (no key): Photon / OpenStreetMap, biased to the trip's city. */
  async function searchPlaces(query, near) {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
    const res = await fetch(`https://photon.komoot.io/api/?limit=6&q=${encodeURIComponent(query)}${bias}`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return (data.features || []).map(f => {
      const p = f.properties || {}, c = f.geometry?.coordinates;
      const name = p.name || p.street || '';
      const label = [p.street && p.name ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '', p.district, p.city || p.county, p.country].filter(Boolean).join(', ');
      return { name, label, lat: c?.[1], lng: c?.[0] };
    }).filter(x => x.name && Number.isFinite(x.lat) && (!near || km(x, near) < 80));
  }
  window.placeSuggestions = async (query, city) => {
    const trip = typeof currentTrip === 'function' ? currentTrip() : null;
    const near = trip ? await cityCenter(trip) : null;
    return searchPlaces(query, near);
  };

  function editStop(id) {
    const trip = currentTrip();
    if (!trip) return;
    const old = trip.stops.find(stop => stop.id === id);
    let chosen = valid(old) ? { lat: Number(old.lat), lng: Number(old.lng), name: old.name } : null;
    let timer = null;
    let requestId = 0;
    openModal(`<h2>${old ? 'עריכת מקום' : 'הוספת מקום'}</h2><form id="stopForm"><div class="field"><label for="stopName">חיפוש מקום</label><input id="stopName" required maxlength="200" value="${escapeHTML(old?.name || '')}" autocomplete="off" placeholder="התחל לכתוב שם של מקום"><div id="placeSuggestions" class="place-suggestions" role="listbox" aria-label="הצעות למקומות"></div><small>בחר מההצעות כדי שהמקום יופיע על המפה, או המשך עם שם משלך.</small></div><div class="field-grid"><div class="field"><label for="stopDate">יום</label><input id="stopDate" type="date" min="${trip.start}" max="${trip.end}" value="${old?.date || selectedDate}" required></div><div class="field"><label for="stopTime">שעה</label><input id="stopTime" type="time" required value="${old?.time || '09:00'}"></div></div><div class="field"><label for="duration">משך ביקור בדקות</label><input id="duration" type="number" min="5" max="1440" required value="${old?.duration || 60}"></div><div class="field"><label for="stopNotes">הערות</label><textarea id="stopNotes">${escapeHTML(old?.notes || '')}</textarea></div><button type="button" class="secondary-btn" id="searchMaps">פתיחת המקום ב-Google Maps ↗</button><p id="stopError" role="alert"></p><button class="primary-btn">שמירה</button>${old ? '<button type="button" class="secondary-btn" id="removeStop">מחיקת התחנה</button>' : ''}</form>`);
    const input = $('#stopName');
    const results = $('#placeSuggestions');
    input.oninput = () => {
      if (chosen && input.value.trim() !== chosen.name) chosen = null;
      clearTimeout(timer);
      const query = input.value.trim();
      const token = ++requestId;
      if (query.length < 2) { results.replaceChildren(); return; }
      timer = setTimeout(async () => {
        try {
          const matches = await window.placeSuggestions(query, trip.city);
          if (token !== requestId || !results.isConnected) return;
          results.replaceChildren();
          for (const match of matches.slice(0, 5)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'place-option';
            button.setAttribute('role', 'option');
            const name = document.createElement('b');
            name.textContent = match.name;
            const label = document.createElement('small');
            label.textContent = match.label;
            button.append(name, label);
            button.onclick = () => {
              input.value = match.name;
              chosen = { lat: match.lat, lng: match.lng, name: match.name };
              results.replaceChildren();
              input.focus();
            };
            results.append(button);
          }
          if (!matches.length) results.innerHTML = '<p>לא נמצאו הצעות. אפשר לנסות שם באנגלית או להמשיך עם השם שכתבת.</p>';
        } catch {
          if (token === requestId) results.innerHTML = '<p>החיפוש לא זמין כרגע. אפשר להמשיך עם השם שכתבת.</p>';
        }
      }, 300);
    };
    $('#searchMaps').onclick = () => {
      const query = input.value.trim();
      if (query) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(chosen ? `${chosen.lat},${chosen.lng}` : query + ' ' + trip.city), '_blank', 'noopener');
    };
    $('#stopForm').onsubmit = event => {
      event.preventDefault();
      const name = input.value.trim();
      const keep = old && old.name === name && valid(old) ? { lat: old.lat, lng: old.lng } : null;
      const coords = chosen && chosen.name === name ? { lat: chosen.lat, lng: chosen.lng } : keep;
      const next = { ...(old || {}), id: old?.id || crypto.randomUUID(), name, date: $('#stopDate').value, time: $('#stopTime').value, duration: +$('#duration').value, notes: $('#stopNotes').value };
      delete next.placeId;
      if (coords) { next.lat = coords.lat; next.lng = coords.lng; } else { delete next.lat; delete next.lng; }
      if (!next.name || next.date < trip.start || next.date > trip.end) { $('#stopError').textContent = 'בדוק את שם המקום ואת התאריך.'; return; }
      const before = trip.stops;
      trip.stops = old ? trip.stops.map(stop => stop.id === old.id ? next : stop) : [...trip.stops, next];
      try {
        save();
        selectedDate = next.date;
        closeModal();
        renderTrip();
        toast('המקום נשמר ביום ' + dateLabel(next.date));
        if ($('.quick[data-panel="mapPanel"]')?.classList.contains('active')) void showDayMap();
      } catch {
        trip.stops = before;
        $('#stopError').textContent = 'השמירה נכשלה.';
      }
    };
    if (old) $('#removeStop').onclick = () => {
      if (!confirm('למחוק את התחנה מהטיול?')) return;
      const before = trip.stops;
      trip.stops = trip.stops.filter(stop => stop.id !== old.id);
      try { save(); closeModal(); renderStops(); }
      catch { trip.stops = before; toast('השמירה נכשלה.'); }
    };
  }

  window.TriplyGoogleMaps = { showDayMap };
  window.TriplyMap = { showDayMap, legEstimate };
  window.editStop = editStop;
  window.openDayMap = showDayMap;
  $$('.quick[data-panel="mapPanel"]').forEach(button => button.addEventListener('click', () => { void showDayMap(); }));
  $('#mapTravelMode')?.addEventListener('change', () => { if ($('.quick[data-panel="mapPanel"]')?.classList.contains('active')) void showDayMap(); });
  document.addEventListener('click', event => {
    if (event.target.closest('.day[data-date]') && $('.quick[data-panel="mapPanel"]')?.classList.contains('active')) {
      setTimeout(() => { void showDayMap(); }, 0);
    }
  });
})();
