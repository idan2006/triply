// Cloud save + sharing (Supabase table trip_docs, protected by Row Level Security).
// The device copy stays the working copy; this file keeps it in sync with the account.
(function(){
  'use strict';
  const URL_BASE='https://pjkvfcvqibwcxordyxfv.supabase.co/rest/v1';
  const KEY=typeof AUTH_PUBLIC_KEY==='string'?AUTH_PUBLIC_KEY:'';
  let uid=null,token=null,known={},timer=null,busy=false,again=false,available=true,started=false;
  const syncKey=()=>'triply:sync:'+uid;
  const hash=s=>{let h=5381;for(let i=0;i<s.length;i++)h=(h*33^s.charCodeAt(i))>>>0;return h.toString(36)+':'+s.length;};
  const tripHash=t=>hash(JSON.stringify(t));
  const loadKnown=()=>{try{known=JSON.parse(localStorage.getItem(syncKey())||'{}')||{};}catch{known={};}};
  const saveKnown=()=>{try{localStorage.setItem(syncKey(),JSON.stringify(known));}catch{}};
  const status=text=>{const el=$('#storageStatus');if(el)el.textContent=text;};
  async function session(){const s=await window.triplyAuth?.getSession?.();if(s?.access_token)token=s.access_token;return token;}
  async function api(path,{method='GET',body,prefer}={}){
    await session();
    const headers={apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'};
    if(prefer)headers.Prefer=prefer;
    const res=await fetch(URL_BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await res.text();let data=null;try{data=text?JSON.parse(text):null;}catch{}
    if(!res.ok){const err=Error(data?.message||data?.error||('HTTP '+res.status));err.status=res.status;err.code=data?.code;throw err;}
    return data;
  }
  const localSave=()=>{try{localStorage.setItem(storeKey,JSON.stringify(state.trips));}catch{}};

  async function pull(){
    const rows=await api('/trip_docs?select=id,data,updated_at,deleted,owner_id,share_code');
    const seen=new Set();let changed=false,notes=[];
    for(const row of rows||[]){
      seen.add(row.id);
      const i=state.trips.findIndex(t=>t.id===row.id),k=known[row.id];
      if(row.deleted){if(i>=0&&k){state.trips.splice(i,1);changed=true;notes.push('טיול נמחק ע״י הבעלים');}delete known[row.id];continue;}
      let remote;try{remote=TripModel.trip({...row.data,id:row.id});}catch{continue;}
      const owner=row.owner_id===uid;
      if(i<0){state.trips.push(remote);known[row.id]={at:row.updated_at,h:tripHash(remote),owner,code:row.share_code||''};changed=true;continue;}
      const local=state.trips[i];
      if(!k||row.updated_at!==k.at){
        const localEdited=k&&tripHash(local)!==k.h;
        if(!k&&tripHash(local)===tripHash(remote)){known[row.id]={at:row.updated_at,h:tripHash(remote),owner,code:row.share_code||''};continue;}
        if(localEdited||!k){ /* both sides changed: keep the newer cloud copy, it may come from a companion */ }
        state.trips[i]=remote;known[row.id]={at:row.updated_at,h:tripHash(remote),owner,code:row.share_code||''};changed=true;
        if(k)notes.push(`"${remote.city}" עודכן ממכשיר אחר`);
      }else{known[row.id].owner=owner;known[row.id].code=row.share_code||'';}
    }
    // Access removed (unshared) → drop the local copy that came from the cloud.
    for(const id of Object.keys(known))if(!seen.has(id)){const i=state.trips.findIndex(t=>t.id===id);if(i>=0&&!known[id].owner){state.trips.splice(i,1);changed=true;notes.push('שיתוף של טיול בוטל');}if(!known[id].owner||i<0)delete known[id];}
    saveKnown();
    if(changed){localSave();renderTrips();if(typeof activeId!=='undefined'&&activeId){if(currentTrip())renderTrip();else showView('homeView');}}
    if(notes.length)toast(notes[0]);
  }
  async function push(){
    for(const t of state.trips){
      const k=known[t.id],h=tripHash(t);
      if(k&&k.h===h)continue;
      if(k){const r=await api('/trip_docs?id=eq.'+encodeURIComponent(t.id),{method:'PATCH',body:{data:t,deleted:false},prefer:'return=representation'});
        if(Array.isArray(r)&&r[0])known[t.id]={...k,at:r[0].updated_at,h};else delete known[t.id];}
      else{try{const r=await api('/trip_docs',{method:'POST',body:{id:t.id,data:t},prefer:'return=representation'});known[t.id]={at:r?.[0]?.updated_at||'',h,owner:true,code:''};}
        catch(e){if(e.code==='23505'){const r=await api('/trip_docs?id=eq.'+encodeURIComponent(t.id),{method:'PATCH',body:{data:t,deleted:false},prefer:'return=representation'});if(r?.[0])known[t.id]={at:r[0].updated_at,h,owner:false,code:''};}else throw e;}}
      saveKnown();
    }
    const ids=new Set(state.trips.map(t=>t.id));
    for(const [id,k] of Object.entries(known))if(!ids.has(id)){
      if(k.owner)await api('/trip_docs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{deleted:true}});
      else await api('/trip_doc_members?trip_id=eq.'+encodeURIComponent(id)+'&user_id=eq.'+uid,{method:'DELETE'});
      delete known[id];saveKnown();
    }
  }
  async function sync(kind='both'){
    if(!uid||!available)return;
    if(busy){again=true;return;}
    busy=true;status('שומר בענן…');
    try{
      if(!navigator.onLine)throw Object.assign(Error('offline'),{offline:true});
      if(kind!=='push')await pull();
      await push();
      status('נשמר בענן');
      window.dispatchEvent(new CustomEvent('triply:cloud-ok'));
    }catch(e){
      if(e.status===404||e.code==='42P01'||e.code==='PGRST205'){available=false;status('שמירה במכשיר זה');}
      else status(e.offline||!navigator.onLine?'אין חיבור — יישמר כשיחזור':'השמירה בענן נכשלה, ננסה שוב');
    }finally{busy=false;if(again){again=false;setTimeout(()=>sync('push'),300);}}
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>sync('push'),1200);};

  // Every local save is also sent to the cloud (debounced).
  const prevSave=save;
  save=function(){const r=prevSave.apply(this,arguments);if(uid)schedule();return r;};

  async function joinPending(){
    let code=null;try{code=sessionStorage.getItem('triply:join');}catch{}
    if(!code||!uid)return;
    try{sessionStorage.removeItem('triply:join');}catch{}
    try{const id=await api('/rpc/triply_join',{method:'POST',body:{p_code:code}});await pull();if(id&&state.trips.some(t=>t.id===id)){selectTrip(id);toast('הצטרפת לטיול! עכשיו שניכם רואים ועורכים אותו.');}}
    catch(e){toast(/invite not found/.test(e.message)?'קישור ההזמנה לא תקף (אולי בוטל).':'לא הצלחתי להצטרף לטיול. נסה שוב.');}
  }
  try{const u=new URL(location.href),code=u.searchParams.get('join');if(code&&/^[A-Za-z0-9]{10,32}$/.test(code)){sessionStorage.setItem('triply:join',code);u.searchParams.delete('join');history.replaceState(null,'',u.pathname+u.search+u.hash);}}catch{}

  function start(user){
    if(!user?.id||uid===user.id)return;
    uid=user.id;available=true;loadKnown();
    sync().then(joinPending);
    if(!started){started=true;
      setInterval(()=>{if(!document.hidden)sync();},45000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
      window.addEventListener('online',()=>sync());
    }
  }
  const prevActivate=activateSession;
  activateSession=function(s){prevActivate.apply(this,arguments);start(s?.user);if(uid&&available)status('נשמר בענן');};
  if(typeof currentUser!=='undefined'&&currentUser)start(currentUser);

  // ---- Sharing panel ("חברים") ----
  const inviteLink=code=>{const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('join',code);return u.toString();};
  const newCode=()=>{const a=new Uint8Array(12);crypto.getRandomValues(a);return [...a].map(x=>'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%56]).join('');};
  async function renderMembers(){
    const panel=$('#membersPanel'),t=currentTrip();if(!panel||!t)return;
    if(!uid||!available){panel.innerHTML='<div class="empty-state"><h2>שיתוף הטיול</h2><p>כדי לשתף טיול צריך חיבור לאינטרנט וחשבון מחובר.</p></div>';return;}
    const k=known[t.id];
    if(!k){panel.innerHTML='<div class="share-card"><h2>שיתוף הטיול</h2><p>הטיול נשמר בענן עוד רגע, ואז אפשר יהיה להזמין חברים.</p></div>';sync('push').then(()=>{if(known[t.id])renderMembers();});return;}
    let members=[];try{members=await api('/trip_doc_members?trip_id=eq.'+encodeURIComponent(t.id)+'&select=user_id,email,joined_at')||[];}catch{}
    if(currentTrip()?.id!==t.id)return;
    const ownerRow=k.owner?`<li><span class="member-dot">${escapeHTML((currentUser?.email||'?').slice(0,1).toUpperCase())}</span><span>${escapeHTML(currentUser?.email||'')} (את/ה · בעלים)</span></li>`:'';
    const list=members.length||ownerRow?`<ul class="member-list">${ownerRow}${members.map(m=>`<li><span class="member-dot">${escapeHTML((m.email||'?').slice(0,1).toUpperCase())}</span><span>${escapeHTML(m.email||'חבר/ה')}${m.user_id===uid?' (את/ה)':''}</span>${k.owner?`<button type="button" class="text-btn" data-remove-member="${escapeHTML(m.user_id)}">הסרה</button>`:''}</li>`).join('')}</ul>`:'<p class="muted">עדיין אין חברים בטיול.</p>';
    if(k.owner){
      const link=k.code?inviteLink(k.code):'';
      panel.innerHTML=`<div class="share-card"><h2>שיתוף הטיול</h2><p>מי שמקבל את הקישור ומתחבר לחשבון יראה את הטיול ויוכל לערוך אותו איתך. כל שינוי מתעדכן אצל כולם.</p>
        ${link?`<div class="share-link"><input readonly value="${escapeHTML(link)}" aria-label="קישור הזמנה"><button type="button" class="primary-btn" id="shareInvite">שליחת הקישור</button></div><button type="button" class="text-btn" id="revokeInvite">ביטול הקישור (מי שכבר הצטרף נשאר)</button>`:'<button type="button" class="primary-btn" id="makeInvite">יצירת קישור הזמנה</button>'}
        <h3>מי בטיול</h3>${list}</div>`;
    }else{
      panel.innerHTML=`<div class="share-card"><h2>טיול משותף</h2><p>הוזמנת לטיול הזה. שינויים שלך מתעדכנים אצל כל המשתתפים.</p><h3>מי בטיול</h3>${list}<button type="button" class="secondary-btn" id="leaveTrip">יציאה מהטיול</button></div>`;
    }
    $('#makeInvite')?.addEventListener('click',async()=>{try{const code=newCode();await api('/trip_docs?id=eq.'+encodeURIComponent(t.id),{method:'PATCH',body:{share_code:code}});known[t.id].code=code;saveKnown();renderMembers();}catch{toast('לא הצלחתי ליצור קישור. נסה שוב.');}});
    $('#revokeInvite')?.addEventListener('click',async()=>{if(!confirm('לבטל את קישור ההזמנה? מי שכבר הצטרף יישאר בטיול.'))return;try{await api('/trip_docs?id=eq.'+encodeURIComponent(t.id),{method:'PATCH',body:{share_code:null}});known[t.id].code='';saveKnown();renderMembers();}catch{toast('הביטול נכשל');}});
    $('#shareInvite')?.addEventListener('click',async()=>{const link=inviteLink(known[t.id].code),text=`בוא/י להצטרף לטיול ${t.city} שלי ב-Triply`;if(navigator.share){try{await navigator.share({title:'Triply',text,url:link});return;}catch{}}try{await navigator.clipboard.writeText(link);toast('הקישור הועתק — אפשר להדביק בוואטסאפ');}catch{$('.share-link input')?.select();toast('סמן והעתק את הקישור');}});
    $$('[data-remove-member]').forEach(b=>b.onclick=async()=>{if(!confirm('להסיר את החבר/ה מהטיול?'))return;try{await api('/trip_doc_members?trip_id=eq.'+encodeURIComponent(t.id)+'&user_id=eq.'+b.dataset.removeMember,{method:'DELETE'});renderMembers();}catch{toast('ההסרה נכשלה');}});
    $('#leaveTrip')?.addEventListener('click',async()=>{if(!confirm('לצאת מהטיול? הוא יוסר מהרשימה שלך.'))return;state.trips=state.trips.filter(x=>x.id!==t.id);localSave();try{await api('/trip_doc_members?trip_id=eq.'+encodeURIComponent(t.id)+'&user_id=eq.'+uid,{method:'DELETE'});}catch{}delete known[t.id];saveKnown();renderTrips();showView('homeView');toast('יצאת מהטיול');});
  }
  $$('.quick[data-panel="membersPanel"]').forEach(b=>b.addEventListener('click',()=>void renderMembers()));
  window.addEventListener('triply:cloud-ok',()=>{const note=$('.auth-note');if(note)note.textContent='הטיולים נשמרים בחשבון שלך ומסונכרנים בין המכשירים.';});
  window.TriplyCloud={sync,renderMembers,get available(){return available;}};
})();
