(function(){
  'use strict';
  var currencies=['ILS','GBP','USD','EUR'];
  var kinds=['זוגי','חברים','משפחה','טיול יחיד','אחר'];
  var activities=['בטן־גב','אקסטרים','נופים','תרבות והיסטוריה','מוזיאונים','טבע וטיולים','קניות','חיי לילה','רגוע'];
  var validISO=function(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&Number.isFinite(Date.parse(value+'T00:00:00Z'));};
  var equalSplits=function(amount,people){
    var cents=Math.round(amount*100),base=Math.floor(cents/people.length),extra=cents%people.length,out={};
    people.forEach(function(person,index){out[person.id]=(base+(index<extra?1:0))/100;});
    return out;
  };

  function tripWizard(edit){
    var t=edit?currentTrip():null;
    var mode=t?'manual':'',step=t?2:1,scanned=!!t;
    var scannedDetails=Object.assign({},t&&t.travelDetails||{}),prepaidRows=[];
    var peopleDraft=t?t.participants.map(function(p){return {id:p.id,name:p.name,budget:String(p.budget==null?t.budgetPerPerson:p.budget)};}):[{name:'משתתף 1',budget:''}];
    var tripKind=t&&t.travelType||'',activityDraft=t&&Array.isArray(t.activityTypes)?t.activityTypes.slice():[];
    var locked=!!(t&&t.expenses.length),initialCurrency=t&&t.currency||'ILS';

    function participantHTML(){
      return peopleDraft.map(function(p,i){
        return '<div class="traveler-budget-row"><label><span>שם משתתף '+(i+1)+'</span><input data-person-name="'+i+'" maxlength="80" value="'+escapeHTML(p.name)+'" placeholder="למשל: עידן"></label><label><span>תקציב אישי ('+escapeHTML($('#tripCurrency')?$('#tripCurrency').value:initialCurrency)+')</span><input data-person-budget="'+i+'" type="number" inputmode="decimal" min="'+(t?'0':'0.01')+'" max="100000000" step="0.01" value="'+escapeHTML(p.budget)+'" placeholder="למשל 5000"></label></div>';
      }).join('');
    }
    function readPeople(){
      peopleDraft=peopleDraft.map(function(p,i){
        return Object.assign({},p,{name:$('[data-person-name="'+i+'"]')? $('[data-person-name="'+i+'"]').value:p.name,budget:$('[data-person-budget="'+i+'"]')? $('[data-person-budget="'+i+'"]').value:p.budget});
      });
    }
    function renderPeople(){var host=$('#travelerBudgetFields');if(host)host.innerHTML=participantHTML();}
    function showPrepaid(){
      var host=$('#prepaidRows');if(!host)return;
      host.innerHTML=prepaidRows.length?prepaidRows.map(function(row,i){
        return '<div class="prepaid-row"><label><span>הוצאה שחולצה</span><input data-prepaid-name="'+i+'" maxlength="120" value="'+escapeHTML(row.name)+'" placeholder="כרטיס טיסה / מלון"></label><label><span>סכום</span><input data-prepaid-amount="'+i+'" type="number" min="0.01" max="100000000" step="0.01" value="'+escapeHTML(row.amount)+'"></label><label><span>מטבע</span><select data-prepaid-currency="'+i+'"><option value="">בחירת מטבע</option>'+currencies.map(function(c){return '<option value="'+c+'" '+(row.currency===c?'selected':'')+'>'+c+'</option>';}).join('')+'</select></label><button type="button" class="small-btn" data-prepaid-remove="'+i+'" aria-label="הסרת הוצאה">×</button></div>';
      }).join(''):'<p class="muted">לא זוהו הוצאות ששולמו מראש. אפשר להוסיף ידנית.</p>';
      prepaidRows.forEach(function(row,i){
        $('[data-prepaid-name="'+i+'"]').oninput=function(e){row.name=e.target.value;};
        $('[data-prepaid-amount="'+i+'"]').oninput=function(e){row.amount=e.target.value;};
        $('[data-prepaid-currency="'+i+'"]').onchange=function(e){row.currency=e.target.value;};
      });
      $$('[data-prepaid-remove]').forEach(function(button){button.onclick=function(){prepaidRows.splice(Number(button.dataset.prepaidRemove),1);showPrepaid();};});
    }

    var kindHTML=kinds.map(function(kind){return '<label class="trip-kind-option"><input type="radio" name="tripKind" value="'+escapeHTML(kind)+'" '+(tripKind===kind?'checked':'')+'><span>'+escapeHTML(kind)+'</span></label>';}).join('');
    var activityHTML=activities.map(function(activity){return '<label class="activity-option"><input type="checkbox" data-activity="'+escapeHTML(activity)+'" '+(activityDraft.includes(activity)?'checked':'')+'><span>'+escapeHTML(activity)+'</span></label>';}).join('');
    openModal('<h2>'+(t?'עריכת טיול':'טיול חדש')+'</h2><form id="tripForm" novalidate>'+
      '<div class="wizard-progress"><span id="wizardStepLabel"></span><div class="wizard-progress-track"><i id="wizardProgressBar"></i></div><p id="wizardStepCaption"></p></div>'+
      '<section class="wizard-stage" id="wizardStage1"><h3>איך תרצה להתחיל?</h3><p class="wizard-hint">בחר אפשרות אחת: סריקת מסמכים או מילוי הפרטים בעצמך.</p><div class="source-choice-grid">'+
      '<button type="button" class="source-choice" data-source="documents" aria-pressed="false"><span class="source-choice-icon">✈️</span><b>שליחת קבצים</b><small>ה-AI יחלץ יעד, תאריכים, מלון ופרטי טיסה</small></button>'+
      '<button type="button" class="source-choice" data-source="manual" aria-pressed="false"><span class="source-choice-icon">✍️</span><b>מילוי נתונים</b><small>ממלאים את פרטי הטיול באופן ידני</small></button></div><p id="sourceError" class="wizard-error" role="alert"></p></section>'+
      '<section class="wizard-stage" id="wizardStage2" hidden><h3>פרטי הטיול</h3><div id="documentPane"><p class="wizard-hint">הקבצים נשלחים ל-Google לצורך סריקה בלבד ואינם נשמרים באפליקציה.</p><div class="field"><label for="tripDocuments">בחר עד שני קובצי PDF או תמונות, עד 4MB לקובץ</label><input id="tripDocuments" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></div><button type="button" class="secondary-btn" id="scanTripDocs">סריקה ומילוי אוטומטי</button><p id="documentStatus" role="status"></p><div id="documentResults"></div></div>'+
      '<div id="tripDetailsFields"><div class="field"><label for="newCity">יעד</label><input id="newCity" maxlength="150" value="'+escapeHTML(t&&t.city||'')+'" autocomplete="off" placeholder="למשל: לונדון"></div><div class="field-grid"><div class="field"><label for="newStart">מתאריך</label><input id="newStart" type="date" value="'+(t&&t.start||'')+'"></div><div class="field"><label for="newEnd">עד תאריך</label><input id="newEnd" type="date" value="'+(t&&t.end||'')+'"></div></div><div class="field"><label for="tripHotel">מלון או נקודת יציאה (לא חובה)</label><input id="tripHotel" value="'+escapeHTML(t&&t.hotel||'')+'" maxlength="250" placeholder="שם המלון או כתובת"></div></div></section>'+
      '<section class="wizard-stage" id="wizardStage3" hidden><h3>מי נוסע ומה התקציב?</h3><p class="wizard-hint">מגדירים תקציב אישי לכל אחד. הסכומים יכולים להיות שונים.</p><div class="field"><label for="newPeople">מספר נוסעים</label><input id="newPeople" type="number" inputmode="numeric" min="1" max="1000" step="1" value="'+(t&&t.people||1)+'" '+(locked?'disabled':'')+'></div>'+
      (locked?'<small>מספר המשתתפים נעול לאחר רישום הוצאות כדי לשמור על החלוקה שלהן.</small>':'')+
      '<div class="field"><label for="tripCurrency">מטבע התקציב</label><select id="tripCurrency" '+(t&&t.expenses.length?'disabled':'')+'>'+currencies.map(function(c){return '<option value="'+c+'" '+(c===initialCurrency?'selected':'')+'>'+c+'</option>';}).join('')+'</select>'+(t&&t.expenses.length?'<small>לא ניתן לשנות מטבע לאחר רישום הוצאות.</small>':'')+'</div>'+
      '<section class="traveler-budgets"><h3>תקציב אישי לכל משתתף</h3><div id="travelerBudgetFields"></div></section>'+
      '<section class="prepaid-editor" id="prepaidSection"><h3>טיסה ומלון ששולמו מראש</h3><p>הסכומים שחולצו יירשמו כהוצאות משותפות ויתחלקו בין המשתתפים. בדוק את המטבע והסכום.</p><div id="prepaidRows"></div><button type="button" class="small-btn" id="addPrepaid">＋ הוספת עלות ששולמה מראש</button></section></section>'+
      '<section class="wizard-stage" id="wizardStage4" hidden><h3>איזה טיול תרצה?</h3><p class="wizard-hint">הבחירות עוזרות להתאים את ההמלצות לאופי הקבוצה.</p><div class="field"><span class="wizard-label">סוג הטיול</span><div class="trip-kind-grid">'+kindHTML+'</div></div><div class="field"><span class="wizard-label">סוגי הפעילות — אפשר לבחור כמה</span><div class="activity-choice-grid">'+activityHTML+'</div></div><p class="wizard-hint">מסעדות לא יתווספו אלא אם תבקש זאת במפורש בצ׳אט.</p></section>'+
      '<p id="formError" class="wizard-error" role="alert"></p><div class="wizard-actions"><button type="button" id="wizardBack" class="secondary-btn">חזרה</button><button type="button" id="wizardNext" class="primary-btn">המשך</button><button type="submit" id="wizardSave" class="primary-btn" hidden>'+(t?'שמירת השינויים':'יצירת הטיול')+'</button></div></form>');

    function renderWizard(){
      [1,2,3,4].forEach(function(number){var panel=$('#wizardStage'+number);panel.hidden=number!==step||(!!t&&number===1);});
      $('#wizardStepLabel').textContent='שלב '+(t?step-1:step)+' מתוך '+(t?3:4);
      $('#wizardProgressBar').style.width=((t?(step-1)/3:step/4)*100)+'%';
      $('#wizardStepCaption').textContent={1:'בחירת דרך פתיחת הטיול',2:mode==='documents'?'סריקת כרטיס טיסה או מלון':'יעד, תאריכים ומלון',3:'משתתפים ותקציב אישי',4:'אופי הטיול והפעילויות'}[step]||'';
      $('#wizardBack').hidden=step===1||!!(t&&step===2);
      $('#wizardNext').hidden=step===4;$('#wizardSave').hidden=step!==4;
      $('#wizardNext').textContent=step===1?'המשך לפרטי הטיול':'המשך';
      $('#documentPane').hidden=mode!=='documents';
      $('#tripDetailsFields').hidden=mode==='documents'&&!scanned;
      $('#prepaidSection').hidden=mode!=='documents'&&!t;
      $$('[data-source]').forEach(function(button){var selected=button.dataset.source===mode;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
      renderPeople();showPrepaid();
    }
    function chooseSource(nextMode){
      if(mode&&mode!==nextMode){
        scanned=false;scannedDetails={};prepaidRows=[];
        $('#tripDocuments').value='';$('#newCity').value='';$('#newStart').value='';$('#newEnd').value='';$('#tripHotel').value='';
        $('#documentResults').replaceChildren();$('#documentStatus').textContent='';
      }
      mode=nextMode;$('#sourceError').textContent='';renderWizard();
    }
    $$('[data-source]').forEach(function(button){button.onclick=function(){chooseSource(button.dataset.source);};});
    $('#newPeople').oninput=function(){
      readPeople();var count=Math.max(1,Math.min(1000,Number($('#newPeople').value)||1));
      while(peopleDraft.length<count)peopleDraft.push({name:'משתתף '+(peopleDraft.length+1),budget:''});
      peopleDraft=peopleDraft.slice(0,count);renderPeople();
    };
    $('#tripCurrency').onchange=function(){readPeople();renderPeople();};
    $('#newStart').onchange=function(){$('#newEnd').min=$('#newStart').value;};
    $('#tripDocuments').onchange=function(){
      if(!scanned)return;
      scanned=false;scannedDetails={};prepaidRows=[];
      $('#newCity').value='';$('#newStart').value='';$('#newEnd').value='';$('#tripHotel').value='';
      $('#documentResults').replaceChildren();$('#documentStatus').textContent='נבחר קובץ חדש; יש לסרוק אותו לפני שממשיכים.';
      renderWizard();
    };
    $('#addPrepaid').onclick=function(){prepaidRows.push({name:'',amount:'',currency:''});showPrepaid();};
    $$('[data-activity]').forEach(function(input){input.onchange=function(){activityDraft=input.checked?Array.from(new Set(activityDraft.concat([input.dataset.activity]))):activityDraft.filter(function(value){return value!==input.dataset.activity;});};});
    $$('input[name="tripKind"]').forEach(function(input){input.onchange=function(){tripKind=input.value;};});
    function checkTripDetails(){
      if(!String($('#newCity').value||'').trim())throw Error('יש למלא יעד');
      if(!$('#newStart').value||!$('#newEnd').value)throw Error('יש למלא את תאריכי הטיול');
      TripModel.dates($('#newStart').value,$('#newEnd').value);
    }
    function checkPeople(){
      readPeople();
      return peopleDraft.map(function(person,index){
        var name=String(person.name||'').trim(),raw=String(person.budget==null?'':person.budget).trim(),budget=raw===''?0:Number(raw);
        if(!name)throw Error('יש למלא שם למשתתף '+(index+1));
        if(!Number.isFinite(budget)||budget<0||budget>100000000||(!t&&budget<=0))throw Error('יש למלא תקציב אישי תקין עבור '+name);
        return {id:person.id||crypto.randomUUID(),name:name,budget:budget};
      });
    }
    $('#wizardBack').onclick=function(){if(step>1){step--;$('#formError').textContent='';renderWizard();}};
    $('#wizardNext').onclick=function(){
      try{
        $('#formError').textContent='';
        if(step===1&&!mode)throw Error('בחר אחת משתי האפשרויות כדי להמשיך');
        if(step===2){if(mode==='documents'&&!scanned)throw Error('סרוק את הקבצים קודם, או חזור ובחר מילוי נתונים');checkTripDetails();}
        if(step===3)checkPeople();
        step++;renderWizard();
      }catch(error){if(step===1)$('#sourceError').textContent=error.message;else $('#formError').textContent=error.message;}
    };
    $('#scanTripDocs').onclick=async function(){
      var files=Array.from($('#tripDocuments').files),status=$('#documentStatus'),button=$('#scanTripDocs');
      if(mode!=='documents'){status.textContent='בחר שליחת קבצים בשלב הראשון כדי לסרוק מסמכים.';return;}
      if(!files.length||files.length>2){status.textContent='בחר קובץ אחד או שניים.';return;}
      if(files.some(function(file){return file.size>4*1024*1024||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type);})){status.textContent='אפשר לבחור PDF או תמונה עד 4MB לכל קובץ.';return;}
      button.disabled=true;status.textContent='סורק ומחלץ את פרטי הטיול…';
      try{
        var encoded=await Promise.all(files.map(async function(file){var bytes=new Uint8Array(await file.arrayBuffer()),binary='';for(var i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));return {type:file.type,data:btoa(binary)};}));
        var data=await aiCall('documents',{trip:{city:$('#newCity').value},files:encoded}),x=data.extracted||{},arrival=x.arrival||{},departure=x.departure||{};
        scannedDetails=Object.assign({},scannedDetails,x,{arrival:arrival,departure:departure});
        var destination=x.destination||x.city;if(destination)$('#newCity').value=destination;
        if(x.start&&validISO(x.start))$('#newStart').value=x.start;else if(arrival.date&&validISO(arrival.date))$('#newStart').value=arrival.date;else if(x.hotelCheckIn&&validISO(x.hotelCheckIn))$('#newStart').value=x.hotelCheckIn;
        if(x.end&&validISO(x.end))$('#newEnd').value=x.end;else if(x.hotelCheckOut&&validISO(x.hotelCheckOut))$('#newEnd').value=x.hotelCheckOut;else if(departure.date&&validISO(departure.date))$('#newEnd').value=departure.date;
        if(x.people&&Number.isInteger(Number(x.people))&&Number(x.people)>0){var count=Math.min(1000,Number(x.people));while(peopleDraft.length<count)peopleDraft.push({name:'משתתף '+(peopleDraft.length+1),budget:''});peopleDraft=peopleDraft.slice(0,count);$('#newPeople').value=count;}
        if(x.hotel)$('#tripHotel').value=x.hotel;
        if(Array.isArray(x.prepaidExpenses)){
          var seen=new Set(prepaidRows.map(function(row){return String(row.name).toLowerCase()+'|'+row.amount+'|'+row.currency;}));
          x.prepaidExpenses.forEach(function(cost){var currency=String(cost.currency||'').toUpperCase(),row={name:String(cost.name||'').slice(0,120),amount:cost.amount==null?'':String(cost.amount),currency:currencies.includes(currency)?currency:''},key=row.name.toLowerCase()+'|'+row.amount+'|'+row.currency;if(row.name&&row.amount&&!seen.has(key)){prepaidRows.push(row);seen.add(key);}});
        }
        scanned=true;renderWizard();
        $('#documentResults').innerHTML='<div class="document-result"><b>פרטים שחולצו — בדוק ותקן לפני השמירה</b><p>יעד: '+escapeHTML(destination||'לא זוהה')+'</p><p>תאריכים: '+escapeHTML($('#newStart').value||'לא זוהו')+' עד '+escapeHTML($('#newEnd').value||'לא זוהו')+'</p><p>נוסעים: '+escapeHTML(x.people||'לא זוהה')+'</p><p>מלון / נקודת התחלה: '+escapeHTML(x.hotel||'לא זוהה')+'</p><p>נחיתה: '+escapeHTML(arrival.date||'לא זוהה')+' '+escapeHTML(arrival.time||'')+' '+escapeHTML(arrival.airport||'')+'</p><p>המראה חזרה: '+escapeHTML(departure.date||'לא זוהה')+' '+escapeHTML(departure.time||'')+' '+escapeHTML(departure.airport||'')+'</p><small>'+escapeHTML(data.message||'')+'</small></div>';
        status.textContent='הסריקה הושלמה. השלם כל פרט חסר; המסמכים עצמם לא נשמרים.';
      }catch(error){status.textContent=error.message||'סריקת המסמכים נכשלה.';}
      finally{button.disabled=false;}
    };
    $('#tripForm').onsubmit=async function(event){
      event.preventDefault();var button=$('#wizardSave'),error=$('#formError');button.disabled=true;error.textContent='';
      try{
        checkTripDetails();
        if(!t&&mode!=='documents'&&mode!=='manual')throw Error('חזור ובחר שליחת קבצים או מילוי נתונים');
        if(mode==='documents'&&!scanned)throw Error('סרוק את המסמכים לפני יצירת הטיול');
        var people=checkPeople();
        if(!tripKind&&!t)throw Error('בחר את סוג הטיול');
        if(!activityDraft.length&&!t)throw Error('בחר לפחות סוג פעילות אחד');
        var newCosts=[];
        for(var row of prepaidRows){
          var name=String(row.name||'').trim(),originalAmount=Number(row.amount),originalCurrency=String(row.currency||'').toUpperCase();
          if(!name||!Number.isFinite(originalAmount)||originalAmount<=0||!currencies.includes(originalCurrency))throw Error('בדוק את שם ההוצאה, הסכום והמטבע של כל עלות ששולמה מראש.');
          var duplicate=(t&&t.expenses||[]).some(function(old){return old.source==='travel-document'&&old.name.toLowerCase()===name.toLowerCase()&&Math.abs(Number(old.originalAmount)-originalAmount)<0.005&&old.originalCurrency===originalCurrency;});
          if(duplicate)continue;
          var conversion=await currencyRate(originalCurrency,$('#tripCurrency').value),amount=Math.round(originalAmount*conversion.rate*100)/100;
          newCosts.push({id:crypto.randomUUID(),name:name,amount:amount,shared:true,personalParticipantId:null,splits:equalSplits(amount,people),originalAmount:originalAmount,originalCurrency:originalCurrency,rate:conversion.rate,rateDate:conversion.date,source:'travel-document'});
        }
        var avgBudget=Math.round(people.reduce(function(sum,p){return sum+p.budget;},0)/people.length*100)/100;
        var next=TripModel.trip(Object.assign({},t||{},{city:$('#newCity').value.trim(),start:$('#newStart').value,end:$('#newEnd').value,people:people.length,participants:people,currency:$('#tripCurrency').value,budgetPerPerson:avgBudget,hotel:$('#tripHotel').value.trim(),travelDetails:Object.assign({},scannedDetails,{prepaidExpenses:prepaidRows.length?prepaidRows.map(function(row){return Object.assign({},row);}):(scannedDetails.prepaidExpenses||[])}),travelType:tripKind||(t&&t.travelType)||'',activityTypes:activityDraft,expenses:(t&&t.expenses||[]).concat(newCosts)}));
        if(next.stops.some(function(stop){return stop.date<next.start||stop.date>next.end;}))throw Error('יש תחנות מחוץ לטווח התאריכים החדש. העבר אותן לימים אחרים לפני השמירה.');
        var before=state.trips;state.trips=t?state.trips.map(function(item){return item.id===t.id?next:item;}):[next].concat(state.trips);
        try{save();}catch(err){state.trips=before;throw err;}
        renderTrips();closeModal();selectTrip(next.id);toast('הטיול והתקציבים האישיים נשמרו');
      }catch(error){$('#formError').textContent=error.message||'לא ניתן לשמור. בדוק את הפרטים ואת החיבור.';}
      finally{button.disabled=false;}
    };
    renderPeople();showPrepaid();renderWizard();
  }
  window.tripForm=tripWizard;
})();
