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
    section.setAttribute('aria-label','לוח היום');
    const norm=v=>String(v||'').trim().toLocaleLowerCase();
    const dayStops=trip.stops.filter(stop=>stop.date===day.date);
    const linked=new Set();
    const stopFor=block=>{if(!block.placeName)return null;const byId=block.existingStopId&&dayStops.find(stop=>stop.id===block.existingStopId);const hit=byId||dayStops.find(stop=>norm(stop.name)===norm(block.placeName)&&stop.time===block.startTime)||dayStops.find(stop=>norm(stop.name)===norm(block.placeName));if(hit)linked.add(hit.id);return hit||null;};
    const kind=block=>block.placeName?'sb-place':/^הליכה|\(הליכה/.test(block.activity)?'sb-walk':/תחבורה|מונית|שדה התעופה|נסיעה/.test(block.activity)?'sb-ride':/ארוחת|צהריים|קפה/.test(block.activity)?'sb-meal':'';
    const roles=window.TriplyDayLayout.roles(day);
    const grip='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    const rows=day.blocks.map((block,index)=>{const stop=stopFor(block);const movable=roles[index]==='move';return `<li class="schedule-block ${kind(block)}${movable?' sb-movable':''}" data-idx="${index}" data-role="${roles[index]}">${movable?`<button type="button" class="sb-handle" data-drag="${index}" aria-label="גרירה של ${escapeHTML(block.activity)} — אפשר גם עם החצים למעלה ולמטה">${grip}</button>`:''}<button type="button" class="sb-row" ${stop?`data-edit-stop-row="${escapeHTML(stop.id)}"`:`data-edit-schedule="${index}"`} aria-label="עריכה: ${escapeHTML(block.activity)}"><time>${escapeHTML(block.startTime)}</time><span class="sb-text"><strong>${escapeHTML(block.activity)}</strong>${block.placeName&&!block.activity.includes(block.placeName)?`<small>${escapeHTML(block.placeName)}</small>`:''}</span><span class="sb-end">עד ${escapeHTML(block.endTime)}</span></button></li>`;}).join('');
    section.innerHTML=`<div class="full-day-heading"><h4>לוח היום</h4><button type="button" class="text-btn" id="editDayTimes">קימה ${escapeHTML(day.wakeTime)} · שינה ${escapeHTML(day.sleepTime)} · שינוי</button></div>
      ${stale?'<p class="schedule-warning">שינית אטרקציות אחרי שהלוח נבנה. לחץ על "תכנן לי את כל הטיול" כדי לבנות אותו מחדש.</p>':''}
      <ol class="schedule-blocks">${rows}</ol>
      <p class="schedule-caveat">גוררים שורה בעזרת הנקודות שבצד כדי להקדים או לאחר אותה, או אל יום אחר בשורת הימים. לחיצה על שורה פותחת עריכה. זמני הליכה ושעות פתיחה הם הערכה.</p>`;
    section.querySelector('#editDayTimes').onclick=()=>editDayTimes(trip,day);
    section.querySelectorAll('[data-edit-schedule]').forEach(button=>button.onclick=()=>editScheduleBlock(trip,day,Number(button.dataset.editSchedule)));
    section.querySelectorAll('[data-edit-stop-row]').forEach(button=>button.onclick=()=>(window.editStop||editStop)(button.dataset.editStopRow));
    // Attractions already shown in the timeline are not listed a second time.
    list.querySelectorAll('.stop').forEach(row=>{const id=row.querySelector('[data-edit-stop]')?.dataset.editStop;if(id&&linked.has(id))row.remove();});
    const extra=list.querySelectorAll('.stop').length;
    if(extra)section.insertAdjacentHTML('beforeend','<h4 class="scheduled-stops-heading">נוספו אחרי שהלוח נבנה</h4>');
    list.querySelector('.empty-state')?.remove();
    list.prepend(section);
    enableDrag(section,trip,day);
  };

  /* ---------- Drag & drop inside the day (and onto another day) ---------- */
  function layoutContext(trip){
    const lp=trip.travelDetails?.lodgingPoint;
    const home=lp&&Number.isFinite(lp.lat)?lp:null;
    const n=v=>String(v||'').trim().toLocaleLowerCase();
    const pointOf=b=>{const st=trip.stops.find(s=>s.id===b.existingStopId)||trip.stops.find(s=>n(s.name)===n(b.placeName));return st&&Number.isFinite(st.lat)&&Number.isFinite(st.lng)?{lat:st.lat,lng:st.lng}:null;};
    return {home,pointOf,openOf:b=>window.TriplyDayLayout.openOf(b,trip.stops)};
  }
  function linkStops(trip,day){
    const n=v=>String(v||'').trim().toLocaleLowerCase();
    for(const b of day.blocks)if(b.placeName&&!b.existingStopId){const st=trip.stops.find(s=>s.date===day.date&&n(s.name)===n(b.placeName));if(st)b.existingStopId=st.id;}
  }
  function commitDays(trip,changed,note){
    const L=window.TriplyDayLayout;
    const schedule=trip.dailySchedule.map(d=>changed[d.date]||d);
    const warn=Object.values(changed).flatMap(d=>L.hourWarnings(d,trip.stops));
    saveDay(trip,schedule,[]);
    if(warn.length)setTimeout(()=>toast(`${note} · שים לב: ${warn[0]}`),60);else if(note)setTimeout(()=>toast(note),60);
  }
  function moveWithinDay(trip,day,fromIdx,toBeforeIdx){
    const L=window.TriplyDayLayout,roles=L.roles(day);
    const d=structuredClone(day);linkStops(trip,d);
    const order=d.blocks.map((_,i)=>i).filter(i=>roles[i]!=='travel'&&i!==fromIdx);
    let at=toBeforeIdx===null?order.length:order.indexOf(toBeforeIdx);
    if(at<0)at=order.length;
    order.splice(at,0,fromIdx);
    const res=L.relayout(d,order,{...layoutContext(trip),pinned:fromIdx});
    if(!res.ok){toast(res.message);renderStops();return false;}
    const moved=res.day.blocks.find(b=>b.activity===d.blocks[fromIdx].activity);
    commitDays(trip,{[day.date]:res.day},moved?`${d.blocks[fromIdx].activity.replace(/^ביקור:\s*/,'')} עבר ל-${moved.startTime}`:'הלוח עודכן');
    return true;
  }
  function moveToDay(trip,day,fromIdx,targetDate){
    const L=window.TriplyDayLayout;
    const src=structuredClone(day);linkStops(trip,src);
    const block=src.blocks[fromIdx];
    const target=trip.dailySchedule.find(x=>x.date===targetDate);
    if(!target){toast('ליום הזה עוד אין לוח. בנה אותו קודם עם "תכנן לי את כל הטיול".');return false;}
    const sr=L.roles(src);
    const srcOrder=src.blocks.map((_,i)=>i).filter(i=>sr[i]!=='travel'&&i!==fromIdx);
    const a=L.relayout(src,srcOrder,layoutContext(trip));
    const t=structuredClone(target);linkStops(trip,t);
    const tr=L.roles(t);
    t.blocks.push({...block});
    const newIdx=t.blocks.length-1;
    const tOrder=t.blocks.map((_,i)=>i).filter(i=>i!==newIdx&&tr[i]!=='travel');
    let lastMove=-1;tOrder.forEach((i,k)=>{if(tr[i]==='move')lastMove=k;});
    tOrder.splice(lastMove+1,0,newIdx);
    const b=L.relayout(t,tOrder,layoutContext(trip));
    if(!a.ok||!b.ok){toast((b.ok?a:b).message);renderStops();return false;}
    selectedDate=targetDate;
    commitDays(trip,{[day.date]:a.day,[targetDate]:b.day},`${block.activity.replace(/^ביקור:\s*/,'')} עבר ליום ${targetDate.slice(8)}/${targetDate.slice(5,7)}`);
    return true;
  }
  function enableDrag(section,trip,day){
    const list=section.querySelector('.schedule-blocks');
    section.querySelectorAll('[data-drag]').forEach(handle=>{
      const li=handle.closest('li');
      handle.addEventListener('keydown',e=>{
        if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
        e.preventDefault();
        const movable=[...list.querySelectorAll('li[data-role="move"]')];
        const i=movable.indexOf(li),j=e.key==='ArrowUp'?i-1:i+1;
        if(j<0||j>=movable.length)return;
        const from=+li.dataset.idx,target=e.key==='ArrowUp'?+movable[j].dataset.idx:(movable[j+1]?+movable[j+1].dataset.idx:null);
        if(moveWithinDay(trip,day,from,target))setTimeout(()=>{const again=[...document.querySelectorAll('.schedule-blocks li[data-role="move"]')][j];again?.querySelector('[data-drag]')?.focus();},80);
      });
      handle.addEventListener('pointerdown',e=>{
        if(e.button!==undefined&&e.button!==0)return;
        e.preventDefault();
        const pid=e.pointerId;
        const startY=e.clientY;
        let moved=false,dayTarget=null,raf=0,lastY=e.clientY,domShift=0;
        section.classList.add('sb-dragging');li.classList.add('sb-lifted');
        const autoscroll=()=>{const edge=70;const y=lastY;if(y<edge)window.scrollBy(0,-14);else if(y>innerHeight-edge)window.scrollBy(0,14);raf=requestAnimationFrame(autoscroll);};
        raf=requestAnimationFrame(autoscroll);
        const onMove=ev=>{
          if(ev.pointerId!==pid)return;
          ev.preventDefault();
          lastY=ev.clientY;
          if(Math.abs(ev.clientY-startY)>4)moved=true;
          li.style.transform=`translateY(${ev.clientY-startY-domShift}px)`;
          li.style.pointerEvents='none';
          const under=document.elementFromPoint(ev.clientX,ev.clientY);
          li.style.pointerEvents='';
          const pill=under?.closest?.('.day[data-date]');
          document.querySelectorAll('.day.sb-drop-day').forEach(x=>x.classList.remove('sb-drop-day'));
          dayTarget=null;
          if(pill&&pill.dataset.date!==day.date){pill.classList.add('sb-drop-day');dayTarget=pill.dataset.date;return;}
          const over=under?.closest?.('li[data-role="move"]');
          if(over&&over!==li&&list.contains(over)){
            const r=over.getBoundingClientRect(),before=ev.clientY<r.top+r.height/2;
            const base=li.offsetTop;
            list.insertBefore(li,before?over:over.nextSibling);
            // keep the lifted row under the finger after the DOM moved
            domShift+=li.offsetTop-base;
            li.style.transform=`translateY(${ev.clientY-startY-domShift}px)`;
          }
        };
        const onUp=ev=>{
          if(ev&&ev.pointerId!==pid)return;
          cancelAnimationFrame(raf);
          window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',onUp);window.removeEventListener('pointercancel',onUp);
          section.classList.remove('sb-dragging');li.classList.remove('sb-lifted');li.style.transform='';
          document.querySelectorAll('.day.sb-drop-day').forEach(x=>x.classList.remove('sb-drop-day'));
          if(!moved)return;
          const from=+li.dataset.idx;
          if(dayTarget){moveToDay(trip,day,from,dayTarget);return;}
          const seq=[...list.querySelectorAll('li[data-role="move"]')];
          const k=seq.indexOf(li);
          const originalMovable=day.blocks.map((_,i)=>i).filter(i=>window.TriplyDayLayout.roles(day)[i]==='move');
          const newOrder=seq.map(x=>+x.dataset.idx);
          if(newOrder.join()===originalMovable.join()){renderStops();return;}
          const next=seq[k+1]?+seq[k+1].dataset.idx:null;
          moveWithinDay(trip,day,from,next);
        };
        window.addEventListener('pointermove',onMove,{passive:false});window.addEventListener('pointerup',onUp);window.addEventListener('pointercancel',onUp);
      });
    });
  }

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
