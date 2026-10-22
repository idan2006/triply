// Account & settings screens, AI usage, account deletion, legal links, and store-app (Capacitor) adaptations.
(function(){
  'use strict';
  const LEGAL='<p class="muted legal-links"><a href="./privacy.html" target="_blank" rel="noopener">מדיניות פרטיות</a> · <a href="./terms.html" target="_blank" rel="noopener">תנאי שימוש</a> · <a href="mailto:'+SUPPORT_EMAIL+'">יצירת קשר</a></p>';
  const backup=()=>downloadText('tropitrip-backup.json',JSON.stringify({version:2,trips:state.trips,preferences,savedPlaces},null,2));

  openSettings=function(){
    const hasLegacy=(()=>{try{return localStorage.getItem('triplyTrips')!==null;}catch{return false;}})();
    openModal(`<h2>הגדרות ונתונים</h2><p>הטיולים נשמרים בחשבון שלך ומסונכרנים בין המכשירים שבהם אתה מחובר.</p><button class="secondary-btn" id="settingsPreferences">העדפות תכנון</button><button class="secondary-btn" id="backupData">הורדת גיבוי טיולים</button><p class="muted">הגיבוי כולל את המסלולים וההוצאות של כל הטיולים.</p>${hasLegacy?'<button class="secondary-btn" id="legacyData">הורדת הנתונים מהגרסה הקודמת</button>':''}<button class="secondary-btn" id="accountSettings">החשבון שלי</button>${LEGAL}`);
    $('#settingsPreferences').onclick=openPreferences;
    $('#backupData').onclick=backup;
    if(hasLegacy)$('#legacyData').onclick=()=>{const old=localStorage.getItem('triplyTrips');if(old)downloadText('tropitrip-legacy.json',old);};
    $('#accountSettings').onclick=openAccount;
  };

  const usageLine=(label,u,unit)=>u?`<li><span>${label}</span><b>${Math.max(0,u.limit-u.used)} מתוך ${u.limit} ${unit}</b></li>`:'';
  async function loadUsage(){
    const box=$('#aiUsage');if(!box)return;
    try{
      const data=await aiCall('quota',{});
      if(!$('#aiUsage'))return;
      if(data.admin){box.innerHTML='<p class="muted">שימוש ב-AI: ללא הגבלה (מנהל).</p>';return;}
      const l=data.limits||{};
      box.innerHTML=`<h3>נשאר לך ב-AI</h3><ul class="usage-list">${usageLine('תכנון טיול מלא',l.plan,'החודש')}${usageLine('הודעות צ׳אט',l.chat,'היום')}${usageLine('סריקת מסמכים',l.scan,'היום')}</ul>`;
    }catch{box.innerHTML='';}
  }

  openAccount=function(){
    const user=window.triplyAuth?.getUser(),email=user?.email||'חשבון מחובר';
    openModal(`<h2>החשבון שלך</h2><p>מחובר כ־${escapeHTML(email)}.</p><p>הטיולים נשמרים בחשבון שלך ומסונכרנים בין כל המכשירים שבהם אתה מחובר. אפשר לשתף טיול עם חברים מלשונית "חברים" בתוך הטיול.</p><div id="aiUsage" class="usage-box"><p class="muted">בודק כמה נשאר לך ב-AI…</p></div><button class="secondary-btn" id="accountExport">הורדת גיבוי טיולים</button><button class="secondary-btn" id="accountSignOut">התנתקות</button><button class="danger-btn" id="accountDelete">מחיקת החשבון</button><p id="accountStatus" role="status"></p>${LEGAL}`);
    $('#accountExport').onclick=backup;
    $('#accountSignOut').onclick=async()=>{const button=$('#accountSignOut');button.disabled=true;$('#accountStatus').textContent='מתנתק…';await window.triplyAuth?.signOut();};
    $('#accountDelete').onclick=openDeleteAccount;
    void loadUsage();
  };

  function openDeleteAccount(){
    openModal(`<h2>מחיקת החשבון</h2><p>המחיקה סופית ואי אפשר לבטל אותה:</p><ul class="delete-list"><li>החשבון שלך יימחק.</li><li>כל הטיולים שיצרת יימחקו, גם אצל חברים ששיתפת איתם.</li><li>תצא מכל הטיולים שהוזמנת אליהם.</li></ul><p>כדאי להוריד קודם גיבוי. כדי לאשר, כתוב <b>מחק</b> בשדה:</p><form id="deleteForm"><div class="field"><label for="deleteConfirm">אישור</label><input id="deleteConfirm" required autocomplete="off"></div><p id="deleteStatus" role="status"></p><button class="danger-btn" id="deleteSubmit">מחיקת החשבון לצמיתות</button></form><button class="secondary-btn" id="deleteBackup">הורדת גיבוי קודם</button>`);
    $('#deleteBackup').onclick=backup;
    $('#deleteForm').onsubmit=async e=>{
      e.preventDefault();
      const status=$('#deleteStatus'),button=$('#deleteSubmit');
      if($('#deleteConfirm').value.trim()!=='מחק'){status.textContent='כדי למחוק, כתוב בדיוק: מחק';return;}
      button.disabled=true;status.textContent='מוחק…';
      const uid=window.triplyAuth?.getUser()?.id;
      try{
        await aiCall('account_delete',{confirm:'DELETE'});
        try{for(const k of Object.keys(localStorage))if(uid&&k.includes(uid))localStorage.removeItem(k);if(uid&&localStorage.getItem('triply:legacy-trip-owner')===uid)['triply:trips:v2','triply:legacy-trip-owner'].forEach(k=>localStorage.removeItem(k));}catch{}
        state.trips=[];
        await window.triplyAuth?.signOut();
        toast('החשבון נמחק');
      }catch(error){status.textContent=error.message||'המחיקה נכשלה. נסה שוב.';button.disabled=false;}
    };
  }

  $('#profileBtn').onclick=()=>openAccount();
  $('#newTripCta').onclick=()=>$('#newTripBtn').click();

  // ---- Store apps (Capacitor): files, links and sharing go through native plugins ----
  if(IS_NATIVE){
    const P={Filesystem:capPlugin('Filesystem'),Share:capPlugin('Share'),Browser:capPlugin('Browser')};
    downloadText=async function(name,content,type='application/json'){
      try{
        const r=await P.Filesystem.writeFile({path:name,data:content,directory:'CACHE',encoding:'utf8'});
        await P.Share.share({title:name,url:r.uri,dialogTitle:'שמירה או שליחה'});
      }catch(error){if(!/cancel/i.test(String(error?.message||'')))toast('לא הצלחתי לשמור את הקובץ');}
    };
    const open=url=>P.Browser.open({url:String(url)}).catch(()=>{});
    const originalOpen=window.open.bind(window);
    window.open=(url,target,features)=>{if(/^https?:/i.test(String(url||''))){void open(url);return null;}return originalOpen(url,target,features);};
    document.addEventListener('click',e=>{
      const a=e.target.closest?.('a[href]');
      if(!a)return;
      const href=a.getAttribute('href')||'';
      if(/^https?:/i.test(href)){e.preventDefault();void open(href);}
      else if(a.target==='_blank'&&/\.html(\?|#|$)/.test(href)){e.preventDefault();void open(new URL(href,WEB_APP_URL).toString());}
    },true);
  }
})();
