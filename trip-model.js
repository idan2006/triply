(function(root){
  'use strict';
  function dates(start,end){
    const a=Date.parse(start+'T00:00:00Z'),b=Date.parse(end+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(a)||!Number.isFinite(b)||b<a) throw Error('יש לבחור טווח תאריכים תקין');
    if(new Date(a).toISOString().slice(0,10)!==start||new Date(b).toISOString().slice(0,10)!==end) throw Error('תאריך לא תקין');
    if((b-a)/86400000>365) throw Error('אפשר לתכנן עד 366 ימים בטיול אחד');
    return Array.from({length:(b-a)/86400000+1},(_,i)=>new Date(a+i*86400000).toISOString().slice(0,10));
  }
  // Shared trips can be edited by other people, so every field is normalized here before any screen shows it.
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/, CURRENCIES=['ILS','GBP','USD','EUR'];
  const text=(v,n)=>String(v??'').slice(0,n);
  const clamp=(v,min,max,dflt)=>{const x=Number(v);return Number.isFinite(x)?Math.min(max,Math.max(min,x)):dflt;};
  const hhmm=v=>{const m=String(v??'').match(/^(\d{1,2}):(\d{2})$/);return m&&+m[1]<24&&+m[2]<60?m[1].padStart(2,'0')+':'+m[2]:'09:00';};
  function stop(s){return {...s,id:text(s.id||crypto.randomUUID(),80),name:text(s.name,200),date:DATE_RE.test(s.date)?s.date:'',time:hhmm(s.time),duration:Math.round(clamp(s.duration,5,1440,60)),notes:text(s.notes,3000)};}
  function trip(input){
    const city=String(input.city||'').trim().slice(0,150), people=Number(input.people);
    if(!city)throw Error('יש למלא יעד');
    if(!Number.isInteger(people)||people<1||people>1000)throw Error('מספר הנוסעים חייב להיות מספר שלם בין 1 ל־1000');
    dates(input.start,input.end);
    const budgetPerPerson=Number(input.budgetPerPerson||0);
    if(!Number.isFinite(budgetPerPerson)||budgetPerPerson<0||budgetPerPerson>100000000)throw Error('תקציב לא תקין');
    const participants=Array.isArray(input.participants)?input.participants.slice(0,people).map((p,i)=>{const budget=Number(p.budget??budgetPerPerson);if(!Number.isFinite(budget)||budget<0||budget>100000000)throw Error(`התקציב של משתתף ${i+1} אינו תקין`);return {id:String(p.id||crypto.randomUUID()),name:String(p.name||'').trim().slice(0,80)||`משתתף ${i+1}`,budget};}):[];
    while(participants.length<people)participants.push({id:crypto.randomUUID(),name:`משתתף ${participants.length+1}`,budget:budgetPerPerson});
    const expenses=(Array.isArray(input.expenses)?input.expenses:[]).map(e=>{const amount=Math.round(Number(e.amount||0)*100)/100;let splits=e.splits&&typeof e.splits==='object'?Object.fromEntries(Object.entries(e.splits).filter(([id,value])=>participants.some(p=>p.id===id)&&Number.isFinite(Number(value))&&Number(value)>=0).map(([id,value])=>[id,Math.round(Number(value)*100)/100])):null;if(!splits||!Object.keys(splits).length){splits={};if(e.shared!==false){const cents=Math.round(amount*100),base=Math.floor(cents/participants.length);participants.forEach((p,i)=>splits[p.id]=(base+(i<cents%participants.length?1:0))/100);}else{const participant=participants.find(p=>p.id===e.personalParticipantId)||participants[0];splits[participant.id]=amount;}}const extra={};if(e.rate!=null)extra.rate=clamp(e.rate,0,1e9,0);if(e.originalAmount!=null)extra.originalAmount=clamp(e.originalAmount,0,1e12,0);if(e.originalCurrency!=null)extra.originalCurrency=text(e.originalCurrency,8);if(e.rateDate!=null)extra.rateDate=text(e.rateDate,20);return {...e,...extra,id:text(e.id||crypto.randomUUID(),80),name:text(e.name,200),amount,shared:e.shared!==false,personalParticipantId:e.personalParticipantId?text(e.personalParticipantId,80):null,splits};});
    return {id:text(input.id||crypto.randomUUID(),80),city,start:input.start,end:input.end,people,currency:CURRENCIES.includes(input.currency)?input.currency:'GBP',budgetPerPerson,participants,stops:(Array.isArray(input.stops)?input.stops:[]).filter(s=>s&&typeof s==='object').slice(0,400).map(stop),dailySchedule:Array.isArray(input.dailySchedule)?input.dailySchedule:[],scheduleStopSnapshot:String(input.scheduleStopSnapshot||''),expenses,hotel:text(input.hotel,300),travelDetails:input.travelDetails&&typeof input.travelDetails==='object'?input.travelDetails:{},travelType:text(input.travelType,80),activityTypes:Array.isArray(input.activityTypes)?input.activityTypes.map(a=>text(a,60)).slice(0,20):[],chat:(Array.isArray(input.chat)?input.chat:[]).slice(-80),archived:input.archived===true};
  }
  function budgetSummary(trip){const participants=trip.participants.map(p=>{const spent=Math.round(trip.expenses.reduce((sum,e)=>sum+Number(e.splits?.[p.id]||0),0)*100)/100,budget=Number(p.budget||0);return {...p,spent,remaining:Math.round((budget-spent)*100)/100};});const totalBudget=Math.round(participants.reduce((sum,p)=>sum+p.budget,0)*100)/100,totalSpent=Math.round(participants.reduce((sum,p)=>sum+p.spent,0)*100)/100;return {participants,totalBudget,totalSpent,totalRemaining:Math.round((totalBudget-totalSpent)*100)/100};}
  const api={dates,trip,budgetSummary};root.TripModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
