// 전시장 아이맥 원격 확인(작가 2026-10-21 "내가 실시간으로 지금 상황이 어떤지 볼 수 있는 기능… supabase 연동해서").
// 화면에 보이는 건 없음. 사이트를 연 창은 전부(키 없이) 기기 id로 상태를 보고하고, 작가 확인 페이지(monitor.html, 키 필요)가 그중 전시장을 고른다
// ('전시장'이라 표시한 기기 > 전체화면 > 화면 큰 것 > 최근 것). 작가 10-21 "처음 한 번 키로 여는 번거로운 과정 없이 그냥 되게" — 그래서 전시장 쪽엔 아무 설정도 없다.
// ?mirror=<키>로 열린 창(확인 페이지 안)은 보고하지 않고 전시장 상태를 따라가기만 한다. 표는 RLS로 닫혀 있고 함수로만 쓰고 읽는다.
(()=>{
 const q=new URLSearchParams(location.search);const MIRROR=q.get('mirror');
 const BASE='https://ihecmsgxpfdiizlkdylv.supabase.co/rest/v1/rpc/';
 const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloZWNtc2d4cGZkaWl6bGtkeWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDQxNTUsImV4cCI6MjA5MzAyMDE1NX0.yKOehtOFcr7IRpDFsKmiRJFB63QsAxk1NU258EKfr0s';
 const rpc=(fn,body)=>fetch(BASE+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON,Authorization:'Bearer '+ANON},body:JSON.stringify(body),keepalive:true}).then(r=>r.ok?r.json():undefined).catch(()=>undefined);
 window.somidoRpc=rpc;
 if(!MIRROR){ // ── 보고 ──
  let DEV=null;try{DEV=localStorage.getItem('somido-device');if(!DEV){DEV=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));localStorage.setItem('somido-device',DEV);}}catch(e){DEV='s-'+Math.random().toString(36).slice(2)+Date.now().toString(36);}
  window.somidoDevice=DEV;
  const startedAt=new Date().toISOString();let last=null,queue=[],lastSent=0,busy=false;
  const tick=async force=>{if(busy||!window.somidoSnapshot)return;const s=window.somidoSnapshot();if(!s)return;
   if(last&&s.pinned!==last.pinned)queue.push({type:s.pinned?(s.pinned[0]==='q'?'cut':'page'):'unpin',pid:s.pid,cut:s.cut,page:s.page});
   const moved=!last||Math.abs(s.cam.x-last.cam.x)>1||Math.abs(s.cam.y-last.cam.y)>1||Math.abs(s.cam.scale-last.cam.scale)>1e-3;
   last=s;const now=Date.now();if(!(force||queue.length||moved||now-lastSent>15000))return;
   busy=true;lastSent=now;const ev=queue.splice(0,50);
   const ok=await rpc('somido_report',{d:DEV,s:{...s,startedAt,fullscreen:!!document.fullscreenElement,vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints>0,ua:navigator.userAgent.slice(0,120)},ev});
   if(ok===undefined)queue.unshift(...ev); // 네트워크 실패면 다음에 다시
   busy=false;};
  setInterval(()=>tick(false),2000);setTimeout(()=>tick(true),1500);
  document.addEventListener('visibilitychange',()=>tick(true));window.addEventListener('pagehide',()=>tick(true));
  document.addEventListener('fullscreenchange',()=>tick(true));
 } else { // ── 따라가기(작가 확인 페이지의 iframe) ──
  document.documentElement.dataset.mirror='1';
  const poll=async()=>{const r=await rpc('somido_watch',{k:MIRROR});if(r&&r.chosen&&r.chosen.state&&window.somidoApply)window.somidoApply(r.chosen.state);if(window.parent!==window)try{window.parent.postMessage({somidoWatch:r===undefined?null:r},'*');}catch(e){}};
  setInterval(poll,3000);setTimeout(poll,800);
 }
})();
