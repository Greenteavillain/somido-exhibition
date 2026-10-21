// 전시장 아이맥 원격 확인(작가 2026-10-21 "내가 실시간으로 지금 상황이 어떤지 볼 수 있는 기능… supabase 연동해서").
// 화면에 보이는 건 없음. 주소에 ?k=<비밀키>가 있을 때만(전시장 아이맥) 상태를 보고하고, ?mirror=<비밀키>일 때(작가 확인 페이지 안)는 그 상태를 따라간다.
// 쓰기·읽기 모두 Supabase 함수(somido_report / somido_watch)로만, 함수가 키를 대조한다(표는 RLS로 닫혀 있어 anon 키만으론 아무것도 못 함).
(()=>{
 const q=new URLSearchParams(location.search);const KEY=q.get('k'),MIRROR=q.get('mirror');if(!KEY&&!MIRROR)return;
 const BASE='https://ihecmsgxpfdiizlkdylv.supabase.co/rest/v1/rpc/';
 const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloZWNtc2d4cGZkaWl6bGtkeWx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NDQxNTUsImV4cCI6MjA5MzAyMDE1NX0.yKOehtOFcr7IRpDFsKmiRJFB63QsAxk1NU258EKfr0s';
 const rpc=(fn,body)=>fetch(BASE+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON,Authorization:'Bearer '+ANON},body:JSON.stringify(body),keepalive:true}).then(r=>r.ok?r.json():undefined).catch(()=>undefined);
 window.somidoRpc=rpc;
 if(KEY){ // ── 보고(키오스크) ──
  const startedAt=new Date().toISOString();let last=null,queue=[],lastSent=0,busy=false;
  const tick=async force=>{if(busy||!window.somidoSnapshot)return;const s=window.somidoSnapshot();if(!s)return;
   if(last&&s.pinned!==last.pinned)queue.push({type:s.pinned?(s.pinned[0]==='q'?'cut':'page'):'unpin',pid:s.pid,cut:s.cut,page:s.page});
   const moved=!last||Math.abs(s.cam.x-last.cam.x)>1||Math.abs(s.cam.y-last.cam.y)>1||Math.abs(s.cam.scale-last.cam.scale)>1e-3;
   last=s;const now=Date.now();if(!(force||queue.length||moved||now-lastSent>15000))return;
   busy=true;lastSent=now;const ev=queue.splice(0,50);
   const ok=await rpc('somido_report',{k:KEY,s:{...s,startedAt,fullscreen:!!document.fullscreenElement,vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio},ev});
   if(ok===undefined)queue.unshift(...ev); // 네트워크 실패면 다음에 다시
   busy=false;};
  setInterval(()=>tick(false),2000);setTimeout(()=>tick(true),1500);
  document.addEventListener('visibilitychange',()=>tick(true));window.addEventListener('pagehide',()=>tick(true));
 }
 if(MIRROR){ // ── 따라가기(작가 확인 페이지의 iframe) ──
  document.documentElement.dataset.mirror='1';
  const poll=async()=>{const r=await rpc('somido_watch',{k:MIRROR});if(r&&r.state&&window.somidoApply)window.somidoApply(r.state);if(window.parent!==window)try{window.parent.postMessage({somidoWatch:r===undefined?null:r},'*');}catch(e){}};
  setInterval(poll,3000);setTimeout(poll,800);
 }
})();
