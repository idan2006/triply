(function(){
  'use strict';
  const previousRender=renderStops;
  renderStops=()=>{
    previousRender();
    const trip=currentTrip();
    const day=trip?.dailySchedule?.find(item=>item.date===selectedDate);
    if(!day)return;
    const list=$('#itineraryList');
    if(!list)return;
    const stale=trip.scheduleStopSnapshot!==JSON.stringify(trip.stops);
    const section=document.createElement('section');
      section.className='full-day-schedule';
      section.setAttribute('aria-label','לוח היום המלא');
    section.innerHTML=`<div class="full-day-heading"><div><h4>לוח היום המלא</h4><span>קימה ${escapeHTML(day.wakeTime)} · שינה ${escapeHTML(day.sleepTime)}</span></div><button type="button" class="small-btn" id="editDayTimes">עריכת שעות קימה ושינה</button></div>
      ${stale?'<p class="schedule-warning">האטרקציות השתנו מאז יצירת הלוח. כדאי לבקש מהמתכנן לעדכן את לוח היום לפני שמסתמכים עליו.</p>':''}
      <p class="schedule-caveat">שעות פתיחה וזמני מעבר הם הערכות תכנון; בדוק אותם לפני היציאה.</p>
      <ol class="schedule-blocks">${day.blocks.map((block,index)=>`<li class="schedule-block ${block.placeName?'sb-place':/^הליכה|חזרה ללינה \(הליכה/.test(block.activity)?'sb-walk':/תחבורה|מונית|שדה התעופה|נסיעה/.test(block.activity)?'sb-ride':/ארוחת|צהריים|קפה/.test(block.activity)?'sb-meal':''}"><time>${escapeHTML(block.startTime)}–${escapeHTML(block.endTime)}</time><div><strong>${escapeHTML(block.activity)}</strong>${block.placeName?`<small>${escapeHTML(block.placeName)}</small>`:''}</div><button type="button" class="small-btn schedule-edit-btn" data-edit-schedule="${index}" aria-label="עריכת ${escapeHTML(block.activity)}">עריכה</button></li>`).join('')}</ol>
      <h4 class="scheduled-stops-heading">אטרקציות במסלול לעריכה</h4>`;
    section.querySelector('#editDayTimes').onclick=()=>editDayTimes(trip,day);
    section.querySelectorAll('[data-edit-schedule]').forEach(button=>button.onclick=()=>editScheduleBlock(trip,day,Number(button.dataset.editSchedule)));
    list.prepend(section);
  };

  const minute=value=>{const match=String(value||'').match(/^([01]\d|2[0-3]):([0-5]\d)$/);return match?Number(match[1])*60+Number(match[2]):null;};
  const clock=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
  const snapshotKeys=['city','start','end','people','participants','currency','budgetPerPerson','hotel','travelDetails','travelType','activityTypes','stops','expenses','dailySchedule','scheduleStopSnapshot'];
  function saveDay(trip,schedule,operations=[]){
    const before=Object.fromEntries(snapshotKeys.map(key=>[key,structuredClone(trip[key])]));
    try{
      let proposal=TripPlanning.apply(trip,operations),validated=TripPlanning.validateSchedule(proposal.trip,schedule);
      for(const day of validated)for(const block of day.blocks)if(block.placeName&&!block.existingStopId){
        const linked=proposal.stops.find(stop=>stop.date===day.date&&stop.time===block.startTime&&stop.name.toLocaleLowerCase()===block.placeName.toLocaleLowerCase());
        if(linked)block.existingStopId=linked.id;
      }
      const synchronizedStops=TripPlanning.synchronizeScheduleStops(proposal.stops,validated);
      if(synchronizedStops.length)proposal=TripPlanning.apply(proposal.trip,synchronizedStops);
      Object.assign(trip,proposal.trip,{dailySchedule:validated,scheduleStopSnapshot:JSON.stringify(proposal.stops)});
      save();closeModal();renderTrip();toast('לוח היום נשמר וניתן להמשיך לערוך אותו');
    }catch(error){for(const key of snapshotKeys)trip[key]=before[key];const status=$('#scheduleEditError');if(status)status.textContent=error.message||'לא ניתן לשמור את השינוי';else toast(error.message||'לא ניתן לשמור את השינוי');}
  }
  function editScheduleBlock(trip,day,index){
    const original=day.blocks[index];if(!original)return;
    openModal(`<h2>עריכת מקטע בלוח</h2><form id="scheduleBlockForm"><div class="field"><label for="scheduleActivity">מה עושים?</label><input id="scheduleActivity" maxlength="240" required value="${escapeHTML(original.activity)}"></div><div class="field"><label for="schedulePlace">שם המקום (אם זה ביקור באטרקציה)</label><input id="schedulePlace" maxlength="160" value="${escapeHTML(original.placeName)}" placeholder="למשל: London Eye"><small>מקום שתוסיף כאן יופיע גם ברשימת האטרקציות ויישאר ניתן לעריכה.</small></div><div class="field-grid"><div class="field"><label for="scheduleStart">התחלה</label><input id="scheduleStart" type="time" required value="${escapeHTML(original.startTime)}"></div><div class="field"><label for="scheduleEnd">סיום</label><input id="scheduleEnd" type="time" required value="${escapeHTML(original.endTime)}"></div></div><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירת המקטע</button></form>`);
    $('#scheduleBlockForm').onsubmit=event=>{
      event.preventDefault();const schedule=structuredClone(trip.dailySchedule),editedDay=schedule.find(item=>item.date===day.date),block=editedDay?.blocks[index],start=minute($('#scheduleStart').value),end=minute($('#scheduleEnd').value),activity=$('#scheduleActivity').value.trim(),placeName=$('#schedulePlace').value.trim();
      if(!block||start===null||end===null||end<=start||!activity){$('#scheduleEditError').textContent='בדוק את הפעילות ואת שעות ההתחלה והסיום.';return;}
      const oldEnd=minute(block.endTime),delta=end-oldEnd;block.startTime=$('#scheduleStart').value;block.endTime=$('#scheduleEnd').value;block.activity=activity;block.placeName=placeName;
      if(index===0)editedDay.wakeTime=block.startTime;else editedDay.blocks[index-1].endTime=block.startTime;
      for(let i=index+1;i<editedDay.blocks.length;i++){const nextStart=minute(editedDay.blocks[i].startTime),nextEnd=minute(editedDay.blocks[i].endTime);editedDay.blocks[i].startTime=clock(nextStart+delta);editedDay.blocks[i].endTime=clock(nextEnd+delta);}
      editedDay.sleepTime=clock(minute(editedDay.sleepTime)+delta);
      const operations=[];
      if(original.existingStopId){
        if(!placeName){$('#scheduleEditError').textContent='כדי לשמור אטרקציה במסלול, צריך להשאיר לה שם מקום.';return;}
        const stop=trip.stops.find(item=>item.id===original.existingStopId);if(!stop){$('#scheduleEditError').textContent='לא מצאתי את התחנה הזו במסלול. עדכן את הלוח דרך הצ׳אט.';return;}
        block.existingStopId=stop.id;operations.push({type:'update',id:stop.id,name:placeName,date:day.date,time:block.startTime,duration:end-start,notes:activity});
      }else if(placeName){operations.push({type:'add',name:placeName,date:day.date,time:block.startTime,duration:end-start,notes:activity});}
      saveDay(trip,schedule,operations);
    };
  }
  function editDayTimes(trip,day){
    openModal(`<h2>שעת קימה ושינה</h2><form id="dayTimesForm"><div class="field-grid"><div class="field"><label for="dayWake">קימה</label><input id="dayWake" type="time" required value="${escapeHTML(day.wakeTime)}"></div><div class="field"><label for="daySleep">שינה</label><input id="daySleep" type="time" required value="${escapeHTML(day.sleepTime)}"></div></div><p id="scheduleEditError" role="alert"></p><button class="primary-btn">שמירה</button></form>`);
    $('#dayTimesForm').onsubmit=event=>{
      event.preventDefault();const schedule=structuredClone(trip.dailySchedule),editedDay=schedule.find(item=>item.date===day.date),wake=minute($('#dayWake').value),sleep=minute($('#daySleep').value),oldWake=minute(editedDay.wakeTime),oldSleep=minute(editedDay.sleepTime);
      if(wake===null||sleep===null||sleep<=wake){$('#scheduleEditError').textContent='שעת השינה חייבת להיות אחרי שעת הקימה.';return;}
      const shift=wake-oldWake;editedDay.wakeTime=clock(wake);for(const block of editedDay.blocks){block.startTime=clock(minute(block.startTime)+shift);block.endTime=clock(minute(block.endTime)+shift);}const last=editedDay.blocks.at(-1),lastEnd=minute(last.endTime),sleepDelta=sleep-(oldSleep+shift);last.endTime=clock(lastEnd+sleepDelta);editedDay.sleepTime=clock(sleep);
      saveDay(trip,schedule,[]);
    };
  }
})();
