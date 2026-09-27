'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let apiPromise = null;
  let librariesPromise = null;
  let mapInstance = null;
  let polylines = [];
  let markers = [];
  let drawing = false;
  let requestedAgain = false;

  function mapsKey() {
    const key = String(window.TRIPLY_MAPS_API_KEY || '').trim();
    if (!key || key === 'PASTE_GOOGLE_MAPS_DEMO_KEY_HERE') {
      throw new Error('מפתח Google Maps Demo עדיין לא הוגדר.');
    }
    return key;
  }

  function loadMapsApi() {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      let settled = false;
      const script = document.createElement('script');
      const params = new URLSearchParams({
        key: mapsKey(),
        v: 'weekly',
        language: 'he',
        region: 'IL',
        loading: 'async',
        callback: 'triplyGoogleMapsReady'
      });
      const finish = error => {
        if (settled) return;
        settled = true;
        if (error) { apiPromise = null; reject(error); }
        else resolve();
      };
      window.triplyGoogleMapsReady = () => finish();
      script.src = 'https://maps.googleapis.com/maps/api/js?' + params.toString();
      script.async = true;
      script.onerror = () => finish(new Error('Google Maps לא נטען. בדוק את המפתח ואת זמינות השירות.'));
      window.gm_authFailure = () => finish(new Error('Google דחה את מפתח המפה. בדוק שהמפתח הוא Demo וששירותי Maps, Places ו-Routes זמינים.'));
      document.head.append(script);
      setTimeout(() => finish(new Error('Google Maps לא הגיב בזמן. נסה שוב בעוד רגע.')), 20000);
    });
    return apiPromise;
  }

  async function getLibraries() {
    await loadMapsApi();
    if (!librariesPromise) {
      librariesPromise = Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('places'),
        google.maps.importLibrary('routes')
      ]).then(([maps, places, routes]) => ({ maps, places, routes })).catch(error => {
        librariesPromise = null;
        throw error;
      });
    }
    return librariesPromise;
  }

  function placeText(place) {
    const label = place?.text?.toString?.() || String(place?.text || '');
    return { label, name: place?.mainText?.toString?.() || label.split(',')[0].trim() };
  }

  window.placeSuggestions = async (query, city, sessionToken) => {
    const { places } = await getLibraries();
    const request = { input: query, language: 'he' };
    // Search globally; the query also includes the active trip's destination.
    if (sessionToken) request.sessionToken = sessionToken;
    const result = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    return (result.suggestions || []).filter(item => item.placePrediction).map(item => {
      const prediction = item.placePrediction;
      const text = placeText(prediction);
      return { name: text.name, label: text.label, prediction };
    });
  };

  function googleAttribution(container) {
    const footer = document.createElement('div');
    footer.className = 'google-place-attribution';
    const logo = document.createElement('img');
    logo.src = 'https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png';
    logo.alt = 'Powered by Google';
    logo.loading = 'lazy';
    footer.append(logo);
    container.append(footer);
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

  function routeUrl(trip, stops, mode) {
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    const originIsHotel = Boolean(trip.hotel);
    const originStop = !originIsHotel && stops.length > 1 ? stops[0] : null;
    const origin = trip.hotel ? `${trip.hotel}, ${trip.city}` : (originStop ? `${originStop.name}, ${trip.city}` : trip.city);
    const destination = stops.length ? `${stops[stops.length - 1].name}, ${trip.city}` : trip.city;
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('travelmode', mode === 'DRIVING' ? 'driving' : 'walking');
    const middle = stops.slice(originIsHotel ? 0 : (originStop ? 1 : 0), -1);
    if (middle.length) url.searchParams.set('waypoints', middle.map(stop => `${stop.name}, ${trip.city}`).join('|'));
    const last = stops.at(-1);
    if (last?.placeId) url.searchParams.set('destination_place_id', last.placeId);
    if (originStop?.placeId) url.searchParams.set('origin_place_id', originStop.placeId);
    return url.toString();
  }

  async function initMap() {
    const { maps } = await getLibraries();
    if (!mapInstance) {
      mapInstance = new maps.Map($('#tripDayMap'), {
        center: { lat: 20, lng: 0 },
        zoom: 2,
        mapId: 'DEMO_MAP_ID',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false
      });
    }
    return mapInstance;
  }

  function clearMapOverlays() {
    polylines.forEach(line => line.setMap(null));
    markers.forEach(marker => { marker.map = null; });
    polylines = [];
    markers = [];
  }

  async function buildRoute(trip, stops, mode) {
    const { maps, places, routes } = await getLibraries();
    const Route = routes.Route;
    const Place = places.Place;
    let startStop = null;
    let remaining = stops;
    let origin;
    if (trip.hotel) origin = `${trip.hotel}, ${trip.city}`;
    else if (stops.length > 1) {
      startStop = stops[0];
      origin = startStop.placeId ? new Place({ id: startStop.placeId }) : `${startStop.name}, ${trip.city}`;
      remaining = stops.slice(1);
    } else origin = trip.city;

    if (!stops.length) throw new Error('עדיין אין תחנות ליום הזה. הוסף מקומות למסלול ואז תוכל לראות אותם כאן.');
    let destination;
    let middleStops;
    if (trip.hotel || startStop) {
      destination = remaining[remaining.length - 1];
      middleStops = remaining.slice(0, -1);
    } else {
      destination = stops[stops.length - 1];
      middleStops = stops.slice(0, -1);
    }
    if (middleStops.length > 25) throw new Error('Google מאפשר עד 25 תחנות ביניים למסלול אחד. חלק את התחנות בין ימים.');
    const asPlace = stop => stop.placeId ? new Place({ id: stop.placeId }) : `${stop.name}, ${trip.city}`;
    if (stops.length === 1 && !trip.hotel) {
      origin = trip.city;
      destination = stops[0];
      middleStops = [];
    }
    const request = {
      origin,
      destination: asPlace(destination),
      intermediates: middleStops.map(stop => ({ location: asPlace(stop) })),
      travelMode: mode,
      language: 'he',
      fields: ['path', 'legs', 'viewport', 'durationMillis', 'distanceMeters']
    };
    const result = await Route.computeRoutes(request);
    if (!result.routes?.length) throw new Error('לא נמצא מסלול בין התחנות האלה. בדוק את שמות המקומות או שנה את אמצעי ההגעה.');
    const route = result.routes[0];
    const map = await initMap();
    clearMapOverlays();
    polylines = route.createPolylines();
    polylines.forEach(line => line.setMap(map));
    try {
      markers = await route.createWaypointAdvancedMarkers();
      markers.forEach(marker => { marker.map = map; });
    } catch { /* The route line and ordered stop list remain usable without waypoint markers. */ }
    if (route.viewport) map.fitBounds(route.viewport);
    else if (route.path?.length) {
      const bounds = new maps.LatLngBounds();
      route.path.forEach(point => bounds.extend(point));
      map.fitBounds(bounds);
    }
    return route;
  }

  async function showDayMap() {
    showMapPanel();
    if (drawing) { requestedAgain = true; return; }
    drawing = true;
    const status = $('#mapStatus');
    const trip = typeof currentTrip === 'function' ? currentTrip() : null;
    if (!trip) { status.textContent = 'פתח טיול כדי לראות את המסלול על המפה.'; drawing = false; return; }
    const stops = trip.stops.filter(stop => stop.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
    const mode = $('#mapTravelMode')?.value || 'WALKING';
    $('#dayMapSubtitle').textContent = `${typeof dateLabel === 'function' ? dateLabel(selectedDate) : selectedDate} · ${trip.city}`;
    $('#mapStopList').innerHTML = stops.map((stop, i) => `<li><span>${i + 1}</span><div><b>${escapeHTML(stop.name)}</b><small>${escapeHTML(stop.time)} · ${Number(stop.duration) || 60} דקות</small></div></li>`).join('');
    const external = $('#externalDayRoute');
    external.href = routeUrl(trip, stops, mode);
    external.hidden = !stops.length;
    status.textContent = 'טוען מפה ומחשב מסלול…';
    try {
      await initMap();
      if (!stops.length) {
        clearMapOverlays();
        status.textContent = 'עדיין אין תחנות ביום הזה. הוסף מקום במסלול כדי להציג מסלול על המפה.';
        drawing = false;
        return;
      }
      const route = await buildRoute(trip, stops, mode);
      const distance = Number(route.distanceMeters || 0);
      const durationMillis = Number(route.durationMillis || 0);
      const metrics = [distance ? `${(distance / 1000).toFixed(1)} ק״מ` : '', durationMillis ? `כ-${Math.round(durationMillis / 60000)} דקות בדרך` : ''].filter(Boolean).join(' · ');
      status.textContent = `המסלול היומי מוצג על המפה${metrics ? ` · ${metrics}` : ''}. השעות ברשימה הן זמני הביקור שתכננת.`;
    } catch (error) {
      status.textContent = error.message || 'לא ניתן לחשב את המסלול כרגע.';
      if (String(error.message).includes('מפתח Google Maps Demo עדיין')) {
        status.textContent = 'מפתח Google Maps Demo עדיין לא הוגדר. חיפוש המפה יופעל אחרי השלמת החיבור לחשבון Google Cloud.';
      }
    } finally {
      drawing = false;
      if (requestedAgain) { requestedAgain = false; void showDayMap(); }
    }
  }

  function editStop(id) {
    const trip = currentTrip();
    if (!trip) return;
    const old = trip.stops.find(stop => stop.id === id);
    let chosenPlaceId = old?.placeId || '';
    let selectedValue = old?.name || '';
    let sessionToken = null;
    let timer = null;
    let requestId = 0;
    openModal(`<h2>${old ? 'עריכת מקום' : 'הוספת מקום'}</h2><form id="stopForm"><div class="field"><label for="stopName">חיפוש מקום ב-Google Maps</label><input id="stopName" required maxlength="200" value="${escapeHTML(old?.name || '')}" autocomplete="off" placeholder="התחל לכתוב שם של מקום"><div id="placeSuggestions" class="place-suggestions" role="listbox" aria-label="הצעות למקומות"></div><small>בחר מקום מההצעות כדי לשמור את מזהה המקום של Google.</small></div><div class="field-grid"><div class="field"><label for="stopDate">יום</label><input id="stopDate" type="date" min="${trip.start}" max="${trip.end}" value="${old?.date || selectedDate}" required></div><div class="field"><label for="stopTime">שעה</label><input id="stopTime" type="time" required value="${old?.time || '09:00'}"></div></div><div class="field"><label for="duration">משך ביקור בדקות</label><input id="duration" type="number" min="5" max="1440" required value="${old?.duration || 60}"></div><div class="field"><label for="stopNotes">הערות</label><textarea id="stopNotes">${escapeHTML(old?.notes || '')}</textarea></div><button type="button" class="secondary-btn" id="searchMaps">פתיחת החיפוש ב-Google Maps ↗</button><p id="stopError" role="alert"></p><button class="primary-btn">שמירה</button>${old ? '<button type="button" class="secondary-btn" id="removeStop">מחיקת התחנה</button>' : ''}</form>`);
    const input = $('#stopName');
    const results = $('#placeSuggestions');
    input.oninput = () => {
      if (input.value.trim() !== selectedValue) chosenPlaceId = '';
      clearTimeout(timer);
      const query = input.value.trim();
      const token = ++requestId;
      if (query.length < 2) { results.replaceChildren(); return; }
      timer = setTimeout(async () => {
        try {
          const { places } = await getLibraries();
          if (!sessionToken) sessionToken = new places.AutocompleteSessionToken();
          const matches = await window.placeSuggestions(`${query} ${trip.city}`, trip.city, sessionToken);
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
            button.onclick = async () => {
              button.disabled = true;
              try {
                const place = match.prediction.toPlace();
                await place.fetchFields({ fields: ['id'] });
                // Keep only the traveler's own typed text and the place ID. Google
                // place descriptions are shown transiently, not persisted in storage.
                input.value = query;
                selectedValue = input.value;
                chosenPlaceId = place.id || match.prediction.placeId || '';
                results.replaceChildren();
                sessionToken = null;
                input.focus();
              } catch {
                $('#stopError').textContent = 'לא ניתן לקבל את פרטי המקום. נסה לבחור שוב או להקליד את שמו.';
              } finally { button.disabled = false; }
            };
            results.append(button);
          }
          if (matches.length) googleAttribution(results);
          else results.innerHTML = '<p>לא נמצאו הצעות. אפשר לנסות שם באנגלית.</p>';
        } catch (error) {
          if (token !== requestId) return;
          results.innerHTML = `<p>${escapeHTML(error.message || 'חיפוש Google Maps לא זמין כרגע.')}</p>`;
        }
      }, 300);
    };
    $('#searchMaps').onclick = () => {
      const query = input.value.trim();
      if (query) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query + ' ' + trip.city) + (chosenPlaceId ? '&query_place_id=' + encodeURIComponent(chosenPlaceId) : ''), '_blank', 'noopener');
    };
    $('#stopForm').onsubmit = event => {
      event.preventDefault();
      const next = { id: old?.id || crypto.randomUUID(), name: input.value.trim(), placeId: chosenPlaceId || undefined, date: $('#stopDate').value, time: $('#stopTime').value, duration: +$('#duration').value, notes: $('#stopNotes').value };
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
