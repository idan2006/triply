(function(root){
  function apply(trip,input){
    const proposal=Array.isArray(input)?{operations:input}:input||{};
    const operations=proposal.operations||[];
    if(!Array.isArray(operations)||operations.length>200)throw Error('מספר שינויים לא תקין');
    const nextTrip=structuredClone(trip),changes=[];
    const allowedTripFields=new Set(['city','start','end','people','currency','budgetPerPerson','hotel','travelType','activityTypes','travelDetails']);
    const requestedTripChanges=proposal.tripChanges||{};
    if(!requestedTripChanges||typeof requestedTripChanges!=='object'||Array.isArray(requestedTripChanges)||Object.keys(requestedTripChanges).some(key=>!allowedTripFields.has(key)))throw Error('ההצעה כוללת שינוי לא מוכר בפרטי הטיול');
    for(const [key,value] of Object.entries(requestedTripChanges)){
      if(key==='city'||key==='hotel'||key==='travelType'){
        const max=key==='city'?150:key==='hotel'?250:80;
        if(typeof value!=='string'||value.trim().length>max)throw Error('פרט הטיול שהוצע ארוך או לא תקין');
        nextTrip[key]=value.trim();
      }else if(key==='start'||key==='end'){
        if(typeof value!=='string')throw Error('תאריך הטיול שהוצע אינו תקין');
        nextTrip[key]=value;
      }else if(key==='people'){
        if(!Number.isInteger(value)||value<1||value>1000)throw Error('מספר המשתתפים שהוצע אינו תקין');
        nextTrip.people=value;
      }else if(key==='budgetPerPerson'){
        if(!Number.isFinite(value)||value<0||value>100000000)throw Error('התקציב שהוצע אינו תקין');
        nextTrip.budgetPerPerson=value;
      }else if(key==='currency'){
        if(!['ILS','GBP','USD','EUR'].includes(value))throw Error('המטבע שהוצע אינו נתמך');
        if(nextTrip.expenses?.length&&value!==trip.currency)throw Error('אי אפשר להחליף מטבע אחרי שנרשמו הוצאות.');
        nextTrip.currency=value;
      }else if(key==='activityTypes'){
        if(!Array.isArray(value)||value.length>12||value.some(item=>typeof item!=='string'||item.length>80))throw Error('העדפות הפעילות שהוצעו אינן תקינות');
        nextTrip.activityTypes=[...new Set(value.map(item=>item.trim()).filter(Boolean))];
      }else if(key==='travelDetails'){
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error('פרטי הטיסה שהוצעו אינם תקינים');
        const merged={...(nextTrip.travelDetails||{})};
        for(const field of Object.keys(value))if(!['arrival','departure','hotelCheckIn','hotelCheckOut','notes'].includes(field))throw Error('ההצעה כוללת שדה טיסה לא מוכר');
        for(const field of ['arrival','departure'])if(value[field]!==undefined){
          const item=value[field];if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(name=>!['date','time','airport'].includes(name)))throw Error('פרטי הנחיתה או ההמראה אינם תקינים');
          const date=String(item.date||'');if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('תאריך טיסה לא תקין');
          const time=String(item.time||'');if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('שעת טיסה לא תקינה');
          merged[field]={...(merged[field]||{}),...item};
        }
        for(const field of ['hotelCheckIn','hotelCheckOut'])if(value[field]!==undefined){if(value[field]&&!/^\d{4}-\d{2}-\d{2}$/.test(value[field]))throw Error('תאריך מלון לא תקין');merged[field]=value[field];}
        if(value.notes!==undefined){if(typeof value.notes!=='string'||value.notes.length>1000)throw Error('הערות הטיול ארוכות מדי');merged.notes=value.notes;}
        nextTrip.travelDetails=merged;
      }
      if(JSON.stringify(nextTrip[key])!==JSON.stringify(trip[key]))changes.push(`${({city:'יעד',start:'תאריך התחלה',end:'תאריך סיום',people:'מספר נוסעים',currency:'מטבע',budgetPerPerson:'תקציב ברירת מחדל',hotel:'מלון / נקודת יציאה',travelType:'סוג הטיול',activityTypes:'סגנון הפעילות',travelDetails:'פרטי טיסה ומלון'})[key]||key}: ${JSON.stringify(trip[key]??'')} ← ${JSON.stringify(nextTrip[key]??'')}`);
    }
    const people=Number(nextTrip.people),participants=Array.isArray(proposal.participants)?proposal.participants:structuredClone(trip.participants||[]);
    if(proposal.participants!==undefined&&(!Array.isArray(proposal.participants)||proposal.participants.length!==people))throw Error('ההצעה חייבת לכלול משתתף אחד לכל נוסע');
    if(participants.length!==people)throw Error('מספר הנוסעים השתנה בלי פירוט מלא של המשתתפים');
    const oldParticipantIds=new Set((trip.participants||[]).map(person=>String(person.id)));
    const seenParticipantIds=new Set();
    nextTrip.participants=participants.map((person,index)=>{
      if(!person||typeof person!=='object')throw Error('פרטי אחד המשתתפים אינם תקינים');
      const id=String(person.id||'');
      if(id&&!oldParticipantIds.has(id))throw Error('ההצעה ניסתה להוסיף משתתף ללא אישור מפורש');
      const stableId=id||crypto.randomUUID();if(seenParticipantIds.has(stableId))throw Error('מזהה משתתף כפול');seenParticipantIds.add(stableId);
      const name=String(person.name||'').trim(),budget=Number(person.budget);
      if(!name||name.length>80||!Number.isFinite(budget)||budget<0||budget>100000000)throw Error(`השם או התקציב של משתתף ${index+1} אינם תקינים`);
      return {id:stableId,name,budget};
    });
    if(requestedTripChanges.budgetPerPerson!==undefined&&proposal.participants===undefined)nextTrip.participants=nextTrip.participants.map(person=>({...person,budget:Number(requestedTripChanges.budgetPerPerson)}));
    if(nextTrip.people!==trip.people&&trip.expenses?.length)throw Error('אי אפשר לשנות מספר משתתפים אחרי שנרשמו הוצאות.');
    if(trip.expenses?.length&&JSON.stringify([...seenParticipantIds].sort())!==JSON.stringify([...oldParticipantIds].sort()))throw Error('אי אפשר להחליף משתתפים אחרי שנרשמו הוצאות.');
    nextTrip.budgetPerPerson=nextTrip.participants.length?Math.round(nextTrip.participants.reduce((sum,person)=>sum+person.budget,0)/nextTrip.participants.length*100)/100:0;
    for(const person of nextTrip.participants){const before=(trip.participants||[]).find(item=>item.id===person.id);if(!before)changes.push(`משתתף חדש: ${person.name} · תקציב ${person.budget} ${nextTrip.currency}`);else if(before.name!==person.name||Number(before.budget)!==person.budget)changes.push(`${before.name}: ${before.name!==person.name?`שם ${before.name} ← ${person.name}; `:''}${Number(before.budget)!==person.budget?`תקציב ${before.budget} ← ${person.budget} ${nextTrip.currency}`:''}`);}
    const dates=root.TripModel.dates(nextTrip.start,nextTrip.end);
    if(!nextTrip.city||nextTrip.city.length>150)throw Error('יעד הטיול אינו תקין');
    const stops=structuredClone(trip.stops||[]);
    for(const op of operations){
      if(!op||!['add','update','remove'].includes(op.type))throw Error('סוג שינוי לא מוכר');
      const index=stops.findIndex(s=>s.id===op.id);
      if(op.type!=='add'&&index<0)throw Error('התחנה שבהצעה אינה קיימת במסלול');
      if(op.type==='remove'){changes.push('הסרה: '+stops[index].name);stops.splice(index,1);continue;}
      const before=op.type==='update'?stops[index]:{};
      const next={...before,id:op.type==='add'?crypto.randomUUID():before.id,name:op.name??before.name,date:op.date??before.date,time:op.time??before.time,duration:op.duration??before.duration,notes:op.notes??before.notes??'',...(Number.isFinite(op.lat)&&Number.isFinite(op.lng)?{lat:op.lat,lng:op.lng}:{})};
      if(typeof next.name!=='string'||!next.name.trim()||next.name.length>200||typeof next.notes!=='string'||next.notes.length>3000)throw Error('שם או הערות לא תקינים בהצעה');
      if(op.type==='update'&&['name','date','time','duration','notes'].every(key=>next[key]===before[key]))continue;
      if(!dates.includes(next.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)||!Number.isInteger(next.duration)||next.duration<5||next.duration>1440)throw Error('ההצעה כוללת יום, שעה או משך ביקור לא תקינים');
      const minutes=Number(next.time.slice(0,2))*60+Number(next.time.slice(3));
      if(minutes+next.duration>1440)throw Error('הביקור המוצע חורג מעבר לחצות');
      const travel=nextTrip.travelDetails||{},arrival=travel.arrival||{},departure=travel.departure||{};
      if(arrival.date===next.date&&/^([01]\d|2[0-3]):[0-5]\d$/.test(arrival.time||'')){const landed=Number(arrival.time.slice(0,2))*60+Number(arrival.time.slice(3));if(minutes<landed+120)throw Error('ההצעה מתחילה מוקדם מדי ביום הנחיתה. השאירו לפחות שעתיים אחרי הנחיתה.');}
      if(departure.date===next.date&&/^([01]\d|2[0-3]):[0-5]\d$/.test(departure.time||'')){const flight=Number(departure.time.slice(0,2))*60+Number(departure.time.slice(3));if(minutes+next.duration>flight-180)throw Error('ההצעה קרובה מדי להמראה. השאירו לפחות שלוש שעות לפני הטיסה.');}
      if(op.type==='add')stops.push(next);else stops[index]=next;
      changes.push((op.type==='add'?'הוספה: ':'עדכון: ')+next.name+' · '+next.date+' בשעה '+next.time+' · '+next.duration+' דקות');
    }
    const expenseOperations=proposal.expenseOperations||[];
    if(!Array.isArray(expenseOperations)||expenseOperations.length>30)throw Error('מספר שינויי ההוצאות אינו תקין');
    const expenses=structuredClone(trip.expenses||[]),expenseChanges=[];
    for(const op of expenseOperations){
      if(!op||!['add','update','remove'].includes(op.type))throw Error('סוג שינוי הוצאה לא מוכר');
      const index=expenses.findIndex(item=>String(item.id)===String(op.id||''));
      if(op.type!=='add'&&index<0)throw Error('ההוצאה שבהצעה אינה קיימת');
      if(op.type==='remove'){expenseChanges.push(`מחיקת הוצאה · ${expenses[index].name}`);expenses.splice(index,1);continue;}
      const before=op.type==='update'?expenses[index]:{},name=String(op.name??before.name??'').trim(),amount=Number(op.amount??before.amount),shared=op.shared===undefined?(before.shared!==false):op.shared,personalParticipantId=shared?null:String(op.personalParticipantId??before.personalParticipantId??'');
      if(!name||name.length>200||!Number.isFinite(amount)||amount<=0||amount>100000000||typeof shared!=='boolean')throw Error('שם או סכום הוצאה לא תקינים');
      if(!shared&&!nextTrip.participants.some(person=>person.id===personalParticipantId))throw Error('בחר משתתף קיים להוצאה האישית');
      const cents=Math.round(amount*100),base=Math.floor(cents/nextTrip.participants.length),splits={};
      if(shared)nextTrip.participants.forEach((person,i)=>splits[person.id]=(base+(i<cents%nextTrip.participants.length?1:0))/100);else splits[personalParticipantId]=Math.round(amount*100)/100;
      const adjustedAmount=op.amount===undefined&&op.type==='update'?before.amount:Math.round(amount*100)/100;
      const next={...before,id:op.type==='add'?crypto.randomUUID():before.id,name,amount:adjustedAmount,shared,personalParticipantId,splits,originalAmount:op.amount===undefined&&op.type==='update'?(before.originalAmount??adjustedAmount):adjustedAmount,originalCurrency:op.amount===undefined&&op.type==='update'?(before.originalCurrency||nextTrip.currency):nextTrip.currency,rate:op.amount===undefined&&op.type==='update'?(before.rate??1):1,rateDate:op.amount===undefined&&op.type==='update'?(before.rateDate||''):new Date().toISOString().slice(0,10)};
      expenses[op.type==='add'?expenses.length:index]=next;
      expenseChanges.push(`${op.type==='add'?'הוספת':'עדכון'} הוצאה · ${name} · ${next.amount.toFixed(2)} ${nextTrip.currency}${shared?' · מתחלקת בין כולם':' · אישית ל'+nextTrip.participants.find(person=>person.id===personalParticipantId).name}`);
    }
    nextTrip.stops=stops;nextTrip.expenses=expenses;
    for(const stop of stops)if(!dates.includes(stop.date))throw Error('התאריכים החדשים אינם כוללים את כל התחנות שבטיול. בקש מהמתכנן להזיז אותן או עדכן אותן לפני אישור.');
    if(['city','start','end'].some(key=>requestedTripChanges[key]!==undefined&&requestedTripChanges[key]!==trip[key])){nextTrip.dailySchedule=[];nextTrip.scheduleStopSnapshot='';}
    else if(requestedTripChanges.hotel!==undefined||requestedTripChanges.travelDetails!==undefined)nextTrip.scheduleStopSnapshot='';
    const sorted=[...stops].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
    for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i];const start=s=>Number(s.time.slice(0,2))*60+Number(s.time.slice(3));if(a.date===b.date&&start(a)+a.duration>start(b))throw Error('ההצעה יוצרת חפיפה בין ביקורים. בקשו לתקן את שעות המסלול.');}
    return {stops,changes:[...changes,...expenseChanges],trip:nextTrip,expenseChanges};
  }
  function validateSchedule(trip,schedule){
    const dates=root.TripModel.dates(trip.start,trip.end);
    if(!Array.isArray(schedule)||schedule.length!==dates.length||schedule.length>14)throw Error('הלוח אינו מכסה את כל ימי הטיול');
    const minute=value=>{const match=typeof value==='string'&&value.match(/^([01]\d|2[0-3]):[0-5]\d$/);return match?Number(value.slice(0,2))*60+Number(value.slice(3)):null;};
    return dates.map(date=>{
      const day=schedule.find(item=>item?.date===date);
      if(!day||schedule.filter(item=>item?.date===date).length!==1||!Array.isArray(day.blocks)||day.blocks.length<2||day.blocks.length>60)throw Error('יום חסר או לא תקין בלוח');
      const wake=minute(day.wakeTime),sleep=minute(day.sleepTime);
      if(wake===null||sleep===null||sleep<=wake)throw Error('שעת קימה או שינה לא תקינה');
      let previous=wake;
      const blocks=day.blocks.map(block=>{
        const start=minute(block?.startTime),end=minute(block?.endTime),activity=String(block?.activity||'').trim();
        if(start!==previous||end===null||end<=start||end>sleep||!activity||activity.length>240)throw Error('נמצא פער או מקטע לא תקין בלוח');
        previous=end;
        return {startTime:block.startTime,endTime:block.endTime,activity,placeName:String(block.placeName||'').slice(0,160),existingStopId:String(block.existingStopId||'').slice(0,100)};
      });
      if(previous!==sleep)throw Error('הלוח אינו מגיע עד שעת השינה');
      return {date,wakeTime:day.wakeTime,sleepTime:day.sleepTime,blocks};
    });
  }
  function synchronizeScheduleStops(stops,schedule){
    const updates=[];
    for(const day of schedule||[])for(const block of day.blocks||[]){
      if(!block.existingStopId)continue;
      const stop=(stops||[]).find(item=>String(item.id)===String(block.existingStopId));if(!stop)continue;
      const duration=Number(block.endTime.slice(0,2))*60+Number(block.endTime.slice(3))-Number(block.startTime.slice(0,2))*60-Number(block.startTime.slice(3)),name=block.placeName||stop.name;
      if(stop.date!==day.date||stop.time!==block.startTime||Number(stop.duration)!==duration||stop.name!==name)
        updates.push({type:'update',id:stop.id,name,date:day.date,time:block.startTime,duration,notes:stop.notes||''});
    }
    return updates;
  }
  function recoverScheduleFromMessage(trip,message,operations=[]){
    if(typeof message!=='string'||!/(?:לוח זמנים מלא|לוח מלא|תוכנית יום מלאה)/i.test(message))return null;
    const dates=root.TripModel.dates(trip.start,trip.end),stops=Array.isArray(trip.stops)?trip.stops:[],ops=Array.isArray(operations)?operations:[],adds=ops.filter(op=>op?.type==='add'),removes=ops.filter(op=>op?.type==='remove');
    const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[’'`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const days=new Map(),usedStops=new Set(),usedAdds=new Set();let current=null;
    for(const raw of message.split(/\r?\n/)){
      const line=raw.trim();
      const header=line.match(/^(?:יום\s*\d+\s*[·•]\s*)?(\d{4}-\d{2}-\d{2})\s*[·•]\s*קימה\s*(\d{2}:\d{2})\s*[·•]\s*שינה\s*(\d{2}:\d{2})/);
      if(header){
        const [,date,wakeTime,sleepTime]=header;
        if(!dates.includes(date)||days.has(date))return null;
        current={date,wakeTime,sleepTime,blocks:[]};days.set(date,current);continue;
      }
      if(!current)continue;
      const block=line.match(/^(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})\s*[·•]\s*(.+)$/);
      if(!block)continue;
      const [,startTime,endTime,activity]=block,normalizedActivity=normalize(activity);
      const duration=Number(endTime.slice(0,2))*60+Number(endTime.slice(3))-Number(startTime.slice(0,2))*60-Number(startTime.slice(3));
      if(duration<=0||(![trip.travelDetails?.arrival?.date,trip.travelDetails?.departure?.date].includes(current.date)&&duration>180))return null;
      const matchingStops=stops.filter(stop=>{
        const name=normalize(stop?.name);return name&&normalizedActivity.includes(name);
      });
      if(matchingStops.length>1)return null;
      let placeName='',existingStopId='';
      if(matchingStops.length===1){
        const stop=matchingStops[0],id=String(stop.id||'');
        if(!id||usedStops.has(id))return null;
        usedStops.add(id);placeName=String(stop.name||'');existingStopId=id;
      }else{
        const matchingAdds=adds.map((op,index)=>({op,index})).filter(({op})=>op.date===current.date&&op.time===startTime&&normalize(op.name)&&normalizedActivity.includes(normalize(op.name)));
        if(matchingAdds.length>1)return null;
        if(matchingAdds.length===1){const found=matchingAdds[0];if(usedAdds.has(found.index))return null;usedAdds.add(found.index);placeName=String(found.op.name||'');}
        else if(/(?:ביקור\s+ב|אטרקציה\s*:|סיור\s+ב|ביקור\s+באטרקציה)/i.test(activity))return null;
      }
      current.blocks.push({startTime,endTime,activity:activity.trim(),placeName,existingStopId});
    }
    const removedIds=new Set(removes.map(op=>String(op.id||'')));
    if(removedIds.size!==removes.length||removes.some(op=>!stops.some(stop=>String(stop.id)===String(op.id))))return null;
    if(days.size!==dates.length||usedStops.size+removedIds.size!==stops.length||stops.some(stop=>usedStops.has(String(stop.id))===removedIds.has(String(stop.id)))||usedAdds.size!==adds.length)return null;
    const schedule=dates.map(date=>days.get(date));
    const flightDates=new Set([trip.travelDetails?.arrival?.date,trip.travelDetails?.departure?.date].filter(Boolean));
    for(const day of schedule){
      if(!flightDates.has(day.date)&&day.blocks.filter(block=>block.existingStopId||block.placeName).length<2)return null;
    }
    const recoveredOperations=[...removes];
    for(const day of schedule)for(const block of day.blocks){
      const duration=Number(block.endTime.slice(0,2))*60+Number(block.endTime.slice(3))-Number(block.startTime.slice(0,2))*60-Number(block.startTime.slice(3));
      if(block.existingStopId){
        const stop=stops.find(item=>String(item.id)===block.existingStopId);
        if(stop&&(stop.date!==day.date||stop.time!==block.startTime||Number(stop.duration)!==duration))recoveredOperations.push({type:'update',id:stop.id,name:stop.name,date:day.date,time:block.startTime,duration,notes:stop.notes||''});
      }else if(block.placeName){
        const add=adds.find(op=>op.date===day.date&&op.time===block.startTime&&normalize(op.name)===normalize(block.placeName));
        if(add)recoveredOperations.push(add);
      }
    }
    return {dailySchedule:schedule,operations:recoveredOperations};
  }
  root.TripPlanning={apply,validateSchedule,synchronizeScheduleStops,recoverScheduleFromMessage};if(typeof module!=='undefined')module.exports={apply,validateSchedule,synchronizeScheduleStops,recoverScheduleFromMessage};
})(globalThis);
