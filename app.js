/* Local, source-backed comic atlas. No external requests or dependencies. */
(() => {
'use strict';
const B = window.SOMIDO;
if (!B) { document.querySelector('#main').innerHTML='<p class="no-data">자료 파일을 찾지 못했습니다. data/bundle.js를 함께 두고 열어 주세요.</p>'; return; }
const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const compact = (text, n=155) => String(text || '').replace(/\s+/g,' ').slice(0,n) + (String(text || '').length>n?'…':'');
const uid = prefix => prefix + '-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2));
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const TYPES = {diary:'당시 일기',floe:'구상 메모',claude_chat:'Claude와의 대화',planning_summary:'AI가 정리한 구성안',user_chat:'작가의 대화',codex_chat:'Codex와의 대화',audit_note:'자료 대조 메모',oral_recollection:'구술·회상',submitted_story:'보낸 사연',author_note:'작가의 제작 메모',ai_proposal:'AI의 제안',draft_script:'원고 초안',author_decision:'작가의 결정',postit:'작업 메모'};
const REL = {source_for:'창작에 반영',related_record:'대응하는 기록',adapted_from:'표현을 바꾸어 사용',visual_source:'그림으로 사용',planning:'구성에 관한 대화',recollection:'장면에 관한 회상',combined:'여러 기억을 합침',reordered:'배열을 바꿈',dialogue:'대사로 사용',reference:'참고한 기록',...B.relationLabels};
const state = {view:'book',spread:0,anchor:null,editing:false,candidates:true,sourceFocus:null,readerZoom:1,pair:'first-page-single',draw:false,draftRegions:[],showAllLinks:false};
let canvasController=null,canvasCamera=null,canvasResize=null,canvasFrame=0,canvasSelection=null,canvasSourceFit=null,canvasAnchorFit=null;
const pageById = new Map(B.book.pages.map(p=>[p.id,p]));
const emptyAuthor=()=>({schemaVersion:1,sources:[],anchors:[],sourcePatches:{},anchorPatches:{},bookHash:B.book.sourceHash});
const compatibleAuthor=v=>v.bookHash===B.book.sourceHash||(!v.bookHash&&!v.anchors?.length&&!Object.keys(v.anchorPatches||{}).length);
let author=clone(B.author), sources=[], anchors=[], sourceById, anchorById, spreads=[], serverRevision=null, api=false, saveChain=Promise.resolve(), restorePending=null;
const localKey='somido-all6-author-v1'; // all6: all4의 브라우저 임시 저장(옛 구술 장면 편집)이 섞이지 않게 키를 바꿈
const publicOverrides = new Map();
for (const a of B.anchors) for (const l of a.links) if(l.publicQuoteIsRedacted){const previous=publicOverrides.get(l.sourceId)||[];if(!previous.includes(l.publicQuote))previous.push(l.publicQuote);publicOverrides.set(l.sourceId,previous);}
function validLink(l){ return l.status !== 'rejected' && (state.candidates || l.status==='confirmed'); }
function visibleLinks(a){return (a.links||[]).filter(validLink);}
function visibleAnchors(){return anchors.filter(a=>!a.hidden && (state.editing || visibleLinks(a).length));}
function buildSpreads(){
 const ids=B.book.pages.map(p=>p.id); const out=[]; if(state.pair==='first-page-single')out.push({id:'s-first',pageIds:[ids.shift()]});
 while(ids.length)out.push({id:'s-'+ids[0],pageIds:ids.splice(0,2)});
 spreads=out; state.spread=Math.min(state.spread,out.length-1);
}
function rebuild(){
 const sm=new Map(B.sources.map(s=>[s.id,clone(s)]));for(const s of author.sources||[])sm.set(s.id,clone(s));
 for(const [id,patch] of Object.entries(author.sourcePatches||{}))if(sm.has(id))sm.set(id,{...sm.get(id),...patch,id});
 sources=[...sm.values()];sourceById=sm;
 const am=new Map(B.anchors.map(a=>[a.id,clone(a)]));for(const a of author.anchors||[])am.set(a.id,clone(a));
 for(const [id,patch]of Object.entries(author.anchorPatches||{}))if(am.has(id))am.set(id,{...am.get(id),...patch,id});
 anchors=[...am.values()].map(a=>({...a,regions:(a.regions||[]).map(r=>({...r,page:r.page||a.page}))}));anchorById=new Map(anchors.map(a=>[a.id,a]));
 buildSpreads();
}
function sourceText(s){return publicOverrides.has(s.id)?publicOverrides.get(s.id).join('\n\n'):(s.content||s.summary||'');}
function sourceTitle(s){return s?.title||'기록';}
function sourceStatus(s){return ({candidate:'확인이 필요한 자료',superseded:'이전 구상 · 이후 변경됨',rejected:'채택하지 않은 구상'})[s.status]||'';}
function sourceStatusHtml(s){return sourceStatus(s)?`<p class="source-status-note">${esc(sourceStatus(s))}</p>`:'';}
function anchorsForSource(id){return visibleAnchors().filter(a=>visibleLinks(a).some(l=>l.sourceId===id));}
function anchorsOnPages(ids){return visibleAnchors().filter(a=>a.regions.some(r=>ids.includes(r.page)));}
function statusLabel(l){return l.status==='confirmed'?(l.basis==='identical_image_verified'?'같은 원자료 확인':'연결 확인'):'연결 검토 중';}
function niceRelation(l){const v=REL[l.relation];return typeof v==='string'?v:(v?.label||l.relation||'관련 기록');}
function dateLabel(s){if(s.sourceType==='oral_recollection')return '구술 기록 '+(s.recordedAt||s.date||'');if(s.dateKind==='export')return '내보낸 날 '+(s.date||'');return s.dateLabel||s.date||'';}
function isCandidate(a){return visibleLinks(a).every(l=>l.status!=='confirmed');}
function getPageNumber(id){return pageById.get(id)?.number||0;}
function regionPageIds(a){return [...new Set(a.regions.map(r=>r.page))];}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('visible'),4000);}
function saveLocal(){try{localStorage.setItem(localKey,JSON.stringify({bundleRevision:B.revision,serverRevision,state:author}));}catch(e){toast('브라우저 임시 저장 공간이 부족합니다. 기록을 내보내 주세요.');}}
async function persist(){
 const snapshot=clone(author);saveLocal();$('#save-state').textContent=api?'저장 중…':'브라우저에 임시 저장';
 if(!api)return;
 saveChain=saveChain.then(async()=>{
  try{const r=await fetch('/api/exhibition/author',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:serverRevision,state:snapshot})});const d=await r.json();if(!r.ok)throw Error(d.error||'파일 저장에 실패했습니다.');serverRevision=d.revision;saveLocal();$('#save-state').textContent='파일에 저장됨';}
  catch(e){$('#save-state').textContent='임시 저장 · 내보내기 가능';toast(e.message);}
 });await saveChain;
}
function exportFile(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function exportAuthor(){exportFile({schemaVersion:1,bookHash:author.bookHash,bundleRevision:B.revision,exportedAt:new Date().toISOString(),state:author},'소미도_구술과장면연결_'+today()+'.json');}
async function init(){
 let pending,recoveredUnsaved=false;try{pending=JSON.parse(localStorage.getItem(localKey)||'null');const prefs=JSON.parse(localStorage.getItem('somido-exhibition-prefs')||'null');if(prefs){state.pair=prefs.pair||state.pair;}}catch(e){}
 if(location.protocol==='http:'||location.protocol==='https:'){
  // all6: 서버의 작가 기록(/api/exhibition/author = all4의 author.json, 옛 구술 장면 37개)을 합치지 않는다 — 벽 말풍선으로 바꾼 기록과 겹쳐 카드가 두 장씩 떴음. 정적 사이트(GitHub Pages)엔 서버도 없음.
  // try{const r=await fetch('/api/exhibition/author',{signal:AbortSignal.timeout(2500)});if(r.ok&&r.headers.get('content-type')?.includes('application/json')){const d=await r.json();author=d.state;serverRevision=d.revision;api=true;}}catch(e){}
 }
 if(!compatibleAuthor(author)){restorePending={state:clone(author),bookHash:author.bookHash};author=emptyAuthor();api=false;}
 if(pending?.state){
  if(api && pending.serverRevision===serverRevision && compatibleAuthor(pending.state)){recoveredUnsaved=JSON.stringify(pending.state)!==JSON.stringify(author);author=pending.state;}
  else if(!api && pending.bundleRevision===B.revision && compatibleAuthor(pending.state)){author=pending.state;}
  else if(JSON.stringify(pending.state)!==JSON.stringify(author)){restorePending=pending;}
 }
 author.bookHash ||= B.book.sourceHash;rebuild();route();$('#save-state').textContent=api?'로컬 파일 저장':'브라우저 임시 저장';
 if(restorePending)toast('이전 판본의 추가 기록이 남아 있습니다. 보는 방법에서 내보낼 수 있습니다.');
 else if(recoveredUnsaved&&api)await persist();
}
function navigate(view='book',index=0,anchor=null){
 state.showAllLinks=false;state.readerZoom=1;
 const hash=view==='reader'?'#page/'+spreads[index].pageIds[0]+(anchor?'/'+encodeURIComponent(anchor):''):'#book';
 if(location.hash===hash){state.view=view;state.spread=index;state.anchor=anchor;render();}else location.hash=hash;
}
function route(){
 const h=location.hash.split('/');state.draw=false;state.draftRegions=[];state.redrawId=null;state.showAllLinks=false;
 if(h[0]==='#page'&&pageById.has(h[1])){state.view='reader';state.spread=Math.max(0,spreads.findIndex(s=>s.pageIds.includes(h[1])));state.anchor=h[2]&&anchorById.has(decodeURIComponent(h[2]))?decodeURIComponent(h[2]):null;}
 else if(h[0]==='#anchor'&&anchorById.has(h[1])){const a=anchorById.get(h[1]);navigate('reader',spreads.findIndex(s=>s.pageIds.includes(a.regions[0].page)),a.id);return;}
 else{state.view='book';state.anchor=null;}
 render();
}
function goAnchor(id){
 const a=anchorById.get(id);if(!a)return;
 canvasSelection={pageId:a.regions[0].page};canvasAnchorFit=id;navigate('book');
}
function render(){
 if(canvasController){canvasCamera=canvasController.getCamera();canvasController.destroy();canvasController=null;}
 if(canvasResize){canvasResize.disconnect();canvasResize=null;}cancelAnimationFrame(canvasFrame);
 document.body.classList.toggle('canvas-mode',state.view==='book');
 document.body.classList.toggle('reading',state.view==='reader');document.body.classList.toggle('is-editing',state.editing);
 // 2026-10-03 작가 요청: 책 전체는 캔버스 하나만. 목록 보기와 '기록 살펴보기' 화면은 없앴다(기록은 컷을 눌러 나오는 카드와 기록 창으로 본다).
 if(state.view==='reader')renderReader();else renderCanvas();
}
function savePrefs(){try{localStorage.setItem('somido-exhibition-prefs',JSON.stringify({pair:state.pair}));}catch(e){}}
function renderCanvas(){
 // 2026-10-03 작가 요청: 펼침면이어도 페이지 사이 여백은 전부 같게. gap 하나가 가로·세로 간격을 모두 정한다.
 const pageW=240,pageH=pageW*1068/852,gap=24,rowH=pageH+gap;
 // 2026-10-03 작가 요청: 회차와 펼침면 구분 없이 212쪽을 책 순서대로 한 줄에 15쪽씩 규칙적으로 늘어놓는다.
 const PER_ROW=15,tiles=[];
 const focused=state.sourceFocus&&sourceById.get(state.sourceFocus);
 let world='';
 B.book.pages.forEach((p,i)=>{
  const x=(i%PER_ROW)*(pageW+gap),y=Math.floor(i/PER_ROW)*rowH;
  const on=anchorsOnPages([p.id]),matched=focused&&on.some(a=>visibleLinks(a).some(l=>l.sourceId===focused.id));
  tiles.push({x,y,width:pageW,height:pageH,index:i,pageIds:[p.id],matched});
  world+=`<div class="canvas-spread ${matched?'source-match':''}" data-canvas-spread="${i}" style="left:${x}px;top:${y}px;width:${pageW}px"><div class="canvas-pages" style="width:${pageW}px"><button class="canvas-page" data-canvas-page="${p.id}" aria-label="${p.number}쪽의 관련 기억 보기" aria-pressed="false"><img src="${esc(p.thumb)}" data-full="${esc(p.image)}" data-thumb="${esc(p.thumb)}" data-page="${p.id}" alt="${p.number}쪽${p.blank?' 여백':''}" width="240" height="301" draggable="false" decoding="async"><span class="canvas-page-regions">${canvasPageSvg(p,null)}</span></button></div></div>`;
 });
 const rows=Math.ceil(B.book.pages.length/PER_ROW);
 let bounds={x:0,y:0,width:PER_ROW*(pageW+gap)-gap,height:(rows-1)*rowH+pageH};
 $('#main').innerHTML=`<section class="canvas-shell">${focused?`<div class="canvas-source-focus"><span><b>${esc(sourceTitle(focused))}</b> · 연결된 위치</span><button id="canvas-clear-source">전체 기록으로</button></div>`:''}<div class="atlas-viewport" id="atlas-viewport" tabindex="0" role="region" aria-label="책 전체 캔버스"><div class="atlas-world" style="width:${bounds.width}px;height:${bounds.height}px">${world}<div class="canvas-memory-layer" aria-label="선택한 쪽의 관련 기억"></div></div></div></section>`;
 // 전부 펼친 버전: 모든 쪽의 기록 노드를 한꺼번에 깔고, 쪽 간격을 내용에 맞춰 넓힌다
 const grown=renderAllMemories(tiles);if(grown){bounds={x:0,y:0,width:grown.width,height:grown.height};const wn=$('.atlas-world');wn.style.width=grown.width+'px';wn.style.height=grown.height+'px';}
 const viewport=$('#atlas-viewport'),worldNode=$('.atlas-world');
 const tileNodes=tiles.map(t=>({...t,node:$('[data-canvas-spread="'+t.index+'"]'),images:$$('img',$('[data-canvas-spread="'+t.index+'"]'))}));
 const thumbW=B.book.pages[0]?.thumbWidth||240;let crispTimer=0;
 const update=camera=>{
  canvasCamera=camera;
  // 움직이는 동안만 will-change를 켜고, 멈추면 꺼서 현재 배율로 다시 그리게 한다(확대해도 또렷).
  worldNode.style.willChange='transform';clearTimeout(crispTimer);crispTimer=setTimeout(()=>{if(worldNode.isConnected)worldNode.style.willChange='auto';},160);
  cancelAnimationFrame(canvasFrame);canvasFrame=requestAnimationFrame(()=>{
   if(!viewport.isConnected)return;
   viewport.classList.toggle('atlas-overview',camera.scale<.24);
   // 썸네일(폭 thumbW px)이 실제 화면 픽셀보다 작아지는 순간부터 원본(852px)을 쓴다. 고정 배율 .58이던 것을 화면 밀도까지 반영하게 바꿈.
   const needFull=pageW*camera.scale*(window.devicePixelRatio||1)>thumbW*.9;
   for(const t of tileNodes){const o=t.node&&t.node._off,tx=t.x+(o?o.x:0),ty=t.y+(o?o.y:0); /* all4: 모여 온 쪽은 옮겨진 자리로 판단 */const visible=tx*camera.scale+camera.x<viewport.clientWidth+100&&(tx+t.width)*camera.scale+camera.x>-100&&ty*camera.scale+camera.y<viewport.clientHeight+100&&(ty+t.height)*camera.scale+camera.y>-100;for(const img of t.images){const src=visible&&(needFull||img.closest('.memory-selected'))?img.dataset.full:img.dataset.thumb;if(img.getAttribute('src')!==src)img.src=src;}}
  });
 };
 const initial=canvasCamera;
 canvasController=window.SomidoCanvas.create(viewport,{world:worldNode,onChange:update,initialCamera:initial||undefined,minScale:.008,maxScale:3});
 // 2026-10-13 검토: viewport 밖(위의 '연결된 위치' 막대)에서 핀치하면 브라우저가 페이지 전체를 확대했다. 거기선 막기만 한다(벽 안은 엔진이 처리).
 {const sh=$('.canvas-shell');sh.addEventListener('wheel',e=>{if((e.ctrlKey||e.metaKey)&&!viewport.contains(e.target))e.preventDefault();},{passive:false});
  for(const t of ['gesturestart','gesturechange'])sh.addEventListener(t,e=>{if(!viewport.contains(e.target))e.preventDefault();},{passive:false});}
 const fitAll=()=>canvasController.fit(bounds,70);
 // all6: 확인용 손잡이 — 콘솔에서 somidoFocusPage('p001', 배율)로 그 쪽 둘레를 화면에 맞춤(브라우저 도구가 모듈 변수에 못 닿아서)
 window.somidoFocusPage=(pid,scale=.8,pad=600)=>{const t=tileNodes.find(t=>t.pageIds.includes(pid));if(!t)return false;canvasController.focus({x:t.x-pad,y:t.y-pad/2,width:t.width+pad*2,height:t.height+pad},scale);return true;};
 // Set the full book as the keyboard reset target, then restore the current view.
 fitAll();
 if(initial)canvasController.setCamera(initial);
 else fitAll(); // 처음엔 벽 전체가 보이게
 if(focused&&canvasSourceFit===focused.id&&tiles.some(t=>t.matched)){
  const matched=tiles.filter(t=>t.matched),x=Math.min(...matched.map(t=>t.x)),y=Math.min(...matched.map(t=>t.y));
  const box={x:x-30,y:y-55,width:Math.max(...matched.map(t=>t.x+t.width))-x+60,height:Math.max(...matched.map(t=>t.y+t.height))-y+100};canvasController.focus(box,Math.max(.035,Math.min((viewport.clientWidth-160)/box.width,(viewport.clientHeight-160)/box.height)));canvasSourceFit=null;
 }
 if($('#canvas-clear-source'))$('#canvas-clear-source').onclick=()=>{state.sourceFocus=null;render();};
 $$('[data-canvas-page]').forEach(b=>b.onclick=e=>{
  if(e.defaultPrevented||e.button>0)return;e.stopPropagation();
  const id=b.dataset.canvasPage;
  // 편집 중(E)에는 쪽을 누르면 바로 영역·연결 편집 화면으로 간다(선택 막대의 편집 버튼을 없앴기 때문).
  if(state.editing){const hit=e.target.closest('[data-canvas-anchor]');const a=hit?anchorById.get(hit.dataset.canvasAnchor):anchorsOnPages([id])[0];navigate('reader',spreads.findIndex(s=>s.pageIds.includes(id)),a?.id||null);return;}
  // 2026-10-03 작가 요청: 쪽을 눌러도 카메라는 움직이지 않는다(보는 사람이 어지러움). 카드는 지금 보이는 자리에 그대로 뜬다.
  // 전부 펼친 버전: 노드는 이미 다 펼쳐져 있다. all3에서는 누르면 그 쪽의 선을 고정해서 보여 준다(다시 누름·여백 누름·Esc로 풀림).
  if(wallHover)wallHover.pin('p:'+id);
 });
 viewport.addEventListener('click',e=>{if(!e.defaultPrevented&&!e.target.closest('.canvas-page,.canvas-memory-layer'))clearCanvasSelection();});
 renderCanvasMemories();if(canvasAnchorFit){const a=anchorById.get(canvasAnchorFit);if(a)focusCanvasPage(a.regions[0].page);}canvasAnchorFit=null;
 let lastW=viewport.clientWidth,lastH=viewport.clientHeight;
 canvasResize=new ResizeObserver(()=>{if(!canvasController||!viewport.isConnected)return;const w=viewport.clientWidth,h=viewport.clientHeight,c=canvasController.getCamera();if(w!==lastW||h!==lastH){canvasController.setCamera({...c,x:c.x+(w-lastW)/2,y:c.y+(h-lastH)/2});lastW=w;lastH=h;}});canvasResize.observe(viewport);
}
// Source coordinates stay on the page; only card positions use screen pixels.
function canvasPageSvg(page,active){
 const ons=anchorsOnPages([page.id]),regs=active?.regions.filter(r=>r.page===page.id)||[];
 if(!ons.length&&!regs.length)return '';
 const attrs=r=>`x="${r.rect[0]*1000}" y="${r.rect[1]*1253.52}" width="${r.rect[2]*1000}" height="${r.rect[3]*1253.52}"`;
 const mask='canvas-mask-'+page.id;
 return `<svg viewBox="0 0 1000 1253.52" preserveAspectRatio="none" aria-hidden="true">${regs.length?`<defs><mask id="${mask}"><rect width="1000" height="1253.52" fill="white"/>${regs.map(r=>`<rect ${attrs(r)} fill="black"/>`).join('')}</mask></defs><rect width="1000" height="1253.52" fill="white" opacity=".88" mask="url(#${mask})"/>`:''}${ons.map(a=>a.regions.filter(r=>r.page===page.id).map(r=>`<rect ${attrs(r)} data-canvas-anchor="${esc(a.id)}" class="canvas-region-hit ${active&&(active.id==='*'||active.id===a.id)?'selected-outline':''} "/>${!active?`<circle cx="${(r.rect[0]+r.rect[2])*1000-12}" cy="${r.rect[1]*1253.52+14}" r="9" class="canvas-region-dot"/>`:''}`).join('')).join('')}</svg>`;
}
function clearCanvasSelection(){canvasSelection=null;if(wallHover)wallHover.pin(null);renderCanvasMemories();}
function focusCanvasPage(id){
 const page=$('[data-canvas-page="'+id+'"]');if(!page||!canvasController)return;
 const spread=page.closest('.canvas-spread'),viewport=$('#atlas-viewport');
 canvasController.focus({x:spread.offsetLeft+page.offsetLeft,y:spread.offsetTop,width:page.offsetWidth,height:page.offsetHeight},Math.min(1.65,(viewport.clientHeight-150)/page.offsetHeight,(viewport.clientWidth-80)/page.offsetWidth));
}
// 2026-10-03 작가 요청: 선택 막대(×·장면 확대·장면 고르기·넘기기)와 카드 안 스크롤을 없애고, 쪽에 걸린 기록을 전부 한꺼번에 띄운다.
// 카드는 화면이 아니라 캔버스 좌표에 놓여 만화와 함께 이동·확대된다. 그래서 화면 크기에 맞춰 잘라 넣거나 스크롤할 일이 없다.
// 2026-10-03 작가 요청: 장면 하나를 '오래된 기록 → … → 만화 컷'의 흐름으로 보여준다(Floe 판본별 수정 포함).
// 쪽을 누르면 장면마다 노드를 한 줄로 잇고, 노드 사이 화살표 위에 무엇이 바뀌었는지를 짧게 적는다.
// 순서는 anchor.lineage(작가·편집이 정한 순서)가 있으면 그것, 없으면 chainOrder(시간순). chains.py와 같은 규칙.
// 카드는 기록 전문을 보이고 만화에 쓰인 대목만 진하게. 판독 표기·원문 줄바꿈은 화면에서만 걷어낸다. 지명 등을 가린 기록은 가린 문장만.
const FLOE_VERSIONS=B.floeVersions||{};
const STAGE_RANK={diary:0,floe:1,claude_chat:2,oral_recollection:2,submitted_story:2,planning_summary:3,codex_chat:4,user_chat:5,author_note:5,ai_proposal:5,draft_script:5,author_decision:5,audit_note:6};/* 순서는 s.medium(재분류 전 '받아 적은 수단')을 먼저 본다 — 2026-10-04 재분류로 종류만 바뀌고 줄 순서는 그대로 */
const STAGE_FALLBACK={diary:'2021',user_chat:'2026-10',audit_note:'2026-10'};
function stageWhen(s){const t=s.medium||s.sourceType;if(t==='diary')return s.date||'2021';if(t==='floe')return String(s.firstSeenExport||s.date||'2026-06').slice(0,10);const d=String(s.recordedAt||s.date||'').split('~')[0];return d||STAGE_FALLBACK[t]||'2026-12';}
function versionOf(id){const [sid]=id.split('@');return (FLOE_VERSIONS[sid]?.versions||[]).find(v=>v.id===id)||null;}
function stageKey(id){const v=versionOf(id);if(v)return [v.exportedAt,STAGE_RANK.floe,id];const s=sourceById.get(id);const since=FLOE_VERSIONS[id]?.currentSinceAt;return [since||(s?stageWhen(s):'9999'),STAGE_RANK[s?.medium||s?.sourceType]??5,id];}
function chainOrder(ids){return [...ids].sort((a,b)=>{const x=stageKey(a),y=stageKey(b);for(let i=0;i<3;i++){if(x[i]<y[i])return -1;if(x[i]>y[i])return 1;}return 0;});}
function cleanSeg(t){return String(t||'').replace(/\{삽입:\s*([^}]*)\}/g,'$1').replace(/\[[^\]]*\]/g,'').replace(/\s*\n\s*/g,' ').replace(/[ \t]{2,}/g,' ');}
const shortDate=d=>{const m=String(d||'').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);return m?`${m[1]}.${+m[2]}${m[3]?'.'+(+m[3]):''}`:'';};
function stageDate(id){const v=versionOf(id);if(v)return shortDate(v.date)+' 판';const s=sourceById.get(id);if(!s)return '';if(s.sourceType==='floe'){const since=FLOE_VERSIONS[id]?.currentSince;return shortDate(since||s.firstSeenExport||s.date)+' 판';}if(s.sourceType==='diary')return shortDate(s.date)||s.dateLabel||'';return shortDate(String(s.recordedAt||s.date||'').split('~')[0]);}
function highlighted(raw,excerpts){
 const ranges=[];for(const ex of excerpts){if(!ex)continue;const i=raw.indexOf(ex);if(i>=0)ranges.push([i,i+ex.length]);}
 ranges.sort((x,y)=>x[0]-y[0]);const merged=[];for(const r of ranges){const m=merged[merged.length-1];if(m&&r[0]<=m[1])m[1]=Math.max(m[1],r[1]);else merged.push([...r]);}
 if(!merged.length)return `<span class="wall-hit">${esc(cleanSeg(raw).trim())}</span>`;
 let html='',pos=0;for(const [a,b] of merged){if(a>pos)html+=`<span class="wall-dim">${esc(cleanSeg(raw.slice(pos,a)))}</span>`;html+=`<span class="wall-hit">${esc(cleanSeg(raw.slice(a,b)))}</span>`;pos=b;}
 if(pos<raw.length)html+=`<span class="wall-dim">${esc(cleanSeg(raw.slice(pos)))}</span>`;return html;
}
// all6(2026-10-19 작가 "벽 출력물과 같은 모양"): 기록 종류마다 벽의 모양 — 일기 = 손글씨 SVG + 초록 둥근 형광펜(marks), 구술 = 작가 말풍선 틀(꼬리·R10·가린 글은 회색),
//   포스트잇 = 노란 손글씨 쪽지, 나머지(Floe 메모·대화·구성안·결정·초안) = 흰 메모 카드(글 전문, 만화에 쓰인 대목만 진하게 — all4 그대로).
//   가린 글 표시는 build_all6.py가 원문을 지운 채로 줌: '[■■■]' = 가린 글(글자 수만), '⟦대체어⟧' = 이름을 덮은 말, 포스트잇의 '{이름}' = 회색으로 덮음.
const CARD_W={diary:240,oral_recollection:260,submitted_story:260,postit:150};
function cardWidth(s){return CARD_W[s?.sourceType]||260;}
function bubbleHTML(t){return esc(t).replace(/⟦([^⟦⟧]*)⟧/g,'<span class="rep">$1</span>').replace(/\[(■+)\]/g,'<span class="cen">$1</span>').replace(/\{([^{}]+)\}/g,(m,g)=>`<span class="cen">${'■'.repeat(Math.max(2,g.length))}</span>`);}
function kindLabel(s){return (TYPES[s.sourceType]||'기록')+(s.sentTo?' · '+s.sentTo:s.heardBy?' · '+s.heardBy+'에게'+(s.heardByGuess?' (추정)':''):s.via?' · '+s.via+'에서':'');}
function stageCard(id,link){
 const v=versionOf(id);
 if(v)return `<article class="record-card wall-card memo-card"><div class="wall-body"><p class="excerpt" data-canvas-no-pan><span class="wall-hit">${esc(cleanSeg(v.text).trim())}</span></p><div class="wall-card-foot"><span class="source-kind">${esc(TYPES.floe)}</span><span class="wall-date">${esc(stageDate(id))}</span></div></div></article>`;
 const s=sourceById.get(id);if(!s)return '';
 if(s.sourceType==='diary'){ // 손글씨 SVG(글은 공개 파일에 없음) + 형광펜 상자(SVG 비율). 높이는 aspect로 미리 정해져 그림이 늦게 와도 배치가 안 흔들림
  const marks=(s.marks||[]).map(m=>`<i class="hl" title="${esc(m.reason||'')}" style="left:${(m.box[0]*100).toFixed(2)}%;top:${(m.box[1]*100).toFixed(2)}%;width:${(m.box[2]*100).toFixed(2)}%;height:${(m.box[3]*100).toFixed(2)}%"></i>`).join('');
  return `<article class="record-card wall-card diary-card"><div class="diary-wrap" style="aspect-ratio:1/${s.aspect||1.316}">${s.image?`<img src="${esc(s.image)}" alt="일기 ${esc(s.date||'')}" loading="lazy" decoding="async">`:''}${marks}</div><div class="wall-card-foot"><span class="source-kind">${esc(TYPES.diary)}</span><span class="wall-date">${esc(s.date||stageDate(id))}</span></div></article>`;}
 if(s.sourceType==='oral_recollection'||s.sourceType==='submitted_story'){ // 작가 말풍선 틀: 폭 고정, 글이 늘면 아래로, 꼬리는 왼쪽 아래(수직 → 사선)
  return `<article class="record-card wall-card bubble-card"><div class="bubble"><p class="excerpt" data-canvas-no-pan>${bubbleHTML(s.content||'')}</p><svg class="tail" viewBox="0 0 32 31" aria-hidden="true"><path class="fill" d="M0 0 L0 30.4 L31.3 0 Z"/><path class="line" d="M0.75 0 L0.75 29 L31 0.75"/></svg></div><div class="wall-card-foot"><span class="source-kind">${esc(kindLabel(s))}</span><span class="wall-date">${esc(stageDate(id))}</span></div></article>`;}
 if(s.sourceType==='postit')return `<article class="record-card wall-card postit-card"><p class="excerpt" data-canvas-no-pan>${bubbleHTML(s.content||'')}</p></article>`;
 const raw=sourceText(s);const ex=publicOverrides.has(s.id)?[]:[link?.sourceExcerpt,link?.publicQuote];
 return `<article class="record-card wall-card memo-card"><div class="wall-body"><p class="excerpt" data-canvas-no-pan>${highlighted(raw,ex.filter(Boolean))}</p><div class="wall-card-foot"><span class="source-kind">${esc(kindLabel(s))}</span><span class="wall-date">${esc(stageDate(id))}</span></div></div></article>`;
}
// 2026-10-03 작가 요청: 장면마다 '기억 줄'(일기 → Floe 회상 → 대본 초안·판본)과 '결정 줄'(제작 대화·구성 결정)을 나눠 그리고,
// 두 줄이 만화 컷에서 합쳐지게 한다(제작 대화가 초안이 바뀐 결과처럼 읽히지 않게).
// 데이터: anchor.lanes = {memory:[…], decision:[…], into:'comic'|기억 줄 노드 ID}. 없으면 지금까지처럼 한 줄(lineage 또는 시간순).
// 결정이 특정 초안을 고친 것이면 into = 그 초안 노드 → 결정 카드를 그 노드 바로 아래 두고 위로 들어가는 화살표.
function canvasPageChains(pageId){
 const out=[];
 for(const a of anchorsOnPages([pageId])){
  const links=visibleLinks(a).filter(l=>sourceById.has(l.sourceId));if(!links.length)continue;
  const linkBy=new Map(links.map(l=>[l.sourceId,l]));
  const ok=id=>versionOf(id)||linkBy.has(id);
  let mem,dec=[],into='comic';
  if(a.lanes){mem=(a.lanes.memory||[]).filter(ok);dec=(a.lanes.decision||[]).filter(ok);into=a.lanes.into||'comic';}
  else{mem=(a.lineage||[]).filter(ok);if(!a.lineage?.length){const withV=[];for(const l of links)withV.push(...(FLOE_VERSIONS[l.sourceId]?.versions||[]).map(v=>v.id),l.sourceId);mem=chainOrder(withV);}}
  for(const l of links)if(!mem.includes(l.sourceId)&&!dec.includes(l.sourceId))mem.push(l.sourceId);
  if(!mem.length){mem=dec;dec=[];into='comic';}
  if(into!=='comic'&&!mem.includes(into))into='comic';
  const regions=a.regions.filter(r=>r.page===pageId);
  const hops=a.lineageHops||{},st=id=>({id,link:linkBy.get(id.split('@')[0])});
  const mLast=mem[mem.length-1],dLast=dec[dec.length-1];
  out.push({anchor:a,regions,stages:mem.map(st),dstages:dec.map(st),into,hop:(x,y)=>hops[x+'>'+y]||'',
   lastHop:hops[mLast+'>comic']||linkBy.get(mLast)?.transform||'',
   dLastHop:dLast?(hops[dLast+'>'+into]||(into==='comic'?linkBy.get(dLast)?.transform:'')||''):''});
 }
 return out.sort((x,y)=>Math.min(1,...x.regions.map(r=>r.rect[1]+r.rect[3]/2))-Math.min(1,...y.regions.map(r=>r.rect[1]+r.rect[3]/2)));
}
// ===== 전부 펼친 버전(exhibition-all) =====
// 2026-10-03 작가 요청: 쪽을 누르지 않아도 모든 쪽의 설명 노드가 처음부터 한꺼번에 펼쳐진 벽. 큰 화면용.
// 같은 기록은 처음 나오는 쪽에 카드 하나만 두고, 뒤쪽에서 다시 쓰이면 그 카드에서 화살표만 더 나간다.
// 쪽마다 배치 규칙은 본 버전과 같다(짧으면 쪽 왼쪽에서 왼→오, 길면 쪽 위에서 위→아래, 결정 줄은 기억 줄 아래·왼쪽).
// 쪽 사이 간격은 가장 큰 쪽 영역에 맞춰 넓히고(15쪽 격자 유지), 다른 쪽 카드로 가는 화살표는 위쪽 빈 띠를 따라 돈다.
const ALL_MODE=true;
let wallHover=null;
let _wallHoverDoc=null; // all3: 쪽·카드 마우스 올림으로 선 보이기 / all4: 누르면 관련 노드가 모임(renderAllMemories가 채움)
// 카드 글 상자의 휠(2026-10-13). 휠이 '벽 이동'이 된 뒤로, 글이 넘치는 카드 위에서 쓸면 글 상자가 휠을 다 먹어서 벽이 안 움직였다
//   (좌우로 쓸면 아무것도 안 움직임 — 검토에서 확인). 이제 한 번의 쓸기(앞 이벤트와 0.2초 넘게 떨어지면 새 쓸기)의 첫 이벤트로 주인을 정하고
//   그 쓸기 동안 유지한다: 세로가 주된 방향이고, 그쪽으로 더 내릴/올릴 글이 있고, 글이 읽힐 배율(0.5 이상)일 때만 글, 아니면 벽.
//   이벤트마다 정하면 휘어진 쓸기·관성 끝에서 글과 벽이 번갈아 움직인다. 핀치(ctrl/⌘)는 늘 벽 확대로 보낸다.
function wheelToText(el){let owner=null,last=0;el.addEventListener('wheel',e=>{const now=performance.now();if(e.ctrlKey||e.metaKey){owner=null;last=now;return;}
 if(owner===null||now-last>200){const u=e.deltaMode===1?16:1,dx=Math.abs(e.deltaX*u),dy=e.deltaY*u,room=dy>0?el.scrollTop+el.clientHeight<el.scrollHeight-1:dy<0?el.scrollTop>0:false,sc=canvasController?canvasController.getCamera().scale:1;owner=Math.abs(dy)>dx&&room&&sc>=.5?'text':'wall';}
 last=now;if(owner==='text')e.stopPropagation();},{passive:true});}
// 벽 화살표 길찾기 실행(2026-10-13). 첫 그림을 막지 않게 늘 비동기로 끝난다(cb는 다음 프레임 이후에만 불림).
//   ① 같은 입력이면 지난 결과(localStorage 한 칸, 입력 해시로 확인 — 데이터가 바뀌면 해시가 달라 자동으로 버려짐)
//   ② 웹 워커(cross-router-worker.js) — 계산 1.6초 동안 화면이 멈추지 않음 ③ 워커가 안 되면(파일로 직접 연 화면) 첫 그림 뒤 직접 계산.
let routerWorker=null,routerSeq=0;const routerWaits=new Map();
function startCrossRouting(input,cb){
 const json=JSON.stringify(input);let h=2166136261;for(let i=0;i<json.length;i++){h^=json.charCodeAt(i);h=Math.imul(h,16777619);}const hash=(h>>>0).toString(36)+':'+json.length;
 const KEY='somido-all4-routes',done=(routes,stats,save)=>{if(save)try{localStorage.setItem(KEY,JSON.stringify({hash,routes}));}catch(e){}cb(routes,stats);};
 const later=f=>document.hidden?setTimeout(f,0):requestAnimationFrame(()=>setTimeout(f,0)); // 보이는 화면이면 첫 그림 뒤에. 숨은 탭은 rAF가 안 와서 그냥 다음 차례에
 try{const c=JSON.parse(localStorage.getItem(KEY)||'null');if(c&&c.hash===hash&&Array.isArray(c.routes)){later(()=>done(c.routes,{ms:0,iters:0},false));return;}}catch(e){}
 const direct=()=>later(()=>{const r=routeCrossArrows(input);done(r.routes,{ms:r.stats.ms,iters:r.stats.log.length},true);});
 if(!routerWorker&&routerWorker!==false){try{routerWorker=new Worker('cross-router-worker.js');routerWorker.onmessage=e=>{const w=routerWaits.get(e.data.id);routerWaits.delete(e.data.id);if(w)w(e.data);};routerWorker.onerror=()=>{routerWorker.terminate();routerWorker=false;for(const w of routerWaits.values())w(null);routerWaits.clear();};}catch(e){routerWorker=false;}}
 if(!routerWorker){direct();return;}
 const id=++routerSeq;routerWaits.set(id,d=>{if(!d||d.error){direct();return;}done(d.routes,d.stats,true);});routerWorker.postMessage({id,input});
}
function renderAllMemories(tiles){
 const layer=$('.canvas-memory-layer');if(!layer)return null;const T0=performance.now();
 const HG=150,VG=36,ARROW=46,LANE_GAP=70,VGAP=84,VERTICAL_WIDTH=1250,PAD=200,PER_ROW=15,PW=240,PH=240*1068/852;
 const pages=B.book.pages.map(p=>p.id),chainsBy=new Map();
 for(const pid of pages){const cs=canvasPageChains(pid);if(cs.length)chainsBy.set(pid,cs);}
 const nodes=new Map();let html='<svg class="canvas-memory-lines" aria-hidden="true"><defs><marker id="chain-arrow" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 z" fill="#8f9b80"/></marker></defs></svg>';
 for(const [pid,cs] of chainsBy)cs.forEach((c,ci)=>{for(const list of [c.stages,c.dstages])list.forEach(st=>{if(nodes.has(st.id)){st.ref=true;return;}st.ref=false;const k=nodes.size;nodes.set(st.id,{k,pid,st});html+=`<div class="canvas-memory-card" data-k="${k}">${stageCard(st.id,st.link)}</div>`;});});
 layer.innerHTML=html;
 for(const n of nodes.values()){n.el=$(`.canvas-memory-card[data-k="${n.k}"]`,layer);n.w=cardWidth(sourceById.get(n.st.id.split('@')[0]));/* all6: 종류별 폭 */n.el.style.width=n.w+'px';}
 for(const n of nodes.values())n.h=n.el.offsetHeight;
 $$('.excerpt',layer).forEach(el=>{wheelToText(el);el.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')e.stopPropagation();});});
 // 쪽 하나의 영역 배치. P=쪽 상자. 반환: 카드 위치, 선, 문구, 다른 쪽으로 이어질 화살표(cross), 영역 범위
 const zone=(pid,P)=>{
  const out={pos:new Map(),svg:'',labels:[],cross:[],minX:P.x,minY:P.y,maxX:P.x+P.width,maxY:P.y+P.height};
  const grow=(x,y,w,h)=>{out.minX=Math.min(out.minX,x);out.minY=Math.min(out.minY,y);out.maxX=Math.max(out.maxX,x+w);out.maxY=Math.max(out.maxY,y+h);};
  const put=(id,x,y)=>{const n=nodes.get(id);out.pos.set(id,{x,y});grow(x,y,n.w,n.h);};
  // all3: 흐름(chain) 하나의 선을 <g data-page="쪽" data-cards="그 흐름의 카드 k들">로 묶는다 — 쪽에 올리든 카드에 올리든 같은 묶음을 찾아 보여 주려고.
  let curCards='';const chainCards=c=>[...c.stages,...c.dstages].map(s=>nodes.get(s.id)?.k).filter(k=>k!==undefined).join(' ');
  const wrap=(s0,c0)=>{out.svg=out.svg.slice(0,s0)+`<g data-page="${esc(pid)}" data-cards="${curCards}">`+out.svg.slice(s0)+'</g>';for(let i=c0;i<out.cross.length;i++)out.cross[i].cards=curCards;};
  const lab=(text,x1,x2,y,mode)=>{if(text)out.labels.push({text,x1,x2,y,mode,cards:curCards});};
  const tgt=(c,edge)=>{const t=[];for(const r of c.regions){const x=edge==='top'?P.x+(r.rect[0]+r.rect[2]/2)*P.width:P.x+r.rect[0]*P.width,y=edge==='top'?P.y+r.rect[1]*P.height:P.y+(r.rect[1]+r.rect[3]/2)*P.height;if(!t.some(o=>Math.abs(o.x-x)<20&&Math.abs(o.y-y)<20))t.push({x,y});}return t;};
  const cs=chainsBy.get(pid)||[];let rowTop=-Infinity,hIndex=0,vi=0,prevRight=-Infinity;
  const plans=cs.map((c,ci)=>{const ml=c.stages.filter(s=>!s.ref),dl=c.dstages.filter(s=>!s.ref);const width=ml.reduce((n,s)=>n+nodes.get(s.id).w+HG,0);return {c,ci,ml,dl,vertical:ml.length>=4||width>VERTICAL_WIDTH};});
  // 줄 안의 이웃 화살표: 둘 다 이 쪽에 놓인 카드면 바로 잇고, 하나라도 다른 쪽 카드면 cross로 넘긴다
  const laneEdges=(c,list,label,mode,getEntry)=>{for(let k=0;k<list.length-1;k++){const u=list[k],v=list[k+1];const txt=c.hop(u.id,v.id);if(!u.ref&&!v.ref)continue;out.cross.push({from:u.id,to:v.id,label:txt});}};
  for(const p of plans.filter(p=>!p.vertical)){
   const s0=out.svg.length,c0=out.cross.length;curCards=chainCards(p.c);
   const {c,ci,ml,dl}=p,ry=Math.min(...c.regions.map(r=>r.rect[1])),rh=Math.max(...c.regions.map(r=>r.rect[1]+r.rect[3]))-ry,targetY=P.y+(ry+rh/2)*P.height;
   const top=Math.max(targetY-ARROW,rowTop+VG);
   const row=(list,t)=>{let edge=P.x-HG;const xs=[];for(let k=list.length-1;k>=0;k--){const w=nodes.get(list[k].id).w;xs[k]=edge-w;edge-=w+HG;}list.forEach((s,k)=>put(s.id,xs[k],t));return {xs,ay:t+ARROW,h:Math.max(0,...list.map(s=>nodes.get(s.id).h))};};
   const rowArrows=(full,list,R)=>{for(let k=0;k<list.length-1;k++){const iu=full.indexOf(list[k]),iv=full.indexOf(list[k+1]);if(iv!==iu+1)continue;const x1=R.xs[k]+nodes.get(list[k].id).w,x2=R.xs[k+1];out.svg+=`<path d="M ${x1} ${R.ay} L ${x2} ${R.ay}" marker-end="url(#chain-arrow)"/>`;lab(c.hop(list[k].id,list[k+1].id),x1,x2,R.ay,'h');}};
   let bottom=top;const trunks=[];
   if(ml.length){const R=row(ml,top);rowArrows(c.stages,ml,R);bottom=top+R.h;if(!c.stages[c.stages.length-1].ref)trunks.push({x:R.xs[ml.length-1]+nodes.get(ml[ml.length-1].id).w,y:R.ay,label:c.lastHop});}
   laneEdges(c,c.stages);
   if(dl.length){const dtop=bottom+(ml.length?LANE_GAP:0);const R=row(dl,dtop);rowArrows(c.dstages,dl,R);bottom=dtop+R.h;const dLast=c.dstages[c.dstages.length-1];
    if(!dLast.ref){if(c.into==='comic'||!out.pos.has(c.into))trunks.push({x:R.xs[dl.length-1]+nodes.get(dLast.id).w,y:R.ay,label:c.dLastHop});else out.cross.push({from:dLast.id,to:c.into,label:c.dLastHop});}}
   laneEdges(c,c.dstages);
   rowTop=bottom;
   const elbow=P.x-22-hIndex*10;hIndex++;const targets=tgt(c,'left');
   for(const [list,last] of [[c.stages,c.lastHop],[c.dstages,c.dLastHop]]){const s=list[list.length-1];if(s&&s.ref)out.cross.push({from:s.id,toComic:targets,label:last,elbow});}
   if(trunks.length){const ys=targets.map(t=>t.y).concat(trunks.map(t=>t.y)),lo=Math.min(...ys),hi=Math.max(...ys);
    for(const t of trunks){out.svg+=`<path d="M ${t.x} ${t.y} L ${elbow} ${t.y}"/>`;lab(t.label,t.x,elbow,t.y,'h');}
    if(hi-lo>=1)out.svg+=`<path d="M ${elbow} ${lo} L ${elbow} ${hi}"/>`;
    for(const t of targets)out.svg+=`<path d="M ${elbow} ${t.y} L ${t.x} ${t.y}" marker-end="url(#chain-arrow)"/>`;}
   wrap(s0,c0);
  }
  for(const p of plans.filter(p=>p.vertical).sort((a,b)=>Math.min(...a.c.regions.map(r=>r.rect[0]))-Math.min(...b.c.regions.map(r=>r.rect[0])))){
   const s0=out.svg.length,c0=out.cross.length;curCards=chainCards(p.c);
   const {c,ml,dl}=p,busY=P.y-34-vi*12,bottomY=busY-58;vi++;
   const rx=Math.min(...c.regions.map(r=>r.rect[0])),rw=Math.max(...c.regions.map(r=>r.rect[0]+r.rect[2]))-rx;
   const mW=Math.max(260,...ml.map(s=>nodes.get(s.id).w)),dW=dl.length?Math.max(...dl.map(s=>nodes.get(s.id).w)):0,dGap=dl.length?60:0;
   let cx=P.x+(rx+rw/2)*P.width;const left=cx-mW/2-dGap-dW;if(left<prevRight+60)cx+=prevRight+60-left;prevRight=cx+mW/2;
   const stack=(full,list,centerX)=>{const tops=[];let b=bottomY;for(let k=list.length-1;k>=0;k--){const n=nodes.get(list[k].id);tops[k]=b-n.h;b=tops[k]-VGAP;}list.forEach((s,k)=>put(s.id,centerX-nodes.get(s.id).w/2,tops[k]));const ax=centerX-90;
    for(let k=0;k<list.length-1;k++){const iu=full.indexOf(list[k]),iv=full.indexOf(list[k+1]);if(iv!==iu+1)continue;const y1=tops[k]+nodes.get(list[k].id).h,y2=tops[k+1];out.svg+=`<path d="M ${ax} ${y1} L ${ax} ${y2}" marker-end="url(#chain-arrow)"/>`;lab(c.hop(list[k].id,list[k+1].id),ax,ax,(y1+y2)/2,'v');}return ax;};
   const legs=[];
   if(ml.length){const ax=stack(c.stages,ml,cx);if(!c.stages[c.stages.length-1].ref)legs.push({x:ax,label:c.lastHop});}
   laneEdges(c,c.stages);
   if(dl.length){const ax=stack(c.dstages,dl,cx-mW/2-dGap-dW/2);const dLast=c.dstages[c.dstages.length-1];if(!dLast.ref){if(c.into==='comic'||!out.pos.has(c.into))legs.push({x:ax,label:c.dLastHop});else out.cross.push({from:dLast.id,to:c.into,label:c.dLastHop});}}
   laneEdges(c,c.dstages);
   const targets=tgt(c,'top');
   for(const [list,last] of [[c.stages,c.lastHop],[c.dstages,c.dLastHop]]){const s=list[list.length-1];if(s&&s.ref)out.cross.push({from:s.id,toComicTop:targets,label:last,busY});}
   if(legs.length){const xs=targets.map(t=>t.x).concat(legs.map(l=>l.x)),lo=Math.min(...xs),hi=Math.max(...xs);
    for(const l of legs){out.svg+=`<path d="M ${l.x} ${bottomY} L ${l.x} ${busY}"/>`;lab(l.label,l.x,l.x,(bottomY+busY)/2,'v');}
    if(hi-lo>=1)out.svg+=`<path d="M ${lo} ${busY} L ${hi} ${busY}"/>`;
    for(const t of targets)out.svg+=`<path d="M ${t.x} ${busY} L ${t.x} ${t.y}" marker-end="url(#chain-arrow)"/>`;}
   wrap(s0,c0);
  }
  return out;
 };
 // 문구 크기는 실제로 잰다(긴 문구는 두세 줄로 접혀 위로 자란다). 기본 자리: 가로선 문구는 선 바로 위, 세로선 문구는 선 오른쪽.
 const meas=document.createElement('div');meas.className='chain-hop';meas.style.visibility='hidden';layer.appendChild(meas);const hCache=new Map();
 const labelBox=l=>{const w=l.mode==='h'?Math.max(70,Math.abs(l.x2-l.x1)-14):150,key=l.text+'|'+w;let hh=hCache.get(key);if(hh===undefined){meas.style.width=w+'px';meas.textContent=l.text;hh=meas.offsetHeight;hCache.set(key,hh);}
  return l.mode==='h'?{x:(l.x1+l.x2)/2-w/2,y:l.y-hh-6,w,h:hh}:{x:l.x1+10,y:l.y-hh/2,w,h:hh};};
 // 1) 쪽마다 '쪽+그 쪽 노드' 묶음의 실제 모양(사각형 목록)을 쪽을 원점에 두고 잰다: 쪽, 카드, 문구, 쪽 안의 선(폭 12 띠)
 const GX=60,GY=60,BIN=16;
 const shapeOf=pid=>{const P={x:0,y:0,width:PW,height:PH};const z=chainsBy.has(pid)?zone(pid,P):{pos:new Map(),labels:[],svg:''};
  const rects=[{x:0,y:0,w:PW,h:PH}];
  for(const [id,v] of z.pos){const n=nodes.get(id);rects.push({x:v.x,y:v.y,w:n.w,h:n.h});}
  for(const l of z.labels)if(l.text)rects.push(labelBox(l));
  for(const m of z.svg.matchAll(/d="([^"]+)"/g)){const n=(m[1].match(/-?[\d.]+/g)||[]).map(Number);for(let k=0;k+3<n.length;k+=2){const x1=Math.min(n[k],n[k+2]),x2=Math.max(n[k],n[k+2]),y1=Math.min(n[k+1],n[k+3]),y2=Math.max(n[k+1],n[k+3]);rects.push({x:x1-6,y:y1-6,w:x2-x1+12,h:y2-y1+12});}}
  return {rects,minX:Math.min(...rects.map(r=>r.x)),maxX:Math.max(...rects.map(r=>r.x+r.w)),minY:Math.min(...rects.map(r=>r.y)),maxY:Math.max(...rects.map(r=>r.y+r.h))};};
 const shapes=new Map(pages.map(pid=>[pid,shapeOf(pid)]));
 // 2) floe처럼 빈 곳을 찾아 채운다(2026-10-03 작가 요청 "여백이 너무 많아, 스스로 감지해서 줄여").
 //    책 순서대로 왼→오로 놓다가 폭을 넘으면 다음 줄. 세로는 16px 칸마다 지금까지 쌓인 높이(skyline)를 기억해
 //    묶음을 그 모양 그대로 위의 것에 닿기 직전(GY)까지 끌어올린다 → 위로 튀어나온 카드가 위쪽 빈자리로 파고든다.
 //    한 줄 15쪽 고정은 버렸다: 기록 많은 줄은 길고 적은 줄은 짧아 오른쪽 아래가 통째로 비었기 때문(12,840×9,225 중 채움 22%).
 //    폭은 여러 값을 시험해 넓이가 가장 작고 화면 비(16:9)에 가까운 것을 고른다.
 const pack=maxW=>{const box=new Map(),sky=new Map(),skyAt=b=>sky.has(b)?sky.get(b):-Infinity;let row=[],cursor=0,maxX=0,maxY=0;
  const commit=()=>{for(const o of row)for(const R of o.sh.rects){const b0=Math.floor((o.px+R.x)/BIN),b1=Math.floor((o.px+R.x+R.w-1)/BIN),bottom=o.py+R.y+R.h;for(let b=b0;b<=b1;b++)if(bottom>skyAt(b))sky.set(b,bottom);}row=[];cursor=0;};
  for(const pid of pages){const sh=shapes.get(pid);if(cursor>0&&cursor+sh.maxX-sh.minX>maxW)commit();
   const px=cursor-sh.minX;let py=-Infinity;
   for(const R of sh.rects){const b0=Math.floor((px+R.x)/BIN),b1=Math.floor((px+R.x+R.w-1)/BIN);for(let b=b0;b<=b1;b++){const need=skyAt(b)+GY-R.y;if(need>py)py=need;}}
   if(!isFinite(py))py=-sh.minY;
   row.push({px,py,sh});box.set(pid,{x:px,y:py,width:PW,height:PH,top:py+sh.minY});cursor=px+sh.maxX+GX;maxX=Math.max(maxX,px+sh.maxX);maxY=Math.max(maxY,py+sh.maxY);}
  commit();return {box,W:maxX,H:maxY};};
 let best=null;
 for(let w=3000;w<=30000;w+=250){const r=pack(w),aspect=r.W/r.H,score=r.W*r.H*(1+0.6*Math.abs(Math.log(aspect/(16/9))));if(!best||score<best.score)best={...r,score,w};}
 const pageBox=best.box;
 // 전체를 양수 좌표로 옮긴다
 const allX=[...pageBox].flatMap(([pid,P])=>{const sh=shapes.get(pid);return [P.x+sh.minX,P.x+sh.maxX];}),allY=[...pageBox].flatMap(([pid,P])=>{const sh=shapes.get(pid);return [P.y+sh.minY,P.y+sh.maxY];});
 const ox=PAD/2-Math.min(...allX),oy=PAD/2-Math.min(...allY);
 B.book.pages.forEach((p,i)=>{const P=pageBox.get(p.id);P.x+=ox;P.y+=oy;P.top+=oy;const sp=$(`[data-canvas-spread="${i}"]`);if(sp){sp.style.left=P.x+'px';sp.style.top=P.y+'px';}const t=tiles[i];if(t){t.x=P.x;t.y=P.y;}});
 const wallW=Math.max(...allX)+ox+PAD/2,wallH=Math.max(...allY)+oy+PAD/2;
 layer.dataset.pack=best.w;
 // 3) 진짜 위치로 다시 배치
 // all3(2026-10-03): 선·문구마다 '어느 쪽으로 들어가는 흐름인지'(data-page)를 붙인다 — 평소엔 숨기고, 그 쪽에 마우스를 올렸을 때만 보인다.
 let svg='',labels=[];const pos=new Map(),cross=[];
 for(const pid of chainsBy.keys()){const P=pageBox.get(pid),z=zone(pid,P);for(const [id,v] of z.pos)pos.set(id,v);svg+=z.svg;labels.push(...z.labels.map(l=>({...l,page:pid})));cross.push(...z.cross.map(x=>({...x,P,pid})));}
 for(const [id,v] of pos){const n=nodes.get(id);n.el.style.left=v.x+'px';n.el.style.top=v.y+'px';}
 // ── all6(2026-10-19): 실(요리·사람)과 짝 — 벽의 '실'은 멀리 떨어진 컷을 잇는 선이고 매듭마다 포스트잇이 선 중간에 붙는다(작가: "화살표 중간에 붙이기").
 //   B.threads[{id,name,nodes[{page,rect,stage,note}]}]: 컷 가운데를 차례로 곧은 선으로 잇고(요리 = 회색 점선, 사람 = 검정 실선), 매듭 컷엔 둥근 테두리, 포스트잇은 앞 매듭→이 매듭 선의 중간(카드·쪽과 겹치면 선을 따라 비켜 놓음).
 //   항상 보인다(벽처럼). B.pairs(앞에서 심어 둔 컷 ↔ 뒤에서 되돌아오는 컷)는 연한 점선이고 두 쪽 중 하나에 마우스를 올렸을 때만 보인다(data-page·data-page2).
 {const cutC=(pid,rect)=>{const P=pageBox.get(pid);return P?{x:P.x+(rect[0]+rect[2]/2)*P.width,y:P.y+(rect[1]+rect[3]/2)*P.height,r:{x:P.x+rect[0]*P.width,y:P.y+rect[1]*P.height,w:rect[2]*P.width,h:rect[3]*P.height}}:null;};
  const cardRects0=[...pos].map(([id,v])=>{const n=nodes.get(id);return {x:v.x,y:v.y,w:n.w,h:n.h};}),pageRects0=[...pageBox.values()].map(P=>({x:P.x,y:P.y,w:P.width,h:P.height}));
  const hit0=(a,b)=>a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1;
  let tsvg='',notes='';const NW=150,NH=150,noteRects=[];
  for(const t of (B.threads||[])){const pts=t.nodes.map(n=>({...n,c:cutC(n.page,n.rect)})).filter(n=>n.c);
   for(let i=0;i<pts.length;i++){const n=pts[i],c=n.c;
    tsvg+=`<rect class="knot ${t.id}" x="${c.r.x.toFixed(1)}" y="${c.r.y.toFixed(1)}" width="${c.r.w.toFixed(1)}" height="${c.r.h.toFixed(1)}" rx="6"/>`;
    if(i>0){const p=pts[i-1].c;tsvg+=`<path class="${t.id}" d="M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${c.x.toFixed(1)} ${c.y.toFixed(1)}"/>`;}
    if(n.note){ // 포스트잇: 선의 중간에서 시작해 ±쪽으로 비켜 가며 카드·쪽·다른 포스트잇과 안 겹치는 자리
     const free=(x,y)=>{const r={x,y,w:NW,h:NH};return !cardRects0.some(o=>hit0(r,o))&&!pageRects0.some(o=>hit0(r,o))&&!noteRects.some(o=>hit0(r,o));};
     let spot=null;const p=i>0?pts[i-1].c:null;
     if(p){for(let k=0;k<40&&!spot;k++){const tt=.5+(k%2?-1:1)*Math.ceil(k/2)*.045;if(tt<.08||tt>.92)continue;const x=p.x+(c.x-p.x)*tt-NW/2,y=p.y+(c.y-p.y)*tt-NH/2;if(free(x,y))spot={x,y};}}
     else{ // 첫 매듭(앞 선이 없음): 그 컷의 쪽 바깥 — 왼쪽, 위, 오른쪽, 아래 순으로 빈 자리
      const P=pageBox.get(n.page);for(const [x,y] of [[P.x-NW-24,c.y-NH/2],[c.x-NW/2,P.y-NH-24],[P.x+P.width+24,c.y-NH/2],[c.x-NW/2,P.y+P.height+24],[P.x-NW-24,P.y],[P.x-NW-24,P.y+P.height-NH]])if(!spot&&free(x,y))spot={x,y};
      if(!spot)spot={x:P.x-NW-24,y:c.y-NH/2};}
     if(!spot){const x=p.x+(c.x-p.x)*.5-NW/2,y=p.y+(c.y-p.y)*.5-NH/2;spot={x,y};} // 못 찾으면 선 가운데(겹치더라도)
     noteRects.push({x:spot.x,y:spot.y,w:NW,h:NH});notes+=`<div class="thread-note ${t.id}" data-thread="${t.id}" data-i="${i}" style="left:${spot.x.toFixed(1)}px;top:${spot.y.toFixed(1)}px">${bubbleHTML(n.note)}</div>`;}}}
  let psvg='',plab='';
  for(const [pi,p] of (B.pairs||[]).entries()){const a=cutC(p.first.page,p.first.rect),b=cutC(p.last.page,p.last.rect);if(!a||!b)continue;
   psvg+=`<g class="pair" data-page="${esc(p.first.page)}" data-page2="${esc(p.last.page)}" data-cards=""><path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/></g>`;
   const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;plab+=`<div class="chain-hop pair-hop" data-page="${esc(p.first.page)}" data-page2="${esc(p.last.page)}" data-cards="" style="left:${(mx-90).toFixed(1)}px;top:${(my-20).toFixed(1)}px;width:180px">${esc(p.name)}<br><span>${esc(p.meaning)}</span></div>`;}
  layer.insertAdjacentHTML('afterbegin',`<svg class="wall-lines thread-lines" aria-hidden="true">${tsvg}</svg><svg class="wall-lines pair-lines" aria-hidden="true">${psvg}</svg>`); // canvas-memory-lines 클래스를 주면 finishRoutes의 $('.canvas-memory-lines')가 이걸 집어 화살표를 여기 넣고 defs를 못 찾아 죽음
  layer.insertAdjacentHTML('beforeend',notes+plab);
  layer.dataset.threads=(B.threads||[]).map(t=>t.id+':'+t.nodes.length).join(' ');}
 // 4) 다른 쪽 카드에서 오는 화살표 — all2(2026-10-03): 길찾기만 cross-router.js의 routeCrossArrows로 바꾼 판.
 //    작가 지적 "화살표끼리 너무 겹치는 듯" → 오프라인 실험(4가지 방법 시험·반박검증)에서 고른 '줄기 묶기 + 협상식 재배선'.
 //    all의 길찾기는 다른 출발 카드가 쓴 칸에 +5만 매겨서, 60px 통로에 서로 다른 기록의 선이 같은 칸·20px 옆으로 몰렸다
 //    (벽 전체 배율에서 다른 기록 선과 뭉쳐 보이는 잉크 48%). 새 길찾기는 다 그은 뒤 다툼 남은 화살표만 여러 번 다시 그으며
 //    남이 쓰는 칸·바로 옆 칸 값을 올려 흩는다 → 실험값 뭉침 14%, 포개짐 4,577→815px, 교차점 622→414. 대가: 꺾임 +17%(계단 모양), 약 1초.
 //    기각한 것: 줄 간격만 벌리기(벽 전체로 보면 차이 없음), 먼 연결을 짧은 표시로(선이 줄어 깨끗하지만 '화살표만 여러 개' 결정과 어긋남).
 //    목표 모으기(같은 칸 중복 제거·같은 진입점 30px 어긋내기)와 선 위 문구 규칙은 all과 같다.
 const out=(id)=>{const n=nodes.get(id),v=pos.get(id);return v?{x:v.x+n.w,y:v.y+ARROW}:null;};
 const seenEdge=new Set(),entry=new Map(),goalList=[];
 const addGoal=(e,bx,by,dir,maxY,comicP)=>{const key=`${e.from}|${bx}|${by}`;if(seenEdge.has(key))return;seenEdge.add(key);
  const pk=`${bx}|${by}|${dir}`,i=entry.get(pk)||0;entry.set(pk,i+1);
  if(dir==='left')by=Math.min(by+i*30,maxY);else bx=bx+i*30;
  goalList.push({e,a:out(e.from),bx,by,dir,comicP:comicP||null,pk});};
 for(const e of cross){
  if(!out(e.from))continue;
  if(e.to){const t=pos.get(e.to),n=nodes.get(e.to);if(t)addGoal(e,t.x,t.y+ARROW,'left',t.y+n.h-12);}
  else if(e.toComic){for(const t of e.toComic)addGoal(e,t.x,t.y,'left',e.P.y+e.P.height-8,e.P);}
  else if(e.toComicTop){for(const t of e.toComicTop)addGoal(e,t.x,t.y,'top',0,e.P);}
 }
 // 장애물: 카드·쪽(8px 여유), 쪽 안 문구(실제 크기, 4px 여유) / 약한 벌점: 쪽 안의 선
 const zoneSegs=[];for(const m of svg.matchAll(/d="([^"]+)"/g)){const n=(m[1].match(/-?[\d.]+/g)||[]).map(Number);for(let k=0;k+3<n.length;k+=2)zoneSegs.push({n:[n[k],n[k+1],n[k+2],n[k+3]]});}
 // 2026-10-13 작가 "새로고침하면 왜 계속 뜨는거야": 벽 짓기 2.06초 중 1.60초가 이 길찾기였고, 그동안 빈 틀이 보였다.
 //   all4에선 화살표·문구가 마우스를 올리기 전엔 숨어 있으므로 쪽·카드를 먼저 그리고, 길찾기는 워커에서 돌린 뒤 선·문구만 붙인다(finishRoutes).
 //   그 사이에도 마우스 올림의 밝힘(관련 쪽·카드)과 누르면 모임(자체 길찾기)은 된다. 같은 입력이면 지난 결과를 다시 쓴다(startCrossRouting).
 const routerInput={W:wallW,H:wallH,
  cards:[...pos].map(([id,v])=>{const n=nodes.get(id);return {x:v.x,y:v.y,w:n.w,h:n.h};}),
  pages:[...pageBox.values()].map(P=>({x:P.x,y:P.y,w:P.width,h:P.height})),
  labels:labels.filter(l=>l.text).map(l=>labelBox(l)),zoneSegs,goals:goalList.map(g=>({a:g.a,bx:g.bx,by:g.by,dir:g.dir,comicP:g.comicP}))};
 meas.remove();layer.dataset.ms=Math.round(performance.now()-T0);
 const shortenArrows=t=>t.replace(/<path d="([^"]+)" marker-end="url\(#chain-arrow\)"\/>/g,(m,d)=>{const n=d.match(/-?[\d.]+/g).map(Number);if(n.length<4)return m;const L2=n.length,x2=n[L2-2],y2=n[L2-1],x1=n[L2-4],y1=n[L2-3],len=Math.hypot(x2-x1,y2-y1);if(len<8)return m;const k=7/len;n[L2-2]=x2-(x2-x1)*k;n[L2-1]=y2-(y2-y1)*k;let i=0;return `<path d="${d.replace(/-?[\d.]+/g,()=>+n[i++].toFixed(2))}" marker-end="url(#chain-arrow)"/>`;});
 svg=shortenArrows(svg); // 쪽 안 흐름 선부터 넣어 둔다(숨김) — 마우스 올림 묶음(byPage·byCard)을 길찾기 전에도 찾게
 $('.canvas-memory-lines',layer).insertAdjacentHTML('beforeend',svg);
 $$('.excerpt',layer).forEach(el=>{const hit=el.querySelector('.wall-hit');if(hit&&el.scrollHeight>el.clientHeight+1)el.scrollTop=Math.max(0,hit.offsetTop-40);});
 const finishRoutes=(routes,stats)=>{if(!layer.isConnected)return; // 그 사이 다시 그려졌으면 버림
 const zoneSvgShort=svg,seenLabel=new Set();let routed=0,failed=0;
 goalList.forEach((g,gi)=>{const a=g.a;let z=routes[gi];
  if(z)routed++;
  else{failed++;const gy=g.comicP?g.comicP.y-30:g.by-60;z=simplifyPts([{x:a.x,y:a.y},{x:a.x+24,y:a.y},{x:a.x+24,y:gy},{x:g.dir==='left'?g.bx-40:g.bx,y:gy},{x:g.dir==='left'?g.bx-40:g.bx,y:g.by},{x:g.bx,y:g.by}]);}
  svg+=`<g data-page="${esc(g.e.pid)}" data-cards="${g.e.cards||''}"><path d="M ${z.map(p=>`${p.x} ${p.y}`).join(' L ')}" marker-end="url(#chain-arrow)"/></g>`;
  // 문구: 목표로 들어가는 마지막 구간 옆(자리는 아래 문구 배치에서 자기 선을 따라 다시 찾는다)
  const e=g.e,lk=`${e.label}|${e.to||(g.comicP?g.comicP.x+','+g.comicP.y:g.pk)}`;if(!e.label||seenLabel.has(lk))return;seenLabel.add(lk);
  const p1=z[z.length-2]||z[0];
  if(g.dir==='left')labels.push({text:e.label,x1:p1.x,x2:g.comicP?g.comicP.x-20:g.bx,y:g.by,mode:'h',cross:true,route:z,page:e.pid,cards:e.cards});
  else labels.push({text:e.label,x1:g.bx,x2:g.bx,y:Math.min((p1.y+g.by)/2,g.comicP.y-40),mode:'v',cross:true,route:z,page:e.pid,cards:e.cards});
 });
 layer.dataset.routerMs=Math.round(stats.ms);layer.dataset.iters=stats.iters;layer.dataset.routes=`${routed}/${routed+failed}`;
 svg=zoneSvgShort+shortenArrows(svg.slice(zoneSvgShort.length));
 const lines=$('.canvas-memory-lines',layer);lines.innerHTML=lines.querySelector('defs').outerHTML+svg;
 let lh='';for(const l of labels.filter(l=>l.text)){if(l.mode==='h'){const w=Math.max(70,Math.abs(l.x2-l.x1)-14);lh+=`<div class="chain-hop" data-mode="h" data-y="${l.y}" data-page="${esc(l.page)}" data-cards="${l.cards||''}"${l.cross?' data-cross="1"':''} style="width:${w}px;left:${(l.x1+l.x2)/2-w/2}px;top:${l.y}px">${esc(l.text)}</div>`;}else lh+=`<div class="chain-hop" data-mode="v" data-y="${l.y}" data-page="${esc(l.page)}" data-cards="${l.cards||''}"${l.cross?' data-cross="1"':''} style="width:150px;text-align:left;left:${l.x1+10}px;top:${l.y}px">${esc(l.text)}</div>`;}
 layer.insertAdjacentHTML('beforeend',lh);
 // 문구끼리 겹치면 비켜 놓는다: 가로선 문구는 위로, 세로선 문구는 아래로 한 칸씩(카드 위로는 올리지 않음)
 const cardRects=[...nodes.values()].filter(n=>pos.has(n.st.id)).map(n=>{const v=pos.get(n.st.id);return {x:v.x,y:v.y,w:n.w,h:n.h};});
 const hit=(a,b)=>a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1;
 const placed=[],segRects=[];
 for(const m of svg.matchAll(/d="([^"]+)"/g)){const n=(m[1].match(/-?[\d.]+/g)||[]).map(Number);for(let k=0;k+3<n.length;k+=2)segRects.push({x:Math.min(n[k],n[k+2])-2,y:Math.min(n[k+1],n[k+3])-2,w:Math.abs(n[k+2]-n[k])+4,h:Math.abs(n[k+3]-n[k+1])+4});}
 const shown=labels.filter(l=>l.text),pageRects=[...pageBox.values()].map(P=>({x:P.x,y:P.y,w:P.width,h:P.height}));
 $$('.chain-hop:not(.focus-hop)',layer).forEach((h,li)=>{const l=shown[li];
  // 다른 쪽에서 오는 화살표의 문구: 한 줄로 두고, 자기 선을 목표 쪽 끝에서부터 거슬러 가며 선 옆 빈자리(카드·쪽·문구·다른 선과 안 겹침)에 앉힌다
  // 자리가 없으면 두 줄로 접어 다시 찾고, 그래도 없으면 남의 선 위는 허용한다(카드·쪽·문구 위는 끝까지 안 됨)
  if(l&&l.route){const R=l.route;let spot=null,w=0,hh=0;
   for(const [wrap,strict] of [[0,1],[1,1],[0,0],[1,0]]){if(spot)break;
   if(wrap){h.style.whiteSpace='normal';h.style.width=Math.ceil(w/2+24)+'px';}else{h.style.width='auto';h.style.whiteSpace='nowrap';}h.style.textAlign='left';w=h.offsetWidth;hh=h.offsetHeight;
   const ok=(x,y)=>{const r={x,y,w,h:hh};return !placed.some(o=>hit(r,o))&&!cardRects.some(c=>hit(r,c))&&!pageRects.some(c=>hit(r,c))&&!(strict&&segRects.some(c=>hit(r,c)));};
   for(let k=R.length-1;k>0&&!spot;k--){const p0=R[k-1],p1=R[k];
    if(Math.abs(p0.y-p1.y)<.01){const lo=Math.min(p0.x,p1.x),hi=Math.max(p0.x,p1.x);for(let s=0;s+w+16<=hi-lo&&!spot;s+=40){const x=p0.x<p1.x?hi-8-s-w:lo+8+s;for(const y of [p1.y-hh-6,p1.y+6])if(ok(x,y)){spot={x,y};break;}}}
    else{const lo=Math.min(p0.y,p1.y),hi=Math.max(p0.y,p1.y);for(let s=0;s+hh+16<=hi-lo&&!spot;s+=30){const y=p0.y<p1.y?hi-8-s-hh:lo+8+s;for(const x of [p1.x+8,p1.x-8-w])if(ok(x,y)){spot={x,y};break;}}}}}
   if(spot){h.style.left=spot.x+'px';h.style.top=spot.y+'px';placed.push({x:spot.x,y:spot.y,w,h:hh});return;}}
  const y=parseFloat(h.dataset.y),hh=h.offsetHeight,w=h.offsetWidth,x=parseFloat(h.style.left);let top=h.dataset.mode==='h'?y-hh-6:y-hh/2;
  // 제자리 → 한 칸 위 → 한 칸 아래 → 두 칸 위 … 가운데 다른 문구·카드·만화 쪽과 안 겹치는 첫 자리
  const free=t=>{const r={x,y:t,w,h:hh};return !placed.some(o=>hit(r,o))&&!cardRects.some(c=>hit(r,c))&&!pageRects.some(c=>hit(r,c))&&!segRects.some(c=>hit(r,c));};
  for(let i=0;i<=12;i++){const step=(i%2?-1:1)*Math.ceil(i/2)*(hh+4),t=top+(h.dataset.mode==='h'?-1:1)*step;if(free(t)){top=t;break;}}
  h.style.top=top+'px';placed.push({x,y:top,w,h:hh});});
  indexHover();if(litKey){const k=litKey;litKey=null;show(k);} // 새로 붙은 선·문구도 마우스 올림 묶음에 넣고, 켜져 있던 것은 다시 켠다
 };
 // all3: 쪽이나 카드에 마우스를 올리면 그와 이어진 흐름의 선·문구만 보이고, 상관없는 카드·만화 쪽은 흐려진다.
 //   쪽 → 그 쪽으로 들어오는 흐름 전부. 카드 → 그 카드가 들어 있는 흐름 전부(그 흐름의 다른 카드와 들어가는 쪽까지).
 //   마우스가 나가면 바로 사라진다(작가 "0.35말고 바로 사라져야지"). 나타남·사라짐은 CSS에서 0.2초 서서히.
 //   누르면 그 상태로 고정, 같은 것을 다시 누르거나 여백을 누르거나 Esc로 풀린다(작가 요청). 고정 중에는 다른 것에 올려도 아무 변화 없음
 //   (작가 요청 — 처음엔 잠깐 보여 줬다가 나가면 돌아가게 했었다). 고정 중 다른 것을 누르면 그것으로 고정이 바뀐다.
 const byPage=new Map(),byCard=new Map();
 const indexHover=()=>{byPage.clear();byCard.clear();for(const el of layer.querySelectorAll('[data-cards]')){const pg=el.dataset.page;if(!byPage.has(pg))byPage.set(pg,[]);byPage.get(pg).push(el);if(el.dataset.page2){if(!byPage.has(el.dataset.page2))byPage.set(el.dataset.page2,[]);byPage.get(el.dataset.page2).push(el);}/* all6: 짝은 두 쪽 */
  for(const k of el.dataset.cards.split(' '))if(k){if(!byCard.has(k))byCard.set(k,[]);byCard.get(k).push(el);}}};indexHover();
 const cardEls=new Map([...nodes.values()].map(n=>[String(n.k),n.el])),pageEls=new Map([...$$('.canvas-page')].map(el=>[el.dataset.canvasPage,el]));
 let litKey=null,pinned=null,litEls=[];
 const show=key=>{ // key = 'p:쪽id' | 'c:카드k' | null
  if(litKey===key)return;for(const el of litEls)el.classList.remove('on','lit');litEls=[];litKey=key;
  if(key){const t=key[0],id=key.slice(2),pgs=new Set(t==='p'?[id]:[]),cds=new Set(t==='c'?[id]:[]);
   for(const el of (t==='p'?byPage:byCard).get(id)||[]){el.classList.add('on');litEls.push(el);pgs.add(el.dataset.page);for(const k of el.dataset.cards.split(' '))if(k)cds.add(k);}
   for(const pg of pgs){const e=pageEls.get(pg);if(e){e.classList.add('lit');litEls.push(e);}}
   for(const k of cds){const e=cardEls.get(k);if(e){e.classList.add('lit');litEls.push(e);}}}
  $('.atlas-world').classList.toggle('dimming',!!key);};
 // 제자리로 돌아가는 1.1초 동안은 마우스 올림을 무시한다(날아가는 카드가 가만히 있는 커서 밑을 지나며 켜졌다 꺼졌다 하지 않게).
 let returningUntil=0;/* 모임·풀림 시간(ms) = canvas.css --spring-t. 2026-10-13 작가 "클릭하면 모이는 것도 너무 느린 듯" → 1s에서 줄임 */const SPRING_MS=(v=>v.endsWith('ms')?parseFloat(v):parseFloat(v)*1000)(getComputedStyle(document.documentElement).getPropertyValue('--spring-t').trim())||420;
 // 2026-10-13: 휠·두 손가락 쓸기·방향키로 벽을 옮기는 동안엔 마우스 올림을 끈다. 커서는 가만히 있고 쪽·카드가 그 밑을 지나가며
 //   켜졌다 꺼졌다 해서 벽 전체가 깜빡였다(검토에서 확인 — 예전엔 휠이 커서 기준 확대라 커서 밑이 안 바뀌었다). 멈추고 0.2초 뒤 커서 밑의 것을 다시 켠다.
 //   확대(ctrl/⌘ 휠)는 커서 밑이 그대로라 빼고, 카드 글 상자가 먹은 휠(글 스크롤)은 벽이 안 움직이니 여기까지 오지 않는다.
 let wheelPanUntil=0,rehoverT=0;const hoverOK=e=>e.pointerType!=='touch'&&!pinned&&performance.now()>=returningUntil&&performance.now()>=wheelPanUntil;
 const rehover=()=>{if(pinned)return;const h=document.querySelector('.canvas-memory-card:hover,.canvas-page:hover');let k=null;
  if(h){if(h.classList.contains('canvas-page')){if(byPage.has(h.dataset.canvasPage))k='p:'+h.dataset.canvasPage;}else if(byCard.has(h.dataset.k))k='c:'+h.dataset.k;}show(k);};
 const panQuiet=()=>{const now=performance.now();if(now>=wheelPanUntil&&!pinned)show(null);wheelPanUntil=now+180;clearTimeout(rehoverT);rehoverT=setTimeout(rehover,200);};
 {const vp=$('.atlas-viewport');vp.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)panQuiet();},{passive:true});vp.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow')&&!e.metaKey&&!e.ctrlKey&&!e.altKey)panQuiet();});}
 // 쪽(button)도 끌면 화면이 움직이게 data-canvas-pan(canvas-engine.js 참고). 그냥 누르면 click → 모임.
 for(const [pg,el] of pageEls){el.setAttribute('data-canvas-pan','');if(!byPage.has(pg))continue;
  el.addEventListener('pointerenter',e=>{if(hoverOK(e))show('p:'+pg);});el.addEventListener('pointerleave',e=>{if(hoverOK(e))show(null);});}
 for(const n of nodes.values()){const key='c:'+n.k;if(!byCard.has(String(n.k)))continue;
  n.el.addEventListener('pointerenter',e=>{if(hoverOK(e))show(key);});n.el.addEventListener('pointerleave',e=>{if(hoverOK(e))show(null);});
  n.el.addEventListener('click',e=>{if(e.defaultPrevented||e.button>0)return;e.stopPropagation();wallHover.pin(key);});}

 // ── all4(2026-10-03 작가 요청): 누르면 관련 카드·쪽이 누른 것 옆으로 탄성 있게 모여 한눈에 보이고, 고정을 풀면 제자리로 돌아간다.
 //   모이는 모양: 그 흐름들을 '기록 → … → 만화 쪽' 방향 그래프로 보고 왼→오 층으로 세운다(만화 쪽이 맨 오른쪽 층).
 //   층 = 쪽까지 남은 단계 수(가장 긴 길), 층 안 순서 = 다음 층 이웃의 평균 자리(교차 줄이기), 세로 자리 = 이웃 가운데에 맞추고 겹치면 아래로.
 //   누른 것(쪽 또는 카드)은 절대 움직이지 않고 나머지가 그 옆으로 온다 — 카메라도 움직이지 않는다
 //   (작가: "클릭한게 이동하면 정신없음". 처음엔 묶음이 화면 밖으로 나가면 누른 것까지 통째로 화면 안으로 밀었는데 뺐다 — 그래서 큰 묶음은 화면 밖에 걸칠 수 있다).
 //   화살표는 모인 자리 기준으로 새로 긋는다(벽 길찾기 cross-router.js를 작은 판에 그대로 씀). 원래 자리의 선은 쓰지 않는다.
 //   움직임 = CSS transform + 스프링 곡선(canvas.css --spring, 시간 --spring-t). 선·문구는 도착 무렵(0.2초 뒤) 나타난다.
 const world=$('.atlas-world'),spreadEl=new Map(B.book.pages.map((p,i)=>[p.id,$(`[data-canvas-spread="${i}"]`)]));
 const idOfK=new Map([...nodes].map(([id,n])=>[String(n.k),id]));
 const focusSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');focusSvg.setAttribute('class','canvas-memory-lines focus-lines');focusSvg.setAttribute('aria-hidden','true');layer.appendChild(focusSvg);
 let moved=[],focusHops=[];const curOff=new Map(); // 지금 옮겨져 있는 거리(모인 상태에서 다른 것을 누르면 '지금 보이는 자리'를 기준으로 다시 모이게)
 const shorten=d=>{const n=d.match(/-?[\d.]+/g).map(Number),L=n.length;if(L<4)return d;const x2=n[L-2],y2=n[L-1],x1=n[L-4],y1=n[L-3],len=Math.hypot(x2-x1,y2-y1);if(len<8)return d;n[L-2]=x2-(x2-x1)*7/len;n[L-1]=y2-(y2-y1)*7/len;let o='';for(let k=0;k<L;k+=2)o+=(k?' L ':'M ')+n[k]+' '+n[k+1];return o;};
 const focusLayout=key=>{
  // 1) 흐름 모으기: 쪽이면 그 쪽의 흐름 전부, 카드면 그 카드가 들어 있는 흐름 전부
  const flows=[];
  if(key[0]==='p'){const pid=key.slice(2);for(const c of chainsBy.get(pid)||[])flows.push({pid,c});}
  else{const id=idOfK.get(key.slice(2));for(const [pid,cs] of chainsBy)for(const c of cs)if(c.stages.some(s=>s.id===id)||c.dstages.some(s=>s.id===id))flows.push({pid,c});}
  const N=new Map(),E=new Map();
  const addCard=id=>{const k='c'+id;if(!N.has(k)){const n=nodes.get(id),v=pos.get(id);if(!n||!v)return null;N.set(k,{k,kind:'card',el:n.el,w:n.w,h:n.h,ox:v.x,oy:v.y,succ:new Set()});}return k;};
  const addPage=pid=>{const k='p'+pid;if(!N.has(k)){const P=pageBox.get(pid);N.set(k,{k,kind:'page',pid,el:spreadEl.get(pid),w:PW,h:PH,ox:P.x,oy:P.y,succ:new Set()});}return k;};
  // 같은 두 노드라도 장면마다 '바뀐 점' 문구가 다르면 다 보여야 한다(검토에서 확인: 첫 문구만 남고 278개 중 50개에서 문구 99개가 빠졌음).
  //   쪽으로 가는 선은 문구마다 따로 긋고(그 장면의 칸으로), 카드끼리는 한 선에 문구 여러 개.
  const edge=(a,b,label,regions)=>{if(!a||!b||a===b)return;const ek=a+'>'+b+(N.get(b).kind==='page'?'|'+(label||''):'');if(!E.has(ek))E.set(ek,{a,b,labels:new Set(),regions:[]});const e=E.get(ek);if(label)e.labels.add(label);if(regions)e.regions.push(...regions);N.get(a).succ.add(b);};
  for(const {pid,c} of flows){const pk=addPage(pid);
   for(const [list,last,isDec] of [[c.stages,c.lastHop,false],[c.dstages,c.dLastHop,true]]){if(!list.length)continue;const ks=list.map(s=>addCard(s.id));
    for(let i=0;i<ks.length-1;i++)edge(ks[i],ks[i+1],c.hop(list[i].id,list[i+1].id));
    const into=isDec&&c.into!=='comic'?addCard(c.into):pk;edge(ks[ks.length-1],into,last,into===pk?c.regions:null);}}
  if(!N.size)return null;
  // 2) 층: 만화 쪽 = 0, 카드 = 1 + 다음 것들 중 가장 큰 층(고리 방지로 깊이 제한)
  const rank=new Map(),calc=(k,d)=>{if(rank.has(k))return rank.get(k);const n=N.get(k);if(n.kind==='page'||d>40){rank.set(k,0);return 0;}let r=0;for(const s of n.succ)r=Math.max(r,1+calc(s,d+1));rank.set(k,r);return r;};
  for(const k of N.keys())calc(k,0);
  const R=Math.max(...rank.values()),layers=[...Array(R+1)].map(()=>[]);
  for(const [k,n] of N)layers[R-rank.get(k)].push(n);
  layers[R].sort((x,y)=>B.book.pages.findIndex(p=>p.id===x.pid)-B.book.pages.findIndex(p=>p.id===y.pid));
  const ord=new Map();const setOrd=()=>layers.forEach(l=>l.forEach((n,i)=>ord.set(n.k,(i+.5)/l.length)));setOrd();
  for(let pass=0;pass<3;pass++){for(let l=R-1;l>=0;l--){const bc=n=>{const ss=[...n.succ];return ss.length?ss.reduce((t,s)=>t+ord.get(s),0)/ss.length:ord.get(n.k);};layers[l].sort((x,y)=>bc(x)-bc(y));setOrd();}}
  // 3) 자리: 열은 오른쪽(만화 쪽)부터, 열 사이 260(화살표·문구 자리). 세로는 이웃 가운데에 맞추고 겹치면 아래로.
  const GX=260,GY=40,cw=layers.map(l=>Math.max(...l.map(n=>n.w)));
  let x=0;for(let l=R;l>=0;l--){if(l<R)x-=GX+cw[l];for(const n of layers[l])n.fx=x+(l<R?cw[l]-n.w:0);}
  let y=0;for(const n of layers[R]){n.fy=y;y+=n.h+60;}
  for(let l=R-1;l>=0;l--){const want=layers[l].map(n=>{const ss=[...n.succ].map(s=>N.get(s));const cy=ss.reduce((t,s)=>t+s.fy+s.h/2,0)/ss.length;return {n,y:cy-n.h/2};}).sort((a,b)=>a.y-b.y);
   let bottom=-Infinity;for(const o of want){o.n.fy=Math.max(o.y,bottom+GY);bottom=o.n.fy+o.n.h;}
   const shift=want.reduce((t,o)=>t+(o.y-o.n.fy),0)/want.length;for(const o of want)o.n.fy+=shift;}
  // 4) 누른 것을 지금 보이는 자리에 고정하고 나머지를 옮긴다
  const anchor=N.get(key[0]==='p'?'p'+key.slice(2):'c'+idOfK.get(key.slice(2))),off=curOff.get(anchor.el)||{x:0,y:0};const ax=anchor.ox+off.x-anchor.fx,ay=anchor.oy+off.y-anchor.fy;
  for(const n of N.values()){n.fx+=ax;n.fy+=ay;}
  // 5) 화살표: 모인 자리로 작은 판을 만들어 길찾기(카드·쪽을 피해 가로·세로로만)
  const nodesArr=[...N.values()],minX=Math.min(...nodesArr.map(n=>n.fx))-160,minY=Math.min(...nodesArr.map(n=>n.fy))-160;
  const maxX=Math.max(...nodesArr.map(n=>n.fx+n.w))+160,maxY=Math.max(...nodesArr.map(n=>n.fy+n.h))+160;
  const loc=n=>({x:n.fx-minX,y:n.fy-minY,w:n.w,h:n.h});
  const goals=[],gEdge=[],entryCount=new Map();
  for(const e of E.values()){const A=N.get(e.a),Bn=N.get(e.b),a={x:A.fx+A.w-minX,y:A.fy+ARROW-minY};
   if(Bn.kind==='page'){const P=loc(Bn),pts=[];for(const r of e.regions){const px=P.x+r.rect[0]*P.w,py=P.y+(r.rect[1]+r.rect[3]/2)*P.h;if(!pts.some(o=>Math.abs(o.x-px)<20&&Math.abs(o.y-py)<20))pts.push({x:px,y:py});}
    if(!pts.length)pts.push({x:P.x,y:P.y+P.h/2});for(const t of pts){goals.push({a,bx:t.x,by:t.y,dir:'left',comicP:P});gEdge.push(e);}}
   else{const T=loc(Bn),ek=Bn.k,i=entryCount.get(ek)||0;entryCount.set(ek,i+1);goals.push({a,bx:T.x,by:Math.min(T.y+ARROW+i*24,T.y+T.h-12),dir:'left',comicP:null});gEdge.push(e);}}
  const routed=goals.length?routeCrossArrows({W:maxX-minX,H:maxY-minY,cards:nodesArr.filter(n=>n.kind==='card').map(loc),pages:nodesArr.filter(n=>n.kind==='page').map(loc),labels:[],zoneSegs:[],goals},{ITERS:3}).routes:[];
  const paths=routed.map((r,i)=>{const z=(r||[{x:goals[i].a.x,y:goals[i].a.y},{x:goals[i].bx,y:goals[i].by}]).map(p=>({x:p.x+minX,y:p.y+minY}));return {z,e:gEdge[i]};});
  return {N,paths};
 };
 // 떠나는 것: focus-on은 바로 떼고(그래서 바로 흐려짐) focus-back을 돌아가는 시간(SPRING_MS)+0.1초 붙여, 돌아가는 동안만 흐린 것들 위·새 묶음 아래로 지나가게.
 //   (검토에서 확인: 예전엔 focus-on을 1.1초 남겨서 안 흐려진 채 새 선 위로 날아갔고, 1.1초 안에 연달아 풀면 타이머가 지워져 영영 남았음)
 //   타이머는 요소마다 하나(2026-10-13 검토): 호출마다 따로 걸면, 빨리 풀기→모으기→풀기 할 때 먼저 걸린 타이머가 두 번째로 돌아가는 중인 요소의 focus-back을 일찍 떼서
 //   돌아가는 쪽이 0.2초쯤 제자리 쪽들 아래로 지나갔다.
 const sendBack=els=>{for(const el of els){el.style.transform='';curOff.delete(el);el._off=null;el.classList.remove('focus-on');el.classList.add('focus-back');
  clearTimeout(el._backT);el._backT=setTimeout(()=>{if(!moved.includes(el))el.classList.remove('focus-back');},SPRING_MS+100);}};
 // 선은 매번 '안 보임'에서 다시 시작해야 도착 무렵 서서히 나타난다(검토에서 확인: 두 번째부터 누르자마자 보였음). transition을 잠깐 끄고 지워야 1→0 사라짐이 끼어들지 않는다.
 const resetLines=()=>{focusSvg.style.transition='none';focusSvg.classList.remove('in');focusSvg.innerHTML='';void focusSvg.getBoundingClientRect();focusSvg.style.transition='';for(const h of focusHops)h.remove();focusHops=[];};
 const refresh=()=>{if(canvasController)canvasController.setCamera(canvasController.getCamera());}; // 쪽 이미지(썸네일/원본)를 옮겨진 자리 기준으로 다시 고르게
 const unfocus=()=>{sendBack(moved);moved=[];resetLines();world.classList.remove('focusing');returningUntil=performance.now()+SPRING_MS+100;refresh();
  // 다 돌아온 뒤, 커서가 어떤 쪽·카드 위에 있으면 그 마우스 올림을 다시 켠다(풀린 직후 커서 위치와 어긋나던 것)
  setTimeout(rehover,SPRING_MS+120);};
 const focus=key=>{const F=focusLayout(key);
  const next=F?[...F.N.values()]:[];const nextEls=new Set(next.map(n=>n.el));
  sendBack(moved.filter(el=>!nextEls.has(el)));resetLines();
  if(!F){moved=[];world.classList.remove('focusing');refresh();return;}
  moved=next.map(n=>n.el);world.classList.add('focusing');
  for(const n of next){const o={x:Math.round((n.fx-n.ox)*100)/100,y:Math.round((n.fy-n.oy)*100)/100}; /* 반올림: 누른 것의 0이 -2e-13 같은 찌꺼기가 되지 않게 */clearTimeout(n.el._backT);n.el.classList.remove('focus-back');n.el.classList.add('focus-on');curOff.set(n.el,o);if(n.kind==='page')n.el._off=o;n.el.style.transform=`translate(${o.x}px,${o.y}px)`;}
  // 선·문구(도착 무렵 나타남)
  focusSvg.innerHTML=F.paths.map(({z})=>`<path d="${shorten('M '+z.map(p=>p.x+' '+p.y).join(' L '))}" marker-end="url(#chain-arrow)"/>`).join('');
  const boxes=next.map(n=>({x:n.fx,y:n.fy,w:n.w,h:n.h})),segs=[];for(const {z} of F.paths)for(let k=0;k+1<z.length;k++)segs.push({x:Math.min(z[k].x,z[k+1].x)-2,y:Math.min(z[k].y,z[k+1].y)-2,w:Math.abs(z[k+1].x-z[k].x)+4,h:Math.abs(z[k+1].y-z[k].y)+4});
  const hit=(a,b)=>a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1,placed=[],done=new Set();
  for(const {z,e} of F.paths){if(done.has(e))continue;done.add(e);for(const text of e.labels){
   const h=document.createElement('div');h.className='chain-hop focus-hop';h.textContent=text;h.style.whiteSpace='nowrap';layer.appendChild(h);const w=h.offsetWidth,hh=h.offsetHeight;let spot=null;
   // 자리 찾기: ① 목표 쪽 끝에서부터 자기 선을 거슬러 가며 선 옆 빈자리(노드·문구·다른 선 피함) ② 없으면 다른 선 위는 허용하고 다시
   //   ③ 그래도 없으면 선 시작점 옆에서 아래로 한 칸씩 내려가며 빈자리(검토 후 추가: 예전엔 못 찾은 문구가 전부 같은 예비 자리에 겹쳤음)
   for(const strict of [true,false]){if(spot)break;
    const ok=(x,y)=>{const r={x,y,w,h:hh};return !placed.some(o=>hit(r,o))&&!boxes.some(o=>hit(r,o))&&!(strict&&segs.some(o=>hit(r,o)));};
    for(let k=z.length-1;k>0&&!spot;k--){const p0=z[k-1],p1=z[k];
     if(Math.abs(p0.y-p1.y)<.01){const lo=Math.min(p0.x,p1.x),hi=Math.max(p0.x,p1.x);for(let s=0;s+w+16<=hi-lo&&!spot;s+=30){const xx=p0.x<p1.x?hi-8-s-w:lo+8+s;for(const yy of [p1.y-hh-6,p1.y+6])if(ok(xx,yy)){spot={x:xx,y:yy};break;}}}
     else{const lo=Math.min(p0.y,p1.y),hi=Math.max(p0.y,p1.y);for(let s=0;s+hh+16<=hi-lo&&!spot;s+=24){const yy=p0.y<p1.y?hi-8-s-hh:lo+8+s;for(const xx of [p1.x+8,p1.x-8-w])if(ok(xx,yy)){spot={x:xx,y:yy};break;}}}}}
   if(!spot){const p0=z[0],free=(x,y)=>{const r={x,y,w,h:hh};return !placed.some(o=>hit(r,o))&&!boxes.some(o=>hit(r,o));};
    for(let i=0;i<40&&!spot;i++)for(const xx of [p0.x+10,p0.x+10+w+12]){const yy=p0.y-hh-6+i*(hh+4);if(free(xx,yy)){spot={x:xx,y:yy};break;}}
    if(!spot)spot={x:p0.x+10,y:p0.y-hh-6};}
   h.style.left=spot.x+'px';h.style.top=spot.y+'px';placed.push({x:spot.x,y:spot.y,w,h:hh});focusHops.push(h);}}
  requestAnimationFrame(()=>{focusSvg.classList.add('in');for(const h of focusHops)h.classList.add('in');});refresh();};
 // 누름: 같은 것을 다시 누르거나 여백·Esc → 풀림(제자리로). 다른 것을 누르면 그것으로 다시 모임.
 wallHover={pin:key=>{if(key&&key[0]==='p'&&!byPage.has(key.slice(2)))key=null;if(key&&key===pinned)key=null;pinned=key;show(null);if(key)focus(key);else unfocus();}};
 startCrossRouting(routerInput,finishRoutes);
 return {x:0,y:0,width:wallW,height:wallH,cards:nodes.size,cross:cross.length};
}
function canvasPageBox(pageId){
 const page=$('[data-canvas-page="'+pageId+'"]');if(!page)return null;const spread=page.closest('.canvas-spread');
 return {x:spread.offsetLeft+page.offsetLeft,y:spread.offsetTop,width:page.offsetWidth,height:page.offsetHeight};
}
function renderCanvasMemories(){
 if(typeof ALL_MODE!=='undefined')return;
 const layer=$('.canvas-memory-layer');if(!layer)return;
 const chains=canvasSelection?canvasPageChains(canvasSelection.pageId):[];
 if(canvasSelection&&!chains.length)canvasSelection=null;
 $('.canvas-shell').classList.toggle('has-memory-selection',!!canvasSelection);
 const lit=canvasSelection?{id:'*',regions:chains.flatMap(c=>c.regions)}:null;
 $$('.canvas-page').forEach(el=>{
  const selected=!!canvasSelection&&el.dataset.canvasPage===canvasSelection.pageId;
  el.classList.toggle('memory-selected',selected);el.setAttribute('aria-pressed',selected);
  $('.canvas-page-regions',el).innerHTML=canvasPageSvg(pageById.get(el.dataset.canvasPage),selected?lit:null);
  if(selected){const img=$('img',el);img.src=img.dataset.full;}
 });
 if(!canvasSelection){layer.innerHTML='';return;}
 let html='<svg class="canvas-memory-lines" aria-hidden="true"><defs><marker id="chain-arrow" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 5 L0 10 z" fill="#8f9b80"/></marker></defs></svg>';
 chains.forEach((c,ci)=>{
  for(const [lane,list,lastLabel] of [['m',c.stages,c.lastHop],['d',c.dstages,c.dLastHop]]){
   list.forEach((st,si)=>{html+=`<div class="canvas-memory-card" data-chain="${ci}" data-lane="${lane}" data-stage="${si}">${stageCard(st.id,st.link)}</div>`;});
   list.forEach((st,si)=>{const next=list[si+1];const label=next?c.hop(st.id,next.id):lastLabel;if(label)html+=`<div class="chain-hop" data-chain="${ci}" data-lane="${lane}" data-hop="${si}">${esc(label)}</div>`;});
  }
 });
 layer.innerHTML=html;
 $$('.excerpt',layer).forEach(el=>{
  wheelToText(el);
  el.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')e.stopPropagation();});
 });
 layoutCanvasMemories(chains);
 $$('img',layer).forEach(img=>{if(!img.complete)img.onload=()=>layoutCanvasMemories(chains);});
}
// 줄 배치(캔버스 좌표). 2026-10-03 작가 요청: "보통은 왼→오, 노드가 많으면 위에서 아래".
// - 가로(기본): 노드 줄을 쪽 왼쪽에 두고 오래된 기록부터 오른쪽으로 흘러 컷에 닿는다. 결정 줄은 기억 줄 아래.
// - 세로: 기억 줄 노드가 4개 이상이거나 가로 길이가 1250을 넘는 장면은 쪽 위에 세로로 쌓아 위에서 아래로 흘러
//   컷 위쪽으로 들어간다. 결정 줄은 그 왼쪽 세로줄. 두 줄은 쪽 바로 위 가로선에서 만난다.
// 화살표는 모두 가로·세로 직선. 오른쪽 열 컷으로 가는 선은 흐려진 다른 칸 위를 지나간다.
function layoutCanvasMemories(chains){
 const layer=$('.canvas-memory-layer');if(!layer||!canvasSelection)return;
 const page=canvasPageBox(canvasSelection.pageId);if(!page)return;
 const HG=150,VG=36,ARROW=46,LANE_GAP=70,VGAP=84,VERTICAL_WIDTH=1250;
 let svg='';
 const hopEl=(ci,lane,k)=>$(`.chain-hop[data-chain="${ci}"][data-lane="${lane}"][data-hop="${k}"]`,layer);
 const hopH=(ci,lane,k,x1,x2,y)=>{const h=hopEl(ci,lane,k);if(!h)return;const hw=Math.max(70,Math.abs(x2-x1)-14);h.style.width=hw+'px';h.style.textAlign='center';h.style.left=((x1+x2)/2-hw/2)+'px';h.style.top=(y-h.offsetHeight-6)+'px';};
 const hopV=(ci,lane,k,x,y1,y2)=>{const h=hopEl(ci,lane,k);if(!h)return;h.style.width='150px';h.style.textAlign='left';h.style.left=(x+10)+'px';h.style.top=((y1+y2)/2-h.offsetHeight/2)+'px';};
 const cardsOf=(ci,lane)=>{const cs=$$(`.canvas-memory-card[data-chain="${ci}"][data-lane="${lane}"]`,layer);cs.forEach(el=>{el.style.width=(el.querySelector('.has-image')?500:260)+'px';});return cs;};
 const wOf=el=>parseFloat(el.style.width);
 const targetsOf=(c,edge)=>{const t=[];for(const r of c.regions){const x=edge==='top'?page.x+(r.rect[0]+r.rect[2]/2)*page.width:page.x+r.rect[0]*page.width,y=edge==='top'?page.y+r.rect[1]*page.height:page.y+(r.rect[1]+r.rect[3]/2)*page.height;if(!t.some(o=>Math.abs(o.x-x)<20&&Math.abs(o.y-y)<20))t.push({x,y});}return t;};
 const plan=chains.map((c,ci)=>{const m=cardsOf(ci,'m'),d=cardsOf(ci,'d');const width=m.reduce((n,el)=>n+wOf(el)+HG,0);return {c,ci,m,d,vertical:m.length>=4||width>VERTICAL_WIDTH};});
 // ── 가로: 쪽 왼쪽, 오래된 기록이 가장 왼쪽 ──
 const row=(cards,top)=>{const n=cards.length,ws=cards.map(wOf),xs=new Array(n);let edge=page.x-HG;for(let k=n-1;k>=0;k--){xs[k]=edge-ws[k];edge-=ws[k]+HG;}cards.forEach((el,k)=>{el.style.left=xs[k]+'px';el.style.top=top+'px';});return {n,ws,xs,ay:top+ARROW,h:Math.max(0,...cards.map(el=>el.offsetHeight)),near:n?xs[n-1]+ws[n-1]:null};};
 const arrowsH=(ci,lane,R)=>{for(let k=0;k<R.n-1;k++){const x1=R.xs[k]+R.ws[k],x2=R.xs[k+1];svg+=`<path d="M ${x1} ${R.ay} L ${x2} ${R.ay}" marker-end="url(#chain-arrow)"/>`;hopH(ci,lane,k,x1,x2,R.ay);}};
 let rowTop=-Infinity,hIndex=0;
 for(const p of plan.filter(p=>!p.vertical)){
  const {c,ci}=p,ry=Math.min(...c.regions.map(r=>r.rect[1])),rh=Math.max(...c.regions.map(r=>r.rect[1]+r.rect[3]))-ry;
  const top=Math.max(page.y+(ry+rh/2)*page.height-ARROW,rowTop+VG);
  const M=row(p.m,top);arrowsH(ci,'m',M);let bottom=top+M.h,D=null,intoIdx=-1;
  if(p.d.length){
   const dtop=bottom+LANE_GAP;intoIdx=c.into==='comic'?-1:c.stages.findIndex(s=>s.id===c.into);
   if(intoIdx<0){D=row(p.d,dtop);arrowsH(ci,'d',D);}
   else{// 결정이 고친 초안 바로 아래에 결정 카드, 위로 들어가는 화살표
    const n=p.d.length,ws=p.d.map(wOf),xs=new Array(n),cx=M.xs[intoIdx]+M.ws[intoIdx]/2;xs[n-1]=cx-ws[n-1]/2;for(let k=n-2;k>=0;k--)xs[k]=xs[k+1]-HG-ws[k];
    p.d.forEach((el,k)=>{el.style.left=xs[k]+'px';el.style.top=dtop+'px';});D={n,ws,xs,ay:dtop+ARROW,h:Math.max(...p.d.map(el=>el.offsetHeight)),near:null};arrowsH(ci,'d',D);
    const mb=top+p.m[intoIdx].offsetHeight;svg+=`<path d="M ${cx} ${dtop} L ${cx} ${mb}" marker-end="url(#chain-arrow)"/>`;hopV(ci,'d',n-1,cx,mb,dtop);}
   bottom=dtop+D.h;
  }
  rowTop=bottom;
  const elbow=page.x-22-hIndex*10;hIndex++;
  const targets=targetsOf(c,'left'),trunks=[{lane:'m',x:M.near,y:M.ay,k:M.n-1}];
  if(D&&intoIdx<0)trunks.push({lane:'d',x:D.near,y:D.ay,k:D.n-1});
  const ys=targets.map(t=>t.y).concat(trunks.map(t=>t.y)),lo=Math.min(...ys),hi=Math.max(...ys);
  for(const t of trunks){svg+=`<path d="M ${t.x} ${t.y} L ${elbow} ${t.y}"/>`;hopH(ci,t.lane,t.k,t.x,elbow,t.y);}
  if(hi-lo>=1)svg+=`<path d="M ${elbow} ${lo} L ${elbow} ${hi}"/>`;
  for(const t of targets)svg+=`<path d="M ${elbow} ${t.y} L ${t.x} ${t.y}" marker-end="url(#chain-arrow)"/>`;
 }
 // ── 세로: 쪽 위, 오래된 기록이 가장 위 ──
 const vplans=plan.filter(p=>p.vertical).sort((a,b)=>Math.min(...a.c.regions.map(r=>r.rect[0]))-Math.min(...b.c.regions.map(r=>r.rect[0])));
 let prevRight=-Infinity;
 vplans.forEach((p,vi)=>{
  const {c,ci}=p,busY=page.y-34-vi*12,bottomY=busY-58;
  const rx=Math.min(...c.regions.map(r=>r.rect[0])),rw=Math.max(...c.regions.map(r=>r.rect[0]+r.rect[2]))-rx;
  const mW=Math.max(...p.m.map(wOf)),intoIdx=p.d.length&&c.into!=='comic'?c.stages.findIndex(s=>s.id===c.into):-1;
  const dW=p.d.length?Math.max(...p.d.map(wOf)):0,dGap=p.d.length?60:0;
  let cx=page.x+(rx+rw/2)*page.width;
  const left=cx-mW/2-dGap-dW;if(left<prevRight+60)cx+=prevRight+60-left;
  prevRight=cx+mW/2;
  // 기억 세로줄(가운데 cx), 위에서 아래로
  const stack=(cards,centerX,bottom)=>{const n=cards.length,tops=new Array(n);let b=bottom;for(let k=n-1;k>=0;k--){tops[k]=b-cards[k].offsetHeight;b=tops[k]-VGAP;}cards.forEach((el,k)=>{el.style.left=(centerX-wOf(el)/2)+'px';el.style.top=tops[k]+'px';});return {n,tops,hs:cards.map(el=>el.offsetHeight),ax:centerX-90};};
  const arrowsV=(lane,S)=>{for(let k=0;k<S.n-1;k++){const y1=S.tops[k]+S.hs[k],y2=S.tops[k+1];svg+=`<path d="M ${S.ax} ${y1} L ${S.ax} ${y2}" marker-end="url(#chain-arrow)"/>`;hopV(ci,lane,k,S.ax,y1,y2);}};
  const M=stack(p.m,cx,bottomY);arrowsV('m',M);
  const legs=[{lane:'m',x:M.ax,y:bottomY,k:M.n-1}];
  if(p.d.length){
   const dcx=cx-mW/2-dGap-dW/2;
   if(intoIdx<0){const D=stack(p.d,dcx,bottomY);arrowsV('d',D);legs.push({lane:'d',x:D.ax,y:bottomY,k:D.n-1});}
   else{// 결정이 고친 초안 바로 왼쪽에서 오른쪽으로 들어간다
    const mt=M.tops[intoIdx],mh=M.hs[intoIdx],dn=p.d.length,lastH=p.d[dn-1].offsetHeight,D=stack(p.d,dcx,mt+mh/2+lastH/2);arrowsV('d',D);
    const y=mt+Math.min(ARROW,mh/2),x1=dcx+wOf(p.d[dn-1])/2,x2=cx-wOf(p.m[intoIdx])/2;svg+=`<path d="M ${x1} ${y} L ${x2} ${y}" marker-end="url(#chain-arrow)"/>`;hopH(ci,'d',dn-1,x1,x2,y);}
  }
  const targets=targetsOf(c,'top'),xs=targets.map(t=>t.x).concat(legs.map(l=>l.x)),lo=Math.min(...xs),hi=Math.max(...xs);
  for(const l of legs){svg+=`<path d="M ${l.x} ${l.y} L ${l.x} ${busY}"/>`;hopV(ci,l.lane,l.k,l.x,l.y,busY);}
  if(hi-lo>=1)svg+=`<path d="M ${lo} ${busY} L ${hi} ${busY}"/>`;
  for(const t of targets)svg+=`<path d="M ${t.x} ${busY} L ${t.x} ${t.y}" marker-end="url(#chain-arrow)"/>`;
 });
 // 2026-10-03 작가 지적("안 뾰족하잖아 라인이 끝까지 가서"): 화살표 선은 촉이 시작되는 곳(끝에서 7)에서 멈추고 촉(marker, refX=0)이 목표까지 뻗는다.
 svg=svg.replace(/<path d="([^"]+)" marker-end="url\(#chain-arrow\)"\/>/g,(m,d)=>{const n=d.match(/-?[\d.]+/g).map(Number);if(n.length<4)return m;const L=n.length,x2=n[L-2],y2=n[L-1],x1=n[L-4],y1=n[L-3],len=Math.hypot(x2-x1,y2-y1);if(len<8)return m;const k=7/len;n[L-2]=x2-(x2-x1)*k;n[L-1]=y2-(y2-y1)*k;let i=0;return `<path d="${d.replace(/-?[\d.]+/g,()=>+n[i++].toFixed(2))}" marker-end="url(#chain-arrow)"/>`;});
 const lines=$('.canvas-memory-lines',layer);lines.innerHTML=lines.querySelector('defs').outerHTML+svg;
 // 진한 대목이 글 상자 위쪽에 오도록 처음 스크롤 위치를 맞춘다(위에 흐린 글 한두 줄은 보이게)
 $$('.excerpt',layer).forEach(el=>{const hit=el.querySelector('.wall-hit');if(hit&&el.scrollHeight>el.clientHeight+1)el.scrollTop=Math.max(0,hit.offsetTop-40);});
}
function svgPage(page,active,ons){
 const regs=active?active.regions.filter(r=>r.page===page.id):[];
 const maskId='mask-'+page.id;
 let svg=`<svg viewBox="0 0 1000 1253.52" preserveAspectRatio="none" data-page="${page.id}" aria-label="${page.number}쪽의 연결 장면">`;
 const toRect=r=>`x="${r.rect[0]*1000}" y="${r.rect[1]*1253.52}" width="${r.rect[2]*1000}" height="${r.rect[3]*1253.52}"`;
 if(active){svg+=`<defs><mask id="${maskId}"><rect width="1000" height="1253.52" fill="white"/>${regs.map(r=>`<rect ${toRect(r)} fill="black"/>`).join('')}</mask></defs><rect width="1000" height="1253.52" fill="#f7f5ef" opacity=".78" mask="url(#${maskId})" pointer-events="none"/>`;}
 for(const a of ons){for(const [ri,r] of a.regions.entries()){if(r.page!==page.id)continue;const sel=active?.id===a.id;svg+=`<g><rect ${toRect(r)} class="region-hit" tabindex="0" role="button" aria-label="${esc(a.title)} · ${isCandidate(a)?'연결 검토 중':'기록 보기'}" data-anchor="${esc(a.id)}" data-region="${ri}"/>${sel?`<rect ${toRect(r)} class="selected-outline ${isCandidate(a)?'candidate':''}"/>`:!active?`<circle cx="${Math.min(965,(r.rect[0]+r.rect[2])*1000-13)}" cy="${r.rect[1]*1253.52+17}" r="8" class="region-dot ${isCandidate(a)?'candidate':''}"/>`:''}</g>`;}}
 for(const r of state.draftRegions.filter(r=>r.page===page.id))svg+=`<rect ${toRect(r)} class="draft-rect"/>`;
 return svg+'</svg>';
}
function renderReader(){
 const spread=spreads[state.spread];const pages=spread.pageIds.map(id=>pageById.get(id));const ons=anchorsOnPages(spread.pageIds);let active=state.anchor&&anchorById.get(state.anchor);if(active&&!state.editing&&!visibleLinks(active).length)active=null;
 const section=B.book.sections.find(s=>s.id===pages[0].sectionId);const label=pages.map(p=>p.number).join('–');
 $('#main').innerHTML=`<section class="reader"><div class="reader-header"><button class="back" id="back-book">← 책 전체</button><div class="reader-heading"><h1>${esc(section?.title||'소미도 근무일지')}</h1><p>PDF ${label}쪽 · ${section?.kind==='interlude'?'막간':'소미도 근무일지'}</p></div><div class="reader-controls"><button id="zoom-out" aria-label="만화 축소">−</button><button id="zoom-reset" aria-label="만화 전체 크기로">${Math.round(state.readerZoom*100)}%</button><button id="zoom-in" aria-label="만화 확대">＋</button>${state.editing?'<button id="draw-start">＋ 영역 지정</button><button id="whole-page">페이지 전체 연결</button>':''}<button id="reader-toggle-confirmed" aria-pressed="${!state.candidates}">${state.candidates?'모든 연결':'확인된 연결만'}</button><button id="prev-spread" aria-label="이전 펼침면" ${state.spread===0?'disabled':''}>←</button><button id="next-spread" aria-label="다음 펼침면" ${state.spread===spreads.length-1?'disabled':''}>→</button></div></div>${state.draw?`<div class="draw-notice">연결할 부분을 드래그하세요. 여러 영역을 그린 뒤 함께 연결할 수 있어요. <button id="draw-cancel">취소</button><button id="draw-finish" class="primary" ${!state.draftRegions.length?'disabled':''}>${state.draftRegions.length}개 영역 연결</button></div>`:''}<div class="reader-body"><div class="comic-stage ${state.draw?'draw-active':''}"><div class="comic-spread">${pages.map(p=>`<div class="comic-page ${pages.length===1?'only':''}" data-page="${p.id}"><img src="${esc(p.image)}" alt="소미도 근무일지 ${p.number}쪽${p.blank?' · 여백':''}" draggable="false">${svgPage(p,active,ons)}</div>`).join('')}</div></div><svg class="reader-connections" aria-hidden="true"></svg><aside class="record-rail" aria-label="이 장면의 관련 기록">${renderRail(active,ons)}</aside></div><div class="strip"><button id="strip-prev" aria-label="이전 펼침면" ${state.spread===0?'disabled':''}>‹</button><div class="filmstrip">${spreads.map((s,i)=>`<button class="film ${i===state.spread?'current':''}" data-spread="${i}" aria-label="${s.pageIds.map(getPageNumber).join('–')}쪽으로">${s.pageIds.map(id=>`<img src="${esc(pageById.get(id).thumb)}" alt="" loading="lazy">`).join('')}</button>`).join('')}</div><button id="strip-next" aria-label="다음 펼침면" ${state.spread===spreads.length-1?'disabled':''}>›</button><span class="reader-page-label">${label} / ${B.book.pages.length}</span></div></section>`;
 $('#back-book').onclick=()=>navigate('book');$('#prev-spread').onclick=$('#strip-prev').onclick=()=>moveSpread(-1);$('#next-spread').onclick=$('#strip-next').onclick=()=>moveSpread(1);
 $('#reader-toggle-confirmed').onclick=()=>{state.candidates=!state.candidates;renderReader();};
 $$('[data-anchor]',$('#main')).forEach(el=>{el.onclick=e=>{if(state.draw)return;e.stopPropagation();selectAnchor(el.dataset.anchor);};el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectAnchor(el.dataset.anchor);}};});
 $$('[data-source]',$('#main')).forEach(b=>b.onclick=()=>openSource(b.dataset.source));
 $$('[data-spread]',$('#main')).forEach(b=>b.onclick=()=>navigate('reader',+b.dataset.spread));
 $('#zoom-out').onclick=()=>setReaderZoom(state.readerZoom/1.35);$('#zoom-in').onclick=()=>setReaderZoom(state.readerZoom*1.35);$('#zoom-reset').onclick=()=>setReaderZoom(1);if($('#focus-scene'))$('#focus-scene').onclick=()=>focusScene();
 if($('#close-anchor'))$('#close-anchor').onclick=()=>selectAnchor(null);
 if($('#show-more-links'))$('#show-more-links').onclick=()=>{state.showAllLinks=true;renderReader();};
 if($('#edit-anchor'))$('#edit-anchor').onclick=()=>openAnchorEditor(active);
 if($('#draw-start'))$('#draw-start').onclick=()=>{state.draw=true;state.anchor=null;state.draftRegions=[];state.redrawId=null;renderReader();};
 if($('#whole-page'))$('#whole-page').onclick=()=>chooseWholePage(pages);
 if($('#draw-cancel'))$('#draw-cancel').onclick=()=>{state.draw=false;state.draftRegions=[];state.redrawId=null;renderReader();};
 if($('#draw-finish'))$('#draw-finish').onclick=()=>openAnchorEditor(null,state.draftRegions);
 if(state.draw)attachDrawing();
 requestAnimationFrame(()=>{const strip=$('.filmstrip'),current=$('.film.current');if(strip&&current)strip.scrollLeft=current.offsetLeft-strip.offsetLeft-strip.clientWidth/2+current.clientWidth/2;fitComicPages();drawConnections();});
 $$('.comic-page>img').forEach(img=>img.onload=()=>{fitComicPages();drawConnections();});
}
function fitComicPages(){
 if(state.view!=='reader')return;const stage=$('.comic-stage');if(!stage)return;const count=$$('.comic-page').length;const w=stage.clientWidth-44;const h=stage.clientHeight-44;const base=Math.max(40,Math.min((w-(count-1)*3)/count,h*852/1068));const pageWidth=base*state.readerZoom;stage.classList.toggle('zoomed',state.readerZoom>1);const spread=$('.comic-spread');spread.style.width=(pageWidth*count+3*(count-1)+44)+'px';spread.style.height=(pageWidth*1068/852+44)+'px';$$('.comic-page').forEach(p=>{p.style.width=pageWidth+'px';p.style.height=(pageWidth*1068/852)+'px';p.style.flex='0 0 '+pageWidth+'px';});
}
function setReaderZoom(value){state.readerZoom=Math.min(4,Math.max(1,value));fitComicPages();const button=$('#zoom-reset');if(button)button.textContent=Math.round(state.readerZoom*100)+'%';requestAnimationFrame(drawConnections);}
function focusScene(){const a=anchorById.get(state.anchor);if(!a)return;let r=a.regions.find(r=>spreads[state.spread].pageIds.includes(r.page));if(!r)return;const same=a.regions.filter(x=>x.page===r.page);const x=Math.min(...same.map(x=>x.rect[0])),y=Math.min(...same.map(x=>x.rect[1])),right=Math.max(...same.map(x=>x.rect[0]+x.rect[2])),bottom=Math.max(...same.map(x=>x.rect[1]+x.rect[3]));r={...r,rect:[x,y,right-x,bottom-y]};setReaderZoom(Math.min(4,Math.max(1.35,.75/Math.max(r.rect[2],r.rect[3]))));requestAnimationFrame(()=>{const stage=$('.comic-stage'),p=$('.comic-page[data-page="'+r.page+'"]');const sb=stage.getBoundingClientRect(),pb=p.getBoundingClientRect();stage.scrollLeft+=pb.left-sb.left+(r.rect[0]+r.rect[2]/2)*pb.width-stage.clientWidth/2;stage.scrollTop+=pb.top-sb.top+(r.rect[1]+r.rect[3]/2)*pb.height-stage.clientHeight/2;drawConnections();});}

function renderRail(active,ons){
 if(!active)return `<div class="rail-intro"><p class="eyebrow">BEHIND THE SCENE</p><h2>이 장면의<br>이전에는.</h2><p>${ons.length?'표시가 있는 부분을 눌러보세요.<br>일기, 회상, 제작 중의 대화를 따라갈 수 있습니다.':'아직 연결한 기록이 없는 페이지예요.<br>이 장면에 관한 기억도 차차 보태집니다.'}</p><div class="anchor-list">${ons.map((a,i)=>`<button class="anchor-choice" data-anchor="${esc(a.id)}"><span class="index">${String(i+1).padStart(2,'0')}</span><span>${esc(a.title)}<small class="micro" style="display:block">${visibleLinks(a).length}개의 관련 기록${isCandidate(a)?' · 연결 검토 중':''}</small></span></button>`).join('')}</div>${state.editing?'<p class="editor-note">위의 ‘영역 지정’으로 컷을 고른 뒤 기록을 연결할 수 있어요.</p>':''}</div>`;
 const links=visibleLinks(active);const visible=state.showAllLinks?links:links.slice(0,3);
 return `<div class="rail-title"><div><p class="eyebrow">SELECTED SCENE</p><h2>${esc(active.title)}</h2><p>${regionPageIds(active).map(getPageNumber).join('·')}쪽 · ${links.length}개의 관련 기록</p><button class="text-button" id="focus-scene">선택한 장면 크게 보기 ↗</button></div><button id="close-anchor" aria-label="장면 선택 해제">×</button></div>${visible.map((l,i)=>recordCard(sourceById.get(l.sourceId),l,i)).join('')}${links.length>3&&!state.showAllLinks?`<button id="show-more-links" class="more-sources">관련 기록 ${links.length-3}개 더 보기</button>`:''}${!links.length?'<p class="micro">연결할 기록을 보태 주세요.</p>':''}${state.editing?'<button class="rail-add" id="edit-anchor">이 장면의 영역·연결 편집</button>':''}`;
}
function recordCard(s,l,i,full=false){if(!s)return '';const changed=author.sourcePatches[s.id]?.content!==undefined&&!s.content.includes(l.sourceExcerpt||l.publicQuote||'');const text=l.publicQuoteIsRedacted?l.publicQuote:changed?sourceText(s):(l.publicQuote||l.sourceExcerpt||sourceText(s));return `<article class="record-card" data-link-index="${i}"><div class="card-top"><span class="source-kind">${esc(TYPES[s.sourceType]||'기록')}</span><span class="status ${l.status==='candidate'?'candidate':''}">${esc(statusLabel(l))}</span></div><h3>${esc(sourceTitle(s))}</h3>${sourceStatusHtml(s)}${s.image?`<img src="${esc(s.image)}" alt="연결된 일기 원본" loading="lazy">`:''}<p class="excerpt">${esc(full?text:compact(text,245))}</p><div class="relation">${esc(niceRelation(l))}${l.note?'<br>'+esc(full?l.note:compact(l.note,95)):''}</div><button class="text-button" data-source="${esc(s.id)}">기록 펼쳐보기 ↗</button></article>`;}
function selectAnchor(id){state.anchor=id;state.showAllLinks=false;const h='#page/'+spreads[state.spread].pageIds[0]+(id?'/'+encodeURIComponent(id):'');history.replaceState(null,'',h);renderReader();}
function moveSpread(delta){const i=state.spread+delta;if(i>=0&&i<spreads.length)navigate('reader',i);}
function drawConnections(){
 const svg=$('.reader-connections');if(!svg)return;svg.innerHTML='';if(!state.anchor||window.innerWidth<=760||state.draw)return;
 const body=$('.reader-body').getBoundingClientRect();const a=anchorById.get(state.anchor);if(!a)return;
 visibleLinks(a).slice(0,state.showAllLinks?100:3).forEach((link,i)=>{const card=$(`[data-link-index="${i}"]`);if(!card)return;let r=a.regions.find(r=>(!link.regionIds?.length||link.regionIds.includes(r.id))&&spreads[state.spread].pageIds.includes(r.page))||a.regions.find(r=>spreads[state.spread].pageIds.includes(r.page));if(!r)return;const p=$('.comic-page[data-page="'+r.page+'"]').getBoundingClientRect();const c=card.getBoundingClientRect();const x1=p.left-body.left+(r.rect[0]+r.rect[2])*p.width,y1=p.top-body.top+(r.rect[1]+r.rect[3]/2)*p.height,x2=c.left-body.left,y2=c.top-body.top+30;if(y2>body.height||y2<0)return;const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M${x1},${y1} C${x1+24},${y1} ${x2-28},${y2} ${x2},${y2}`);if(link.status!=='confirmed')path.setAttribute('stroke-dasharray','4 5');svg.append(path);});
}
function openSource(id){
 const s=sourceById.get(id);if(!s)return;const connected=anchorsForSource(id);const d=$('#source-dialog');
 d.innerHTML=`<button class="close" data-close aria-label="기록 닫기">×</button><p class="eyebrow">${esc(TYPES[s.sourceType]||'기록')}</p><h2 id="source-heading">${esc(sourceTitle(s))}</h2>${sourceStatusHtml(s)}${publicOverrides.has(id)?'<p class="micro">이 화면에는 지명 등을 덜어낸 발췌문을 보여줍니다.</p>':''}<p class="micro">${esc(dateLabel(s))}${s.eventDate?' · 기억 속 시기 '+esc(s.eventDate):''}${s.speaker?' · 말한 사람 '+esc(s.speaker):''}${s.userCorrected?' · 작가가 판독을 교정한 기록':''}</p><div class="source-detail ${s.image?'':'no-image'}">${s.image?`<a href="${esc(s.image)}" target="_blank" rel="noopener" aria-label="일기 원본 크게 보기"><img src="${esc(s.image)}" alt="일기 원본 이미지"></a>`:''}<div><div class="full-text">${esc(sourceText(s))}</div>${!publicOverrides.has(id)?`<p class="micro">${esc(s.locator||'')}</p>`:''}</div></div>${(s.notes||[]).length&&!publicOverrides.has(id)?`<details class="source-notes"><summary>기록에 관한 메모</summary>${s.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</details>`:''}<div class="linked-scenes"><h3>이 기록과 연결된 장면 · ${connected.length}</h3><div class="scene-links">${connected.map(a=>{const p=pageById.get(a.regions[0].page);const l=visibleLinks(a).find(l=>l.sourceId===id);return `<button class="scene-link" data-go-anchor="${esc(a.id)}"><img src="${esc(p.thumb)}" alt="${p.number}쪽"><span>${esc(a.title)}</span><small>${p.number}쪽 · ${esc(statusLabel(l))}</small></button>`;}).join('')||'<p class="micro">아직 특정 장면에 연결하지 않은 기록입니다.</p>'}</div></div><div class="button-row" style="margin-top:23px">${connected.length?'<button class="primary" id="source-on-book">책 전체에서 위치 보기</button>':''}${state.editing?'<button id="source-edit">기록 내용 수정</button>':''}<button id="source-id-copy" class="text-button">기록 ID 복사</button></div>`;
 bindClose(d);$$('[data-go-anchor]',d).forEach(b=>b.onclick=()=>{d.close();goAnchor(b.dataset.goAnchor);});if($('#source-on-book'))$('#source-on-book').onclick=()=>{d.close();state.sourceFocus=id;canvasSourceFit=id;canvasSelection=null;navigate('book');};if($('#source-edit'))$('#source-edit').onclick=()=>{d.close();openOral(s);};$('#source-id-copy').onclick=()=>{navigator.clipboard?.writeText(id).then(()=>toast('기록 ID를 복사했어요.'),()=>toast(id));};if(!d.open)d.showModal();
}
function bindClose(d){$$('[data-close]',d).forEach(b=>b.onclick=()=>d.close());d.onclick=e=>{if(e.target===d&&e.offsetX>=0&&e.offsetY>=0){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}};}
function openOral(existing=null){
 const d=$('#edit-dialog');const editing=!!existing;
 d.innerHTML=`<button class="close" data-close aria-label="닫기">×</button><p class="eyebrow">A MEMORY, ADDED</p><h2 id="edit-heading">${editing?'기록 내용 수정':'구술·회상 보태기'}</h2><p>${editing?'수정 전 자료는 그대로 두고, 이 지도에 적용할 교정을 저장합니다.':'지금 떠오르는 이야기나 나중에 함께 나눈 구술을 남겨두세요.<br>페이지를 아직 정하지 않아도 기록부터 보관할 수 있습니다.'}</p><form id="oral-form"><label class="form-field">짧은 제목<input id="oral-title" value="${esc(existing?.title||'')}" placeholder="예: 처음 혼자 조리했던 날" maxlength="150" required></label><div class="form-grid"><label class="form-field">기록 종류<select id="oral-type">${Object.entries(TYPES).filter(([k])=>['oral_recollection','author_note','ai_proposal'].includes(k)||k===existing?.sourceType).map(([k,t])=>`<option value="${k}" ${(existing?.sourceType||'oral_recollection')===k?'selected':''}>${t}</option>`).join('')}</select></label><label class="form-field">구술·기록한 날<input type="date" id="oral-date" value="${esc(existing?.recordedAt||today())}"></label></div><label class="form-field">기억 속 시기 <span class="muted">· 선택</span><input id="oral-event" value="${esc(existing?.eventDate||'')}" placeholder="정확한 날짜를 몰라도 괜찮아요"></label><label class="form-field">이야기<textarea id="oral-content" required placeholder="기억나는 말 그대로 적어주세요.">${esc(existing?.content||'')}</textarea></label><label class="form-field">누가 말한 내용인가<input id="oral-speaker" value="${esc(existing?.speaker||(existing?.sourceType==='ai_proposal'?'AI':'작가'))}"></label><label class="form-field">덧붙일 메모 <span class="muted">· 선택</span><input id="oral-note" value="${esc(existing?.oralNote||'')}" placeholder="확실하지 않은 부분, 대화나 녹음의 위치 등"></label><div class="button-row"><button type="button" data-close>취소</button><button type="submit" class="primary">${editing?'수정 기록 저장':'새 기록 보관'}</button></div></form>`;
 bindClose(d);$('#oral-form').onsubmit=async e=>{e.preventDefault();const btn=$('button[type=submit]',d);btn.disabled=true;const type=$('#oral-type').value;const value={title:$('#oral-title').value.trim(),content:$('#oral-content').value.trim(),sourceType:type,summary:compact($('#oral-content').value,130),recordedAt:$('#oral-date').value,eventDate:$('#oral-event').value.trim(),speaker:$('#oral-speaker').value.trim(),oralNote:$('#oral-note').value.trim(),updatedAt:new Date().toISOString()};if(!value.title||!value.content){btn.disabled=false;return;}
 if(existing)author.sourcePatches[existing.id]={...(author.sourcePatches[existing.id]||{}),...value};else author.sources.push({id:uid('oral'),kind:'source',status:'documented',date:value.recordedAt,dateKind:'recorded',episodeIds:[],recordClass:type==='ai_proposal'?'ai_proposal':'author_recollection',...value});
 rebuild();await persist();d.close();render();toast(editing?'수정한 내용을 저장했어요.':'새 기록을 보관했어요. 편집에서 장면과 연결할 수 있어요.');};d.showModal();
}
function chooseWholePage(pages){state.redrawId=null;if(pages.length===1){openAnchorEditor(null,[{id:uid('region'),page:pages[0].id,rect:[0,0,1,1],label:'페이지 전체'}]);return;}const d=$('#edit-dialog');d.innerHTML=`<button class="close" data-close aria-label="닫기">×</button><h2 id="edit-heading">연결할 페이지</h2><p>페이지 전체나 펼침면 전체를 하나의 장면으로 묶을 수 있어요.</p><div class="button-row">${pages.map(p=>`<button data-whole-page="${p.id}">${p.number}쪽 전체</button>`).join('')}<button id="whole-spread" class="primary">두 쪽 함께</button></div>`;bindClose(d);$$('[data-whole-page]',d).forEach(b=>b.onclick=()=>{d.close();openAnchorEditor(null,[{id:uid('region'),page:b.dataset.wholePage,rect:[0,0,1,1],label:'페이지 전체'}]);});$('#whole-spread').onclick=()=>{d.close();openAnchorEditor(null,pages.map(p=>({id:uid('region'),page:p.id,rect:[0,0,1,1],label:'페이지 전체'})));};d.showModal();}
function attachDrawing(){
 $$('.comic-page svg').forEach(svg=>{let start=null,temp=null;const point=e=>{const r=svg.getBoundingClientRect();return [Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))];};
 svg.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();start=point(e);svg.setPointerCapture(e.pointerId);temp=document.createElementNS('http://www.w3.org/2000/svg','rect');temp.setAttribute('class','draft-rect');svg.append(temp);};
 svg.onpointermove=e=>{if(!start)return;const p=point(e);temp.setAttribute('x',Math.min(start[0],p[0])*1000);temp.setAttribute('y',Math.min(start[1],p[1])*1253.52);temp.setAttribute('width',Math.abs(p[0]-start[0])*1000);temp.setAttribute('height',Math.abs(p[1]-start[1])*1253.52);};
 svg.onpointerup=e=>{if(!start)return;const p=point(e);const rect=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.abs(p[0]-start[0]),Math.abs(p[1]-start[1])].map(v=>Math.round(v*10000)/10000);start=null;if(rect[2]>.012&&rect[3]>.012){state.draftRegions.push({id:uid('region'),page:svg.dataset.page,rect,label:'직접 지정한 영역'});}renderReader();};
 svg.onpointercancel=()=>{start=null;temp?.remove();};
 });
}
function openAnchorEditor(existing=null,draft=null){
 const regs=clone(existing?.regions||draft||[]);if(state.redrawId){const old=anchorById.get(state.redrawId);if(old?.links.some(l=>l.regionIds?.length)&&old.regions.length!==regs.length){toast('일부 영역에만 연결된 기록이 있어요. 기존 '+old.regions.length+'개 영역을 같은 순서로 다시 지정해 주세요.');return;}}if(state.redrawId){const old=anchorById.get(state.redrawId);if(old&&old.regions.length===regs.length){regs.forEach((r,i)=>r.id=old.regions[i].id);}}const selected=new Map((existing?.links||[]).map(l=>[l.sourceId,clone(l)]));const d=$('#edit-dialog');
 d.innerHTML=`<button class="close" data-close aria-label="닫기">×</button><p class="eyebrow">CONNECT A SCENE</p><h2 id="edit-heading">${existing?'장면의 연결 편집':'장면과 기록 연결하기'}</h2><div class="region-summary">${[...new Set(regs.map(r=>getPageNumber(r.page)))].join('·')}쪽 · ${regs.length}개의 영역을 함께 연결합니다.</div><form id="anchor-form"><label class="form-field">장면 이름<input id="anchor-title" required maxlength="150" value="${esc(existing?.title||'')}" placeholder="예: 만능소스를 적어둔 메모"></label><label class="form-field">연결할 기록 찾기<input id="pick-search" type="search" placeholder="제목, 단어, 기록 ID로 검색"></label><div class="source-picker" id="source-picker"></div><div class="edit-links" id="edit-links"></div><label class="form-field">이 장면에 관한 메모<input id="anchor-note" value="${esc(existing?.authorNote||'')}" placeholder="선택한 이유, 다음에 확인할 내용 등"></label><div class="button-row">${existing?'<button type="button" id="redraw-anchor">영역 다시 지정</button>':''}<button type="button" data-close>취소</button><button type="submit" class="primary">연결 저장</button></div></form>`;
 const picker=()=>{const q=$('#pick-search').value.toLowerCase();const found=sources.filter(s=>!q||[s.id,sourceTitle(s),sourceText(s)].join(' ').toLowerCase().includes(q)).sort((a,b)=>Number(selected.has(b.id))-Number(selected.has(a.id))||Number(b.sourceType==='oral_recollection')-Number(a.sourceType==='oral_recollection')).slice(0,45);$('#source-picker').innerHTML=found.map(s=>`<label class="pick-row"><input type="checkbox" data-pick="${esc(s.id)}" ${selected.has(s.id)?'checked':''}><span>${esc(sourceTitle(s))}<small>${esc(TYPES[s.sourceType]||'기록')} · ${esc(compact(sourceText(s),75))}</small></span></label>`).join('')||'<p class="empty">해당하는 기록이 없습니다.</p>';$$('[data-pick]',d).forEach(c=>c.onchange=()=>{if(c.checked)selected.set(c.dataset.pick,{sourceId:c.dataset.pick,relation:'reference',status:'candidate',basis:'author_added',note:''});else selected.delete(c.dataset.pick);linkEditor();});};
 const linkEditor=()=>{$('#edit-links').innerHTML=[...selected.values()].map(l=>`<div class="edit-link" data-edit-link="${esc(l.sourceId)}"><span>${esc(sourceTitle(sourceById.get(l.sourceId)))}</span><button type="button" class="unlink" data-unlink="${esc(l.sourceId)}">연결 빼기</button><select aria-label="${esc(sourceTitle(sourceById.get(l.sourceId)))} 연결 상태" data-link-status="${esc(l.sourceId)}"><option value="candidate" ${l.status==='candidate'?'selected':''}>연결 검토 중</option><option value="confirmed" ${l.status==='confirmed'?'selected':''}>내가 이 연결을 확인함</option><option value="rejected" ${l.status==='rejected'?'selected':''}>사용하지 않은 연결</option></select><input data-link-relation="${esc(l.sourceId)}" aria-label="연결 설명" value="${esc(niceRelation(l))}" placeholder="어떻게 사용했는지 짧게 설명"><input data-link-note="${esc(l.sourceId)}" aria-label="연결 근거와 메모" value="${esc(l.note||'')}" placeholder="연결 근거, 사용한 부분 등을 적어주세요"></div>`).join('');$$('[data-link-status]',d).forEach(e=>e.onchange=()=>{const l=selected.get(e.dataset.linkStatus);l.status=e.value;if(e.value==='confirmed')l.basis='author_confirmed';});$$('[data-link-relation]',d).forEach(e=>e.oninput=()=>selected.get(e.dataset.linkRelation).relation=e.value);$$('[data-link-note]',d).forEach(e=>e.oninput=()=>selected.get(e.dataset.linkNote).note=e.value);$$('[data-unlink]',d).forEach(e=>e.onclick=()=>{selected.delete(e.dataset.unlink);picker();linkEditor();});};
 $('#pick-search').oninput=picker;picker();linkEditor();bindClose(d);
 if($('#redraw-anchor'))$('#redraw-anchor').onclick=()=>{d.close();state.draw=true;state.draftRegions=[];state.anchor=null;state.redrawId=existing.id;renderReader();};
 $('#anchor-form').onsubmit=async e=>{e.preventDefault();if(!selected.size){toast('연결할 기록을 하나 이상 골라주세요.');return;}const title=$('#anchor-title').value.trim();if(!title)return;const button=$('button[type=submit]',d);button.disabled=true;const id=existing?.id||state.redrawId||uid('scene');const val={id,title,page:regs[0].page,pdfPage:getPageNumber(regs[0].page),regions:regs,links:[...selected.values()],sourceIds:[...selected.keys()],authorNote:$('#anchor-note').value.trim(),bookHash:B.book.sourceHash,updatedAt:new Date().toISOString()};
 if(existing||state.redrawId)author.anchorPatches[id]={...(author.anchorPatches[id]||{}),...val};else author.anchors.push(val);
 state.redrawId=null;state.draw=false;state.draftRegions=[];rebuild();await persist();d.close();goAnchor(id);toast('장면과 기록의 연결을 저장했어요.');};
 if(state.redrawId&&!existing){const old=anchorById.get(state.redrawId);if(old){$('#anchor-title').value=old.title;$('#anchor-note').value=old.authorNote||'';for(const l of old.links){const c=clone(l);selected.set(l.sourceId,c);}picker();linkEditor();}}
 d.showModal();
}
function validateImport(data){
 if(data.bookHash&&data.bookHash!==B.book.sourceHash)throw Error('다른 PDF 판본의 기록입니다. 페이지와 영역을 먼저 확인해 주세요.');
 const v=data.state||data;if(!v||typeof v!=='object')throw Error('기록 파일 형식을 확인해 주세요.');if(v.bookHash&&v.bookHash!==B.book.sourceHash)throw Error('다른 PDF 판본의 기록입니다.');if(v.schemaVersion!==1||!Array.isArray(v.sources)||!Array.isArray(v.anchors)||!v.sourcePatches||Array.isArray(v.sourcePatches)||typeof v.sourcePatches!=='object'||!v.anchorPatches||Array.isArray(v.anchorPatches)||typeof v.anchorPatches!=='object')throw Error('기록 파일 형식을 확인해 주세요.');
 if((v.anchors.length||Object.keys(v.anchorPatches).length)&&!(data.bookHash||v.bookHash))throw Error('PDF 판본 정보가 없는 컷 연결은 먼저 확인이 필요합니다.');
 for(const key of ['sources','anchors'])if(v[key].some(x=>!x||typeof x!=='object'||typeof x.id!=='string')||new Set(v[key].map(x=>x.id)).size!==v[key].length)throw Error('기록 ID가 없거나 중복됩니다.');
 for(const key of ['sourcePatches','anchorPatches'])if(Object.values(v[key]).some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('수정 데이터 형식을 확인해 주세요.');
 for(const a of v.anchors)if(!Array.isArray(a.regions)||!a.regions.length)throw Error('장면에는 한 개 이상의 영역이 필요합니다.');
 const ids=new Set([...sources.map(s=>s.id),...v.sources.map(s=>s.id)]);
 for(const a of [...v.anchors,...Object.values(v.anchorPatches)]){if('regions'in a&&(!Array.isArray(a.regions)||!a.regions.length))throw Error('영역을 확인해 주세요.');if('links'in a&&!Array.isArray(a.links))throw Error('연결을 확인해 주세요.');for(const r of a.regions||[]){if(!r||typeof r!=='object'||!pageById.has(r.page)||!Array.isArray(r.rect)||r.rect.length!==4||!r.rect.every(Number.isFinite)||r.rect[0]<0||r.rect[1]<0||r.rect[2]<=0||r.rect[3]<=0||r.rect[0]+r.rect[2]>1.001||r.rect[1]+r.rect[3]>1.001)throw Error('장면의 페이지·좌표를 확인해 주세요.');}for(const l of a.links||[])if(!l||!ids.has(l.sourceId)||!['confirmed','candidate','rejected'].includes(l.status))throw Error('연결할 원자료 또는 상태를 확인해 주세요.');}
 return v;
}
async function importAuthor(file){try{const data=JSON.parse(await file.text());const v=validateImport(data);const incoming=clone(author);let conflicts=0;for(const key of ['sources','anchors']){const m=new Map(incoming[key].map(r=>[r.id,r]));for(const r of v[key]){if(m.has(r.id)&&JSON.stringify(m.get(r.id))!==JSON.stringify(r)){conflicts++;continue;}m.set(r.id,r);}incoming[key]=[...m.values()];}for(const key of ['sourcePatches','anchorPatches'])for(const[id,p]of Object.entries(v[key])){if(incoming[key][id]&&JSON.stringify(incoming[key][id])!==JSON.stringify(p)){conflicts++;continue;}incoming[key][id]=p;}
 if(conflicts){toast('같은 ID의 다른 수정 '+conflicts+'개가 있어 가져오지 않았어요. 두 파일을 함께 알려주세요.');return;}author=incoming;rebuild();await persist();$('#help-dialog').close();render();toast('추가 기록과 장면 연결을 가져왔어요.');}catch(e){toast(e.message||'기록 파일을 읽지 못했어요.');}}
window.addEventListener('hashchange',route);window.addEventListener('resize',()=>{fitComicPages();drawConnections();});document.addEventListener('scroll',()=>{if(state.view==='reader')drawConnections();},true);
// 2026-10-03 작가 요청으로 화면의 버튼(편집·구술·도움말·배율·전체 지도·회차 이동)을 전부 없앴다. 기능은 남겨 두고 단축키로만 연다: E 편집, O 구술·회상, ? 도움말·내보내기. 이동·확대는 canvas-engine.js(방향키, +/−, 0=전체 맞춤).
function toggleEditing(){state.editing=!state.editing;state.draw=false;state.draftRegions=[];state.redrawId=null;render();toast(state.editing?'편집 켬 · 쪽을 누르면 영역·연결 편집으로 갑니다 (E로 끔)':'편집 끔');}
document.addEventListener('keydown',e=>{if($('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;if(e.code==='KeyE'){e.preventDefault();toggleEditing();}else if(e.code==='KeyO'){e.preventDefault();openOral();}else if(e.key==='?'){e.preventDefault();$('#help-open').click();}});
document.addEventListener('keydown',e=>{if(state.view==='book'&&e.key==='Escape'&&!$('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){clearCanvasSelection();return;}if(state.view!=='reader'||$('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.key==='ArrowRight'){e.preventDefault();moveSpread(1);}if(e.key==='ArrowLeft'){e.preventDefault();moveSpread(-1);}if(e.key==='Escape'&&state.anchor){selectAnchor(null);}});

$('#help-open').onclick=()=>{const d=$('#help-dialog');const old=$('#restore-pending');if(old)old.remove();if(restorePending){const box=document.createElement('div');box.id='restore-pending';box.className='warning';box.textContent='이전 판본에서 저장한 기록이 남아 있습니다. 현재 자료를 덮어쓰지 않고 별도로 보관했습니다. ';const b=document.createElement('button');b.textContent='이전 추가 기록 내보내기';b.onclick=()=>exportFile({schemaVersion:1,bookHash:restorePending.state.bookHash||restorePending.bookHash,state:restorePending.state},'소미도_이전추가기록_'+today()+'.json');box.append(b);d.append(box);}d.showModal();};bindClose($('#help-dialog'));$('#export-author').onclick=exportAuthor;$('#import-author').onchange=e=>{if(e.target.files[0])importAuthor(e.target.files[0]);e.target.value='';};
init();
})();
