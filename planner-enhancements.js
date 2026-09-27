/* Triply MVP follow-up: per-traveler budgets, document prepayments and truthful AI proposals. */
(function(){
  'use strict';
  const currencies=['ILS','GBP','USD','EUR'];
  const money=value=>Number(value||0).toFixed(2);
  const makeEqualSplits=(amount,people)=>{
    const cents=Math.round(amount*100),base=Math.floor(cents/people.length),extra=cents%people.length,out={};
    people.forEach((p,i)=>out[p.id]=(base+(i<extra?1:0))/100);
    return out;
  };
  const validISO=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&Number.isFinite(Date.parse(value+'T00:00:00Z'));

  function enhancedTripForm(edit=false){
    const t=edit?currentTrip():null;
    let scannedDetails={...(t?.travelDetails||{})};
    let prepaidRows=[];
    let peopleDraft=t?t.participants.map(p=>({id:p.id,name:p.name,budget:String(p.budget??t.budgetPerPerson??'')})):[{name:'משתתף 1',budget:''}];
    const existingCountLocked=Boolean(t?.expenses.length);
    const initialCurrency=t?.currency||'ILS';
    const participantHTML=()=>peopleDraft.map((p,i)=>`<div class="traveler-budget-row"><label><span>שם משתתף ${i+1}</span><input data-person-name="${i}" maxlength="80" value="${escapeHTML(p.name)}" placeholder="למשל: עידן" required></label><label><span>תקציב אישי (${escapeHTML($('#tripCurrency')?.value||initialCurrency)})</span><input data-person-budget="${i}" type="number" inputmode="decimal" min="${t?'0':'0.01'}" max="100000000" step="0.01" value="${escapeHTML(p.budget)}" placeholder="למשל 5000" ${t?'':'required'}></label></div>`).join('');
    const readPeople=()=>peopleDraft=peopleDraft.map((p,i)=>({ ...p,name:$(`[data-person-name="${i}"]`)?.value??p.name,budget:$(`[data-person-budget="${i}"]`)?.value??p.budget }));
    const renderPeople=()=>{const host=$('#travelerBudgetFields');if(host)host.innerHTML=participantHTML();};
    const showPrepaid=()=>{
      const host=$('#prepaidRows');if(!host)return;
      host.innerHTML=prepaidRows.length?prepaidRows.map((r,i)=>`<div class="prepaid-row"><label><span>הוצאה שחולצה</span><input data-prepaid-name="${i}" maxlength="120" value="${escapeHTML(r.name)}" placeholder="כרטיס טיסה / מלון" required></label><label><span>סכום</span><input data-prepaid-amount="${i}" type="number" min="0.01" max="100000000" step="0.01" value="${escapeHTML(r.amount)}" required></label><label><span>מטבע</span><select data-prepaid-currency="${i}" required><option value="">בחירת מטבע</option>${currencies.map(c=>`<option value="${c}" ${r.currency===c?'selected':''}>${c}</option>`).join('')}</select></label><button type="button" class="small-btn" data-prepaid-remove="${i}" aria-label="הסרת הוצאה">×</button></div>`).join(''):'<p class="muted">לא זוהו הוצאות ששולמו מראש. אפשר להוסיף ידנית.</p>';
      prepaidRows.forEach((r,i)=>{
        $(`[data-prepaid-name="${i}"]`).oninput=e=>r.name=e.target.value;
        $(`[data-prepaid-amount="${i}"]`).oninput=e=>r.amount=e.target.value;
        $(`[data-prepaid-currency="${i}"]`).onchange=e=>r.currency=e.target.value;
      });
      $$('[data-prepaid-remove]').forEach(b=>b.onclick=()=>{prepaidRows.splice(Number(b.dataset.prepaidRemove),1);showPrepaid();});
    };

    openModal(`<h2>${t?'עריכת טיול':'טיול חדש'}</h2><form id="tripForm"><div class="field"><label for="newCity">יעד</label><input id="newCity" required maxlength="150" value="${escapeHTML(t?.city||'')}" autocomplete="off" placeholder="למשל: לונדון"></div><div class="field-grid"><div class="field"><label for="newStart">מתאריך</label><input id="newStart" type="date" required value="${t?.start||''}"></div><div class="field"><label for="newEnd">עד תאריך</label><input id="newEnd" type="date" required value="${t?.end||''}"></div></div><div class="field"><label for="newPeople">מספר נוסעים</label><input id="newPeople" type="number" inputmode="numeric" min="1" max="1000" step="1" required value="${t?.people||1}" ${existingCountLocked?'disabled':''}></div>${existingCountLocked?'<small>מספר המשתתפים נעול לאחר רישום הוצאות כדי לשמור על החלוקה שלהן.</small>':''}<div class="field"><label for="tripCurrency">מטבע התקציב</label><select id="tripCurrency" ${t?.expenses.length?'disabled':''}>${currencies.map(c=>`<option value="${c}" ${c===initialCurrency?'selected':''}>${c}</option>`).join('')}</select>${t?.expenses.length?'<small>לא ניתן לשנות מטבע לאחר רישום הוצאות.</small>':''}</div><section class="traveler-budgets"><h3>תקציב אישי לכל משתתף</h3><p>היתרה תחושב בנפרד לכל אחד. אפשר להגדיר סכומים שונים.</p><div id="travelerBudgetFields"></div></section><div class="field"><label for="tripHotel">מלון או נקודת יציאה</label><input id="tripHotel" value="${escapeHTML(t?.hotel||'')}" maxlength="250" placeholder="שם המלון או כתובת"></div><details class="document-scan"><summary>העלאת כרטיס טיסה או אישור מלון — מילוי אוטומטי</summary><p>המסמך נשלח ל-AI רק לצורך חילוץ פרטים ואינו נשמר באפליקציה. בדוק את התאריכים, הנוסעים והמחירים לפני השמירה. תקציב אישי נדרש תמיד.</p><div class="field"><label for="tripDocuments">בחירת PDF או תמונה (עד שני קבצים, 4MB לכל קובץ)</label><input id="tripDocuments" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></div><button type="button" class="secondary-btn" id="scanTripDocs">סריקת המסמכים</button><p id="documentStatus" role="status"></p><div id="documentResults"></div><div class="prepaid-editor"><h4>טיסה ומלון ששולמו מראש</h4><p>הסכומים יתווספו להוצאות המשותפות ויתחלקו שווה בשווה. בדוק את המטבע והסכום שחולצו.</p><div id="prepaidRows"></div><button type="button" class="small-btn" id="addPrepaid">＋ הוספת עלות ששולמה מראש</button></div></details><p id="formError" role="alert"></p><button class="primary-btn" type="submit">${t?'שמירת השינויים':'יצירת הטיול'}</button></form>`);
    renderPeople();
    showPrepaid();
    $('#newPeople').oninput=()=>{
      readPeople();
      const count=Math.max(1,Math.min(1000,Number($('#newPeople').value)||1));
      while(peopleDraft.length<count)peopleDraft.push({name:`משתתף ${peopleDraft.length+1}`,budget:''});
      peopleDraft=peopleDraft.slice(0,count);renderPeople();
    };
    $('#tripCurrency').onchange=()=>{readPeople();renderPeople();};
    $('#newStart').onchange=()=>{$('#newEnd').min=$('#newStart').value;};
    $('#addPrepaid').onclick=()=>{prepaidRows.push({name:'',amount:'',currency:''});showPrepaid();};
    $('#scanTripDocs').onclick=async()=>{
      const files=[...$('#tripDocuments').files],status=$('#documentStatus'),button=$('#scanTripDocs');
      if(!files.length||files.length>2){status.textContent='בחר מסמך אחד או שניים.';return;}
      if(files.some(f=>f.size>4*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(f.type))){status.textContent='אפשר לבחור PDF או תמונה עד 4MB לכל קובץ.';return;}
      button.disabled=true;status.textContent='סורק ומחלץ את פרטי הטיול…';
      try{
        const encoded=await Promise.all(files.map(async file=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {type:file.type,data:btoa(binary)};}));
        const data=await aiCall('documents',{trip:{city:$('#newCity').value},files:encoded});
        const x=data.extracted||{},arrival=x.arrival||{},departure=x.departure||{};
        scannedDetails={...scannedDetails,...x,arrival,departure};
        const destination=x.destination||x.city;if(destination)$('#newCity').value=destination;
        if(x.start&&validISO(x.start))$('#newStart').value=x.start;
        else if(arrival.date&&validISO(arrival.date))$('#newStart').value=arrival.date;
        else if(x.hotelCheckIn&&validISO(x.hotelCheckIn))$('#newStart').value=x.hotelCheckIn;
        if(x.end&&validISO(x.end))$('#newEnd').value=x.end;
        else if(x.hotelCheckOut&&validISO(x.hotelCheckOut))$('#newEnd').value=x.hotelCheckOut;
        else if(departure.date&&validISO(departure.date))$('#newEnd').value=departure.date;
        if(x.people&&Number.isInteger(Number(x.people))&&Number(x.people)>0){
          if(!existingCountLocked){readPeople();const count=Math.min(1000,Number(x.people));while(peopleDraft.length<count)peopleDraft.push({name:`משתתף ${peopleDraft.length+1}`,budget:''});peopleDraft=peopleDraft.slice(0,count);$('#newPeople').value=count;renderPeople();}
        }
        if(x.hotel)$('#tripHotel').value=x.hotel;
        if(Array.isArray(x.prepaidExpenses)){
          const seen=new Set(prepaidRows.map(r=>`${String(r.name).toLowerCase()}|${r.amount}|${r.currency}`));
          for(const cost of x.prepaidExpenses){const row={name:String(cost.name||'').slice(0,120),amount:cost.amount==null?'':String(cost.amount),currency:currencies.includes(String(cost.currency||'').toUpperCase())?String(cost.currency).toUpperCase():''};if(row.name&&row.amount&&!seen.has(`${row.name.toLowerCase()}|${row.amount}|${row.currency}`)){prepaidRows.push(row);seen.add(`${row.name.toLowerCase()}|${row.amount}|${row.currency}`);}}
          showPrepaid();
        }
        $('#documentResults').innerHTML=`<div class="document-result"><b>פרטי הטיול שחולצו — בדוק ותקן לפני השמירה</b><p>יעד: ${escapeHTML(destination||'לא זוהה')}</p><p>תאריכים: ${escapeHTML($('#newStart').value||'לא זוהו')} עד ${escapeHTML($('#newEnd').value||'לא זוהו')}</p><p>נוסעים: ${escapeHTML(x.people||'לא זוהה')}</p><p>מלון / נקודת התחלה: ${escapeHTML(x.hotel||'לא זוהה')}</p><p>נחיתה: ${escapeHTML(arrival.date||'לא זוהה')} ${escapeHTML(arrival.time||'')} ${escapeHTML(arrival.airport||'')}</p><p>המראה חזרה: ${escapeHTML(departure.date||'לא זוהה')} ${escapeHTML(departure.time||'')} ${escapeHTML(departure.airport||'')}</p><small>${escapeHTML(data.message||'')}</small></div>`;
        status.textContent='הסריקה הושלמה. בדוק את הפרטים ואת התקציב האישי; הקבצים לא נשמרים.';
      }catch(error){status.textContent=error.message||'סריקת המסמכים נכשלה.';}
      finally{button.disabled=false;}
    };
    $('#tripForm').onsubmit=async e=>{
      e.preventDefault();const button=e.submitter,error=$('#formError');button.disabled=true;error.textContent='';readPeople();
      try{
        const people=peopleDraft.map((p,i)=>{
          const name=String(p.name||'').trim(),raw=String(p.budget??'').trim(),budget=raw===''?0:Number(raw);
          if(!name)throw Error(`יש למלא שם למשתתף ${i+1}`);
          if(!Number.isFinite(budget)||budget<0||budget>100000000||(!t&&budget<=0))throw Error(`יש למלא תקציב אישי תקין עבור ${name}`);
          return {id:p.id||crypto.randomUUID(),name,budget};
        });
        const newCosts=[];
        for(const row of prepaidRows){
          const name=String(row.name||'').trim(),originalAmount=Number(row.amount),originalCurrency=String(row.currency||'').toUpperCase();
          if(!name||!Number.isFinite(originalAmount)||originalAmount<=0||!currencies.includes(originalCurrency))throw Error('בדוק את שם ההוצאה, הסכום והמטבע של כל עלות ששולמה מראש.');
          const duplicate=(t?.expenses||[]).some(old=>old.source==='travel-document'&&old.name.toLowerCase()===name.toLowerCase()&&Math.abs(Number(old.originalAmount)-originalAmount)<0.005&&old.originalCurrency===originalCurrency);
          if(duplicate)continue;
          const {rate,date}=await currencyRate(originalCurrency,$('#tripCurrency').value),amount=Math.round(originalAmount*rate*100)/100;
          newCosts.push({id:crypto.randomUUID(),name,amount,shared:true,personalParticipantId:null,splits:makeEqualSplits(amount,people),originalAmount,originalCurrency,rate,rateDate:date,source:'travel-document'});
        }
        const avgBudget=Math.round(people.reduce((sum,p)=>sum+p.budget,0)/people.length*100)/100;
        const next=TripModel.trip({...t,city:$('#newCity').value,start:$('#newStart').value,end:$('#newEnd').value,people:people.length,participants:people,currency:$('#tripCurrency').value,budgetPerPerson:avgBudget,hotel:$('#tripHotel').value,travelDetails:{...scannedDetails,prepaidExpenses:prepaidRows.length?prepaidRows.map(r=>({...r})):(scannedDetails.prepaidExpenses||[])},expenses:[...(t?.expenses||[]),...newCosts]});
        if(next.stops.some(s=>s.date<next.start||s.date>next.end))throw Error('יש תחנות מחוץ לטווח התאריכים החדש. העבר אותן לימים אחרים לפני השמירה.');
        const before=state.trips;state.trips=t?state.trips.map(x=>x.id===t.id?next:x):[next,...state.trips];
        try{save();}catch(err){state.trips=before;throw err;}
        renderTrips();closeModal();selectTrip(next.id);toast('הטיול והתקציבים האישיים נשמרו');
      }catch(err){error.textContent=err.message||'לא ניתן לשמור. בדוק את הפרטים ואת החיבור.';}
      finally{button.disabled=false;}
    };
  }

  function enhancedBudget(){
    const t=currentTrip();if(!t)return;
    const summary=TripModel.budgetSummary(t);
    const oldRender=window.__triplyBudgetBase;
    if(oldRender)oldRender();
    const hero=$('.budget-hero');
    if(hero)hero.innerHTML=`<div><span>יתרה כוללת לכל המשתתפים · ${escapeHTML(t.currency)}</span><strong class="budget-remaining-total">${money(summary.totalRemaining)}</strong><small>תקציב כולל ${money(summary.totalBudget)} · הוצאות שנרשמו ${money(summary.totalSpent)}</small></div>`;
    const list=$('.participant-balances');
    if(list)list.innerHTML=summary.participants.map(p=>`<article class="participant-balance"><div class="participant-balance-head"><b>${escapeHTML(p.name)}</b><strong class="${p.remaining<0?'over-budget':''}">${money(p.remaining)} <small>${escapeHTML(t.currency)} נותרו</small></strong></div><p>תקציב אישי ${money(p.budget)} · הוצאות ${money(p.spent)} ${escapeHTML(t.currency)}</p></article>`).join('');
  }

  function rememberChatProfile(answer,trip){
    const text=String(answer||'').trim().slice(0,1000),activities=[
      ['בטן־גב',/בטן[\s-־]?גב|חוף|חופים|ים|beach|swim/i],
      ['אקסטרים',/אקסטרים|הרפתקאות|adrenaline/i],
      ['נופים',/נוף|נופים|תצפית|תצפיות|view/i],
      ['תרבות והיסטוריה',/תרבות|היסטוריה|היסטורי|culture|history/i],
      ['מוזיאונים',/מוזיאון|מוזיאונים|museum/i],
      ['טבע וטיולים',/טבע|פארק|פארקים|טיול רגלי|hiking|nature/i],
      ['קניות',/קניות|שופינג|shopping/i],
      ['חיי לילה',/חיי לילה|מועדון|מועדונים|nightlife/i],
      ['רגוע',/רגוע|נינוח|בלי לחץ|relaxed/i]
    ];
    const isNegated=match=>{const index=text.search(match);if(index<0)return false;return /(?:לא\s+(?:אוהב(?:ת)?|רוצה|מתאים)|בלי|נמנע(?:ת)?)\s*(?:את\s+)?$/i.test(text.slice(Math.max(0,index-24),index));};
    const selected=activities.filter(([,pattern])=>pattern.test(text)&&!isNegated(pattern)).map(([label])=>label);
    const kind=text.match(/(?:^|[\s,;])(?:זוגי|חברים|משפחה|טיול\s+לבד|לבד|אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|עם\s+הילדים|my\s+wife|my\s+husband|my\s+partner)(?=$|[\s,;.!?])/i)?.[0]?.trim().replace(/\s+/g,' ');
    const normalizedKind=/אשתי|בעלי|בת\s+הזוג|בן\s+הזוג|my\s+(?:wife|husband|partner)/i.test(kind||'')?'זוגי':kind==='לבד'||kind==='טיול לבד'?'טיול יחיד':/ילדים/i.test(kind||'')?'משפחה':kind;
    let changed=false;
    if(!String(trip.travelType||'').trim()&&normalizedKind){trip.travelType=normalizedKind;changed=true;}
    const current=Array.isArray(trip.activityTypes)?trip.activityTypes:[];
    const merged=Array.from(new Set(current.concat(selected)));
    if(merged.length!==current.length){trip.activityTypes=merged;changed=true;}
    const oldNotes=String(preferences.profileNotes||'').split('\n').map(value=>value.trim()).filter(Boolean);
    if(text&&!oldNotes.some(value=>value.toLocaleLowerCase()===text.toLocaleLowerCase())){preferences.profileNotes=oldNotes.concat([text]).slice(-4).join('\n').slice(0,1500);changed=true;}
    if(/קצב\s*(?:רגוע|נינוח)|(?:רגוע|נינוח)\s*(?:לגמרי|יותר)?|בלי\s+לחץ/i.test(text)&&!isNegated(/(?:רגוע|נינוח)/i)){preferences.pace='relaxed';changed=true;}
    else if(/קצב\s*(?:עמוס|מלא)|(?:עמוס|מלא)\s*(?:כמה\s+שיותר|בכל\s+יום)?|להספיק\s+כמה\s+שיותר/i.test(text)&&!isNegated(/(?:עמוס|מלא)/i)){preferences.pace='busy';changed=true;}
    else if(/קצב\s*מאוזן|מאוזן/i.test(text)&&!isNegated(/מאוזן/i)){preferences.pace='balanced';changed=true;}
    if(selected.length){
      const prior=String(preferences.interests||'').split(/[,،;؛]+/).map(value=>value.trim()).filter(Boolean);
      preferences.interests=Array.from(new Set(prior.concat(selected))).join(', ').slice(0,1000);
    }
    if(!changed)return false;
    try{if(typeof profileStorageKey==='function')localStorage.setItem(profileStorageKey('preferences'),JSON.stringify(preferences));return true;}catch{return false;}
  }

  function enhancedChat(){
    const t=currentTrip();if(!t){toast('בחר טיול כדי להתחיל לתכנן');return;}
    let sending=false;
    openModal(`<div class="chat-heading"><h2>מתכננים את ${escapeHTML(t.city)}</h2><p>אפשר להתחיל מבקשה כללית או לציין מקומות משלך. אם צריך, אשאל מה מתאים לך לפני שאציע תוכנית. שום שינוי לא יישמר בלי אישור.</p></div><div id="chatHistory" class="chat-history" role="log" aria-live="polite" aria-label="התכתבות עם מתכנן הטיול"></div><div id="proposalPanel"></div><form id="chatForm" class="chat-composer"><label for="chatMessage">מה תרצה לתכנן או לשנות?</label><textarea id="chatMessage" rows="3" maxlength="3000" required placeholder="למשל: תכנן לי טיול שמתאים לנו בניו יורק"></textarea><div class="chat-send-row"><p id="chatStatus" role="status"></p><button id="chatSend" class="primary-btn" type="submit">שליחה</button></div></form>`);
    $('#modalContent').classList.add('chat-dialog');const originalClose=closeModal;$('.modal-close').onclick=()=>{originalClose();$('#modalContent').classList.remove('chat-dialog');};
    const draw=()=>{$('#chatHistory').innerHTML=t.chat.length?t.chat.map(m=>{const sources=(Array.isArray(m.sources)?m.sources:[]).filter(source=>source&&typeof source.name==='string'&&typeof source.url==='string'&&/^https:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com\/|maps\.app\.goo\.gl\/)/i.test(source.url)).slice(0,12);return `<div class="message ${m.role==='user'?'from-user':'from-assistant'}"><b>${m.role==='user'?'אתה':'מתכנן הטיול'}</b><p>${escapeHTML(m.text)}</p>${sources.length?`<div class="maps-sources"><span>מקורות: Google Maps</span>${sources.map(source=>`<a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.name)}</a>`).join('')}</div>`:''}</div>`;}).join(''):'<div class="message from-assistant"><p>ספר לי מה תרצה לעשות בטיול. אם אין לך עדיין מקומות בראש, אשאל על הסגנון שלך ואציע כיוונים.</p></div>';$('#chatHistory').scrollTop=$('#chatHistory').scrollHeight;};
    draw();$('#chatMessage').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#chatForm').requestSubmit();}};
    $('#chatForm').onsubmit=async e=>{
      e.preventDefault();if(sending)return;
      const input=$('#chatMessage'),text=input.value.trim();if(!text)return;
      sending=true;input.value='';const submit=$('#chatSend'),status=$('#chatStatus'),history=$('#chatHistory'),panel=$('#proposalPanel');submit.disabled=true;status.textContent='בונה ובודק הצעה למסלול…';panel.replaceChildren();
      const stateKeys=['city','start','end','people','participants','currency','budgetPerPerson','hotel','travelDetails','travelType','activityTypes','stops','expenses','dailySchedule','scheduleStopSnapshot'];
      const stateSnapshot=()=>JSON.stringify(Object.fromEntries(stateKeys.map(key=>[key,t[key]])));
      let snapshot;t.chat.push({role:'user',text});
      if(window.TriplyAutoPlan&&TriplyAutoPlan.wantsWholeTrip(text)){try{save();}catch{}draw();sending=false;submit.disabled=false;status.textContent='';panel.replaceChildren();TriplyAutoPlan.startInChat(t,text,{panel,draw,status});return;}
      try{
        const previousMessages=t.chat.slice(-12,-1),lastAssistantIndex=previousMessages.map(m=>m.role).lastIndexOf('assistant');
        const answeredDiscovery=previousMessages.some(m=>m.role==='assistant'&&/איך אתה אוהב לטייל|איזה סגנון טיול מתאים לך/i.test(String(m.text||'')));
        const volunteeredProfile=/(?:זוג(?:י|ית)?|בן.{0,4}זוג|בת.{0,4}זוג|אשתי|בעלי|חברים|חברה שלי|ילדים|משפחה|טיול\s+לבד|לבד|couple|wife|husband|partner|friends|family|kids|solo)/i.test(text)&&/(?:בטן[\s-־]?גב|חופים?|ים|אקסטרים|הרפתקאות|נופים?|תצפיות|תרבות|היסטוריה|מוזיאונים?|טבע|פארקים?|קניות|שופינג|חיי\s+לילה|adventure|nature|museums?|culture|shopping|nightlife)/i.test(text);
        const remembered=(answeredDiscovery||volunteeredProfile)?rememberChatProfile(text,t):false;
        snapshot=stateSnapshot();
        save();draw();
        const recentContext=previousMessages.filter((m,index)=>m.role==='user'||index===lastAssistantIndex).slice(-4);
        const originalPlanningRequest=t.chat.slice(0,-1).reverse().find(m=>m.role==='user'&&/(?:תכנן|תתכנן|תבנה|מסלול|אטרקציות|תוכנית|טיול מלא|תמשיך)/i.test(String(m.text||'')));
        if(originalPlanningRequest&&!recentContext.includes(originalPlanningRequest))recentContext.unshift(originalPlanningRequest);
        const conversationHistory=recentContext.slice(-5).map(m=>({role:m.role,text:String(m.text||'').slice(0,m.role==='assistant'?450:1600)}));
        const data=await aiCall('plan',{message:text,trip:{id:t.id,city:t.city,start:t.start,end:t.end,people:t.people,participants:t.participants,currency:t.currency,budgetPerPerson:t.budgetPerPerson,hotel:t.hotel,travelType:t.travelType,activityTypes:t.activityTypes,stops:t.stops,travelDetails:t.travelDetails,expenses:t.expenses,dailySchedule:t.dailySchedule},preferences,history:conversationHistory});
        if(typeof data.message!=='string'||!Array.isArray(data.operations))throw Error('ה-AI לא החזיר הצעה מובנית שאפשר לבדוק.');
        if(!history.isConnected)return;
        let operations=data.operations;
        const planningIntent=/מסלול|תכנן|תבנה|לבנות|סדר|הכנס|תכניס|פזר|מקומות|אטרקציות|יום מלא|כל היום|קם|קימה|לישון|שינה|מהרגע|ערוך|לשנות|שנה|עדכן|תקציב|משתתף|מלון|תאריך|הוצאה/i.test(text);
        let assistantText=data.message,preview=null;
        let schedule=null;
        const proposalData={operations,tripChanges:data.tripChanges||{},participants:data.participants,expenseOperations:data.expenseOperations||[]};
        const hasProposedData=operations.length||Object.keys(proposalData.tripChanges).length||proposalData.participants!==undefined||proposalData.expenseOperations.length;
        if(hasProposedData||Array.isArray(data.dailySchedule)&&data.dailySchedule.length)preview=TripPlanning.apply(t,proposalData);
        if(Array.isArray(data.dailySchedule)&&data.dailySchedule.length){try{schedule=TripPlanning.validateSchedule(preview?.trip||t,data.dailySchedule);if(preview)for(const day of schedule)for(const block of day.blocks)if(block.placeName&&!block.existingStopId){const added=preview.stops.find(stop=>stop.date===day.date&&stop.time===block.startTime&&stop.name.toLocaleLowerCase()===block.placeName.toLocaleLowerCase());if(added)block.existingStopId=added.id;}}catch{schedule=null;}}
        if(!schedule){
          const recovered=TripPlanning.recoverScheduleFromMessage(t,data.message,operations);
          if(recovered){operations=recovered.operations;proposalData.operations=operations;preview=TripPlanning.apply(t,proposalData);schedule=TripPlanning.validateSchedule(preview.trip,recovered.dailySchedule);assistantText+='\n\nשחזרתי את מבנה הלוח מתוך ההצעה ובדקתי שכל הימים והתחנות מכוסים. אפשר לבדוק ולאשר למטה; שום דבר לא נשמר עדיין.';}
        }
        if(remembered)assistantText+='\n\nשמרתי את ההעדפות האלה לטיולים הבאים במכשיר הזה. אפשר לשנות אותן בהגדרות.';
        if(preview?.changes.length||schedule){assistantText+=(assistantText?'\n\n':'')+`הכנתי הצעה לבדיקה${schedule?' עם לוח מלא ל־'+schedule.length+' ימים':''}. שום פרט לא יישמר עד שתאשר; אחרי השמירה אפשר לערוך את כל המקטעים והתחנות.`;}
        else if(planningIntent&&!data.needsInput&&!/[?؟]/.test(assistantText)){operations=[];assistantText+=(assistantText?'\n\n':'')+'לא נוצר שינוי בפועל במסלול. התוכנית המפורטת מופיעה למעלה; אם תרצה לשנות גם את המקומות, הימים או השעות במפה, כתוב לי בדיוק מה להזיז.';}
        t.chat.push({role:'assistant',text:assistantText,sources:Array.isArray(data.sources)?data.sources:[]});save();draw();status.textContent='';
        if(preview&&(preview.changes.length||schedule)){
          panel.innerHTML=`<h3>הצעה לשינויים · ${preview.changes.length} פרטים${schedule?' ולוח יום מלא':''}</h3><ul>${preview.changes.map(x=>'<li>'+escapeHTML(x)+'</li>').join('')}${schedule?'<li>לוח זמנים ל־'+schedule.length+' ימים, מהקימה ועד השינה</li>':''}</ul><p>בדוק את ההצעה. שום דבר לא משתנה עד לאישור. אחרי השמירה תוכל לערוך כל מקום ומקטע בלוח. שעות פתיחה וזמני מעבר לא אומתו בזמן אמת.</p><div class="modal-actions"><button id="rejectProposal" class="secondary-btn">ביטול ההצעה</button><button id="acceptProposal" class="primary-btn">אישור ועדכון הטיול</button></div>`;
          $('#rejectProposal').onclick=()=>{panel.replaceChildren();status.textContent='ההצעה בוטלה; המסלול נשאר ללא שינוי.';};
          $('#acceptProposal').onclick=()=>{
            if(stateSnapshot()!==snapshot){status.textContent='פרטי הטיול השתנו מאז ההצעה. שלח בקשה חדשה כדי למנוע דריסה.';panel.replaceChildren();return;}
            const before=Object.fromEntries(stateKeys.map(key=>[key,structuredClone(t[key])]));
            try{for(const key of stateKeys)t[key]=preview.trip[key];if(schedule){t.dailySchedule=schedule;t.scheduleStopSnapshot=JSON.stringify(preview.stops);}else if(t.dailySchedule?.length)t.scheduleStopSnapshot='';save();panel.replaceChildren();status.textContent=schedule?'הטיול ולוח הימים נשמרו. אפשר לערוך כל מקטע בלוח.':`${preview.changes.length} השינויים נשמרו בטיול.`;if(currentTrip()?.id===t.id){const firstProposed=preview.stops.filter(s=>operations.some(op=>op.type==='add'&&op.name===s.name)).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time))[0];if(firstProposed)selectedDate=firstProposed.date;if(!TripModel.dates(t.start,t.end).includes(selectedDate))selectedDate=t.start;renderTrip();}}
            catch{for(const key of stateKeys)t[key]=before[key];status.textContent='לא ניתן לשמור את השינוי. הטיול הקודם נשמר.';}
          };
        }
      }catch(err){
        if(status.isConnected){const message=err.message||'הבקשה נכשלה. נסה שוב.';t.chat.push({role:'assistant',text:`לא הצלחתי להשלים את הבקשה: ${message} ההודעה נשארה בהיסטוריה, ותיבת הכתיבה נוקתה.`});try{save();draw();}catch{}status.textContent=message;}
      }finally{sending=false;if(submit.isConnected)submit.disabled=false;}
    };
  }

  window.__triplyBudgetBase=window.renderBudget;
  window.tripForm=enhancedTripForm;
  window.renderBudget=enhancedBudget;
  window.openChat=enhancedChat;
  const chatButton=$('#aiPlanBtn');if(chatButton)chatButton.onclick=enhancedChat;
})();
