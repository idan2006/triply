'use strict';
const state={trips:[]};
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
let toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
function showView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===id));window.scrollTo({top:0,behavior:'smooth'});}
function save(){}
function renderTrips(){}
function renderStops(){}
function openModal(){}
function closeModal(){}
function newTrip(){}
$$('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$$('.quick').forEach(b=>b.onclick=()=>{$$('.quick').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});$$('.panel').forEach(p=>p.classList.toggle('active-panel',p.id===b.dataset.panel));});
$('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal();};
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>toast('שמירה לשימוש ללא אינטרנט אינה זמינה כרגע'));
