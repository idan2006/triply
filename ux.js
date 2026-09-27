(function(){
  'use strict';
  // Trip actions live in one "⋯" menu instead of a row of buttons at the bottom of the page.
  const more=$('.trip-head>.icon-btn');
  if(more){
    more.setAttribute('aria-label','עוד פעולות לטיול');
    more.onclick=()=>{
      const t=currentTrip();if(!t)return;
      openModal(`<h2>${escapeHTML(t.city)}</h2><div class="action-sheet">
        <button type="button" data-act="edit">עריכת פרטי הטיול<small>יעד, תאריכים, נוסעים, מלון ותקציב</small></button>
        <button type="button" data-act="hotels">ערים ומלונות<small>טיול בכמה ערים או כמה מלונות</small></button>
        <button type="button" data-act="export">ייצוא המסלול וההוצאות<small>קובץ לגיבוי או לשיתוף</small></button>
        <button type="button" data-act="archive">${t.archived?'החזרה מהארכיון':'העברה לארכיון'}<small>${t.archived?'הטיול יחזור לרשימה הראשית':'הטיול יוסתר מהרשימה הראשית'}</small></button>
        <button type="button" data-act="delete" class="danger">מחיקת הטיול<small>אי אפשר לשחזר אחרי מחיקה</small></button></div>`);
      const run={edit:()=>{closeModal();tripForm(true);},hotels:()=>{closeModal();window.openHotelsEditor();},export:()=>{closeModal();$('#exportTripBtn')?.click();},archive:()=>{closeModal();$('#archiveTripBtn')?.click();},delete:()=>{closeModal();$('#deleteTripBtn')?.click();}};
      $$('.action-sheet [data-act]').forEach(b=>b.onclick=()=>run[b.dataset.act]());
    };
  }
})();

// ---- "Today on the trip": open on today's day and show what's now / next ----
(function(){
  'use strict';
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const nowMin=()=>{const d=new Date();return d.getHours()*60+d.getMinutes();};
  const toMin=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})/);return m?+m[1]*60+ +m[2]:null;};
  const onTrip=t=>t&&!t.archived&&t.start<=today()&&today()<=t.end;
  const isMove=b=>!b.placeName&&/^הליכה|\(הליכה|תחבורה|נסיעה|מונית/.test(b.activity);
  function nowNext(t){
    const day=t.dailySchedule?.find(d=>d.date===today());
    if(day?.blocks?.length){
      const n=nowMin(),blocks=day.blocks;
      let i=blocks.findIndex(b=>toMin(b.startTime)<=n&&n<toMin(b.endTime));
      const cur=i>=0?blocks[i]:null;
      const next=blocks.slice(i>=0?i+1:0).find(b=>toMin(b.startTime)>=(cur?toMin(cur.startTime):n)&&!isMove(b)&&b!==cur);
      const move=cur&&isMove(cur)?cur:blocks.slice(i+1).find(b=>isMove(b)&&next&&toMin(b.startTime)<toMin(next.startTime));
      return {cur,next,move,done:!cur&&!next};
    }
    const stops=t.stops.filter(s=>s.date===today()).sort((a,b)=>a.time.localeCompare(b.time)),n=nowMin();
    const cur=stops.find(s=>toMin(s.time)<=n&&n<toMin(s.time)+Number(s.duration||60));
    const next=stops.find(s=>toMin(s.time)>n);
    const asBlock=s=>s&&{activity:s.name,placeName:s.name,startTime:s.time,endTime:''};
    return {cur:asBlock(cur),next:asBlock(next),done:!cur&&!next&&stops.length>0};
  }
  const place=b=>b?.placeName||'';
  const label=b=>String(b?.activity||'').replace(/^ביקור:\s*/,'');
  function navUrl(t,b){
    const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');
    u.searchParams.set('destination',`${place(b)||b.activity}, ${t.city}`);
    u.searchParams.set('travelmode','walking');
    return u.toString();
  }
  function card(t){
    const {cur,next,done}=nowNext(t);
    const dayNo=TripModel.dates(t.start,t.end).indexOf(today())+1;
    const nowLine=cur?`<div class="today-now"><span>עכשיו</span><b>${escapeHTML(label(cur))}</b>${cur.endTime?`<small>עד ${escapeHTML(cur.endTime)}</small>`:''}</div>`:'';
    const nextLine=next?`<div class="today-next"><span>הבא</span><b>${escapeHTML(label(next))}</b><small>ב-${escapeHTML(next.startTime)}</small></div>`:'';
    const target=next&&place(next)?next:cur&&place(cur)?cur:null;
    return `<section class="today-card" aria-label="היום בטיול"><div class="today-kicker">היום בטיול · יום ${dayNo}</div>${nowLine}${nextLine}${done?'<p class="today-done">סיימתם את התוכנית של היום. ערב חופשי!</p>':''}${!cur&&!next&&!done?'<p class="today-done">אין עדיין תוכנית להיום. לחץ על "תכנן לי את כל הטיול".</p>':''}${target?`<a class="today-nav" href="${escapeHTML(navUrl(t,target))}" target="_blank" rel="noopener">ניווט אל ${escapeHTML(place(target))}</a>`:''}</section>`;
  }
  const prevSelect=selectTrip;
  selectTrip=function(id){prevSelect(id);const t=currentTrip();if(onTrip(t)&&selectedDate!==today()){selectedDate=today();renderTrip();}};
  const prevStops=renderStops;
  renderStops=()=>{prevStops();const t=currentTrip();if(!onTrip(t)||selectedDate!==today())return;const list=$('#itineraryList');list?.insertAdjacentHTML('afterbegin',card(t));};
  const prevTrips=renderTrips;
  renderTrips=()=>{prevTrips();const t=state.trips.find(onTrip);const hero=$('.hero-card');if(!hero)return;hero.classList.toggle('is-today',Boolean(t));if(!t)return;
    const {cur,next}=nowNext(t);hero.hidden=false;
    $('.hero-kicker').textContent='היום בטיול';$('.hero-card h2').textContent=t.city;
    $('.hero-card p').textContent=cur?`עכשיו: ${label(cur)}${next?` · הבא: ${label(next)} ב-${next.startTime}`:''}`:next?`הבא: ${label(next)} ב-${next.startTime}`:'אין עוד תוכנית להיום';
    $('.hero-card button').textContent='לתוכנית של היום ←';$('.hero-card button').onclick=()=>selectTrip(t.id);};
  renderTrips();
  setInterval(()=>{if(!document.hidden&&$('#homeView.active'))renderTrips();},60000);
})();

// ---- Weather per day (Open-Meteo, free, no key). Forecast exists ~16 days ahead. ----
(function(){
  'use strict';
  const mem=new Map();
  const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const store={get(k){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v&&v.exp>Date.now()?v.data:null;}catch{return null;}},set(k,data,ms){try{localStorage.setItem(k,JSON.stringify({exp:Date.now()+ms,data}));}catch{}}};
  async function coords(city){
    const key='triply:geo:'+city.trim().toLowerCase();const hit=store.get(key);if(hit)return hit;
    let p=null;
    try{const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=he&name='+encodeURIComponent(city));const j=await r.json();const g=j?.results?.[0];if(g)p={lat:g.latitude,lng:g.longitude};}catch{}
    if(!p){try{const r=await fetch('https://photon.komoot.io/api/?limit=1&q='+encodeURIComponent(city));const j=await r.json();const c=j?.features?.[0]?.geometry?.coordinates;if(c)p={lat:c[1],lng:c[0]};}catch{}}
    if(p)store.set(key,p,30*86400000);
    return p;
  }
  async function forecast(t){
    const today=ymd(new Date()),last=ymd(new Date(Date.now()+15*86400000));
    if(t.end<today)return {past:true};
    if(t.start>last)return {tooFar:true};
    const from=t.start>today?t.start:today,to=t.end<last?t.end:last,key=`triply:wx:${t.city}:${from}:${to}`;
    if(mem.has(key))return mem.get(key);
    const cached=store.get(key);if(cached){mem.set(key,cached);return cached;}
    const p=await coords(t.city);if(!p)return null;
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${from}&end_date=${to}`;
    const r=await fetch(url);if(!r.ok)return null;const j=await r.json();const d=j.daily||{},days={};
    (d.time||[]).forEach((date,i)=>days[date]={code:d.weather_code[i],max:Math.round(d.temperature_2m_max[i]),min:Math.round(d.temperature_2m_min[i]),rain:d.precipitation_probability_max?.[i]??null});
    const out={days};mem.set(key,out);store.set(key,out,3*3600000);return out;
  }
  const kind=c=>c<=1?'sun':c<=3?'cloud':c<=48?'fog':c<=67||(c>=80&&c<=82)?'rain':c<=77||c===85||c===86?'snow':'storm';
  const names={sun:'בהיר',cloud:'מעונן חלקית',fog:'ערפל',rain:'גשם',snow:'שלג',storm:'סופת רעמים'};
  const paths={sun:'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',cloud:'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',fog:'M4 10h16M4 14h16M6 18h12M8 6h8',rain:'M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2',snow:'M20 17.6A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16.3M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01',storm:'M19 16.9A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M13 11l-4 6h6l-4 6'};
  const icon=k=>`<svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k]}"/></svg>`;
  let token=0;
  async function paint(){
    const t=currentTrip();if(!t)return;const my=++token;
    let wx=null;try{wx=await forecast(t);}catch{}
    if(my!==token||currentTrip()?.id!==t.id)return;
    $$('.day[data-date]').forEach(b=>{b.querySelector('.wx')?.remove();const w=wx?.days?.[b.dataset.date];if(w)b.insertAdjacentHTML('beforeend',`<span class="wx">${icon(kind(w.code))}${w.max}°</span>`);});
    $('.wx-line')?.remove();
    const title=$('.day-title>div');if(!title)return;
    const w=wx?.days?.[selectedDate];
    if(w){const k=kind(w.code),wet=(w.rain??0)>=60||k==='rain'||k==='storm'||k==='snow';title.insertAdjacentHTML('beforeend',`<p class="wx-line ${wet?'wet':''}">${icon(k)}<span>${names[k]} · ${w.max}°/${w.min}°${w.rain!=null?` · ${w.rain}% גשם`:''}</span></p>${wet?'<p class="wx-line wx-tip wet">צפוי גשם — כדאי לבקש מהצ׳אט להעביר ליום הזה מוזיאונים ומקומות מקורים.</p>':''}`);}
    else if(wx?.tooFar)title.insertAdjacentHTML('beforeend','<p class="wx-line">תחזית מזג האוויר תופיע כשבועיים לפני הטיול.</p>');
  }
  const prevTrip=renderTrip;
  renderTrip=function(){prevTrip.apply(this,arguments);void paint();};
})();

// ---- Cities & hotels editor (trips with several hotels / cities) ----
(function(){
  'use strict';
  const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
  window.openHotelsEditor=function(){
    const t=currentTrip();if(!t)return;
    let rows=(t.travelDetails?.hotels||[]).map(h=>({name:h.name||'',city:h.city||'',checkIn:h.checkIn||'',checkOut:h.checkOut||''}));
    if(!rows.length)rows=[{name:t.hotel||'',city:t.city,checkIn:t.start,checkOut:t.end}];
    const draw=()=>{
      openModal(`<h2>ערים ומלונות</h2><p>טיול בכמה ערים או כמה מלונות? הוסף כל מלון עם התאריכים שלו, והתכנון יבנה כל יום מהמלון של אותו לילה.</p><form id="hotelsForm">${rows.map((r,i)=>`<fieldset class="hotel-row"><legend>מלון ${i+1}</legend><div class="field-grid"><div class="field"><label for="hc${i}">עיר</label><input id="hc${i}" value="${escapeHTML(r.city)}" maxlength="120" required></div><div class="field"><label for="hn${i}">שם המלון</label><input id="hn${i}" value="${escapeHTML(r.name)}" maxlength="160"></div></div><div class="field-grid"><div class="field"><label for="hi${i}">צ'ק-אין</label><input id="hi${i}" type="date" min="${t.start}" max="${t.end}" value="${escapeHTML(r.checkIn)}" required></div><div class="field"><label for="ho${i}">צ'ק-אאוט</label><input id="ho${i}" type="date" min="${t.start}" max="${t.end}" value="${escapeHTML(r.checkOut)}" required></div></div>${rows.length>1?`<button type="button" class="text-btn" data-del-hotel="${i}">הסרת המלון</button>`:''}</fieldset>`).join('')}<button type="button" class="secondary-btn" id="addHotelRow">＋ עוד עיר או מלון</button><p id="hotelsError" role="alert"></p><button class="primary-btn">שמירה</button></form>`);
      const read=()=>rows=rows.map((_,i)=>({city:$('#hc'+i).value.trim(),name:$('#hn'+i).value.trim(),checkIn:$('#hi'+i).value,checkOut:$('#ho'+i).value}));
      $('#addHotelRow').onclick=()=>{read();const last=rows.at(-1);rows.push({city:'',name:'',checkIn:last?.checkOut||t.start,checkOut:t.end});draw();};
      $$('[data-del-hotel]').forEach(b=>b.onclick=()=>{read();rows.splice(+b.dataset.delHotel,1);draw();});
      $('#hotelsForm').onsubmit=e=>{e.preventDefault();read();
        const bad=rows.find(r=>!r.city||!iso(r.checkIn)||!iso(r.checkOut)||r.checkOut<=r.checkIn);
        if(bad){$('#hotelsError').textContent='לכל מלון צריך עיר, וצ\'ק-אאוט אחרי הצ\'ק-אין.';return;}
        rows.sort((a,b)=>a.checkIn.localeCompare(b.checkIn));
        for(let i=1;i<rows.length;i++)if(rows[i].checkIn<rows[i-1].checkOut){$('#hotelsError').textContent='התאריכים של שני מלונות חופפים. בדוק את הצ\'ק-אין והצ\'ק-אאוט.';return;}
        const before=structuredClone(t.travelDetails||{}),beforeHotel=t.hotel;
        t.travelDetails={...(t.travelDetails||{}),hotels:rows,hotelCheckIn:rows[0].checkIn,hotelCheckOut:rows.at(-1).checkOut};
        if(rows[0].name)t.hotel=rows[0].name;
        try{save();closeModal();renderTrip();toast(rows.length>1?`נשמרו ${rows.length} מלונות. לחץ "תכנן לי את כל הטיול" כדי לבנות מחדש.`:'המלון נשמר');}
        catch{t.travelDetails=before;t.hotel=beforeHotel;$('#hotelsError').textContent='השמירה נכשלה';}
      };
    };
    draw();
  };
})();

// ---- Import trips from a backup file (e.g. the old chatgpt.site version: Settings → "הורדת גיבוי טיולים") ----
(function(){
  'use strict';
  function pickFile(){return new Promise(res=>{const i=document.createElement('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>res(i.files[0]||null);i.click();});}
  window.importTripsFromFile=async function(){
    const file=await pickFile();if(!file)return;
    if(file.size>20*1024*1024){toast('הקובץ גדול מדי');return;}
    let data;try{data=JSON.parse(await file.text());}catch{toast('זה לא קובץ גיבוי של Triply (JSON לא תקין)');return;}
    const list=Array.isArray(data)?data:Array.isArray(data?.trips)?data.trips:null;
    if(!list){toast('לא מצאתי טיולים בקובץ הזה');return;}
    const ok=[];let bad=0;
    for(const raw of list){try{const t=TripModel.trip(raw);if(t.id&&t.city)ok.push(t);else bad++;}catch{bad++;}}
    if(!ok.length){toast('לא הצלחתי לקרוא אף טיול מהקובץ');return;}
    const have=new Map(state.trips.map(t=>[t.id,t]));
    const fresh=ok.filter(t=>!have.has(t.id)),same=ok.filter(t=>have.has(t.id));
    let replace=false;
    if(same.length)replace=confirm(`${same.length} מהטיולים בקובץ כבר קיימים כאן. להחליף אותם בגרסה מהקובץ? (ביטול = להשאיר את מה שיש)`);
    const before=state.trips;
    state.trips=[...fresh,...state.trips.map(t=>replace&&same.find(x=>x.id===t.id)||t)];
    try{save();}catch{state.trips=before;toast('השמירה נכשלה — ייתכן שאין מקום בדפדפן');return;}
    try{if(data?.preferences&&typeof preferences==='object'&&!Object.keys(preferences).some(k=>preferences[k]))Object.assign(preferences,data.preferences);}catch{}
    closeModal();renderTrips();showView('homeView');
    toast(`יובאו ${fresh.length} טיולים${replace&&same.length?` ועודכנו ${same.length}`:''}${bad?` (${bad} לא נקראו)`:''}`);
    window.dispatchEvent(new CustomEvent('triply:trips-changed'));
  };
  const btn=$('#settingsBtn');
  if(btn&&typeof openSettings==='function'){
    btn.onclick=()=>{openSettings();const anchor=$('#backupData');if(anchor&&!$('#importBackup')){anchor.insertAdjacentHTML('afterend','<button class="secondary-btn" id="importBackup">ייבוא טיולים מקובץ גיבוי</button><p class="muted import-note">טיולים מהאתר הקודם: שם, בהגדרות, לחץ "הורדת גיבוי טיולים", ואז כאן בחר את הקובץ שירד.</p>');$('#importBackup').onclick=window.importTripsFromFile;}};
  }
  // Empty home: offer import next to "new trip".
  const prev=renderTrips;
  renderTrips=()=>{prev();if(!state.trips.length){const g=$('#tripGrid');if(g&&!g.querySelector('#emptyImport'))g.insertAdjacentHTML('beforeend','<button type="button" class="text-btn" id="emptyImport">יש לך טיולים מהאתר הקודם? ייבוא מקובץ גיבוי</button>');const b=$('#emptyImport');if(b)b.onclick=window.importTripsFromFile;}};
  renderTrips();
})();
