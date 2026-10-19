// 소미도 벽 — '다른 쪽으로 가는 화살표'(cross route) 길찾기. app.js에 그대로 붙여 넣을 수 있는 순수 JS 한 덩어리.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 쓰는 법:  const { routes, stats } = routeCrossArrows({ W, H, cards, pages, labels, zoneSegs, goals }, opts)
//   cards/pages : [{x,y,w,h}]        카드·만화 쪽 상자(선이 못 지나감, 8px 여유)
//   labels      : [{x,y,w,h,cross}]  cross=false(쪽 안 문구)만 장애물(4px 여유). cross=true(선 위 '바뀐 점' 문구)는 선을 따라 다시 놓는 것이라 무시
//   zoneSegs    : [{n:[x1,y1,x2,y2]}] 쪽 안의 짧은 선(그 위로 지나가면 약한 벌점)
//   goals       : [{a:{x,y}, bx, by, dir:'left'|'top', comicP:{x,y,w,h}|null}]
//                 a = 출발 카드 오른쪽 가장자리 점, (bx,by) = 목표점, dir = 들어가는 방향, comicP = 목표가 만화 쪽이면 그 쪽 상자
//   반환 routes[i] = [{x,y},...] (goals와 같은 순서, 가로·세로 직선만, 첫 점 = a, 끝 점 = (bx,by))
//
// 무엇을 하나 — 세 방법의 생각을 한 길찾기 안에 합쳤다(실험 폴더 v_combined, 단계별 비교는 results.json).
//   1) 협상식 혼잡 재배선(방법 A, PathFinder): 다 그은 뒤 다툼이 남은 화살표만 뜯어서 다시 긋기를 몇 번 한다.
//      다시 그을 때 '지금 남이 쓰는 칸'과 '지난 회들에 다툼이 있던 칸(이력)'의 값을 올려, 꼭 필요한 선만 그 자리에 남게 한다.
//      다툼 = 다른 출발 카드의 선과 (a) 같은 칸 같은 축(포개짐) (b) 같은 축으로 나란히 가까이(다발) (c) 직각으로 건넘(교차).
//      → 조합 중 효과의 거의 전부가 여기서 나온다(다발 점수 crowd 173k → 약 33k).
//   2) 줄기 묶기(방법 C): 한 출발 카드의 화살표들은 나무 하나. 다음 가지는 같은 카드의 이미 그은 줄기에서 뻗을 수 있다.
//      카드 순서는 화살표 많은 카드부터(큰 나무가 길을 먼저 잡고 작은 것이 비켜 감), 카드 안에서는 지금 나무에서 가까운 목표부터.
//      → 재배선 안에서는 보탬이 작다(총길이 −2%, 포개짐 절반, 다발은 잡음 범위). 코드가 몇 줄뿐이라 남겼다.
//   3) 가장자리·벽 테두리 붙음 벌점: 카드·쪽·벽 테두리에서 30px 안쪽 칸은 가까울수록 비싸게.
//   (방법 B '줄 간격 벌리기'는 넣지 않았다 — 이 길찾기 뒤에 붙이면 다발이 30~50px로 옮겨 갈 뿐 점수는 같거나 나빠졌다. results.json의 '+B' 행)
//
// 방법 A 검증에서 나온 문제를 고친 곳(왜 이렇게 했는지):
//   • '이웃 평행' 벌점을 거리에 따라 매끄럽게 줄어드는 모양(선형, 60px에서 0)으로 바꿨다. 예전엔 20px·40px 두 계단이라
//      (i) 10px 격자에서 10px 이웃과 20px 이웃이 같은 값 → 10px 이중선 (ii) 40px까지만 벌점 → 다발이 정확히 50px로 옮겨 갔다.
//      계단이 있으면 선이 늘 '계단 바로 바깥'으로 간다. 매끄러우면 중간 계단에 쌓이지는 않지만, 벌점이 0이 되는 60px에는
//      여전히 쌓인다(KEXP 주석 참고 — 60px는 벽 전체 배율에서 따로 보이는 간격이라 받아들임). 10px 이웃은 따로 더 세게(K10배).
//   • 가장자리 벌점도 16px 띠 하나 → 거리에 따라 줄어드는 모양. 예전엔 띠 바로 바깥(17~26px)으로 밀려났을 뿐이었다.
//   • 벽 테두리도 가장자리로 친다(줄기 묶기·재배선 모두 벽 맨 위·왼쪽 끝을 수천 px 달리는 선이 생겼었다).
//   • 격자를 10px → 20px(앱 원본과 같은 칸)으로 되돌리고 협상 회수를 3 → 6으로. 같은 시간이면 20px×6회가 10px×3회보다
//      다발 점수가 낮았다(33k vs 44k, 10px는 약 2초). 10px는 한 회가 4배 비싸서 2초 안에 협상이 덜 끝난다.
//   • 화살표마다 탐색 상자를 따로(출발~목표 거리에 비례). 협상을 오래 돌리면 짧은 화살표가 혼잡을 피해 크게 도는 일이 생겼다.
'use strict';

const ROUTER_DEFAULTS = {
  S: 20,          // 격자 칸(px). 10이면 한 회가 4배 비싸 2초 안에 3회밖에 못 돌고, 그러면 20px×6회보다 다발이 더 남는다
  ITERS: 6,       // 협상 회수(0회차 = 처음 긋기 포함). 20px 격자 한 회 ≈ 0.15~0.2초. 8회로 늘려도 나아지지 않았다(잡음 범위)
  FULL: 1,        // 처음 몇 회는 전부 새로, 그 뒤엔 다툼 남은 화살표만(같은 카드 안에서 한꺼번에)
  BEND: 45,       // 꺾임 한 번. 30이면 다발은 같고 꺾임 +12%(계단 모양 우회), 60이면 꺾임은 −3%뿐인데 다발 +23%
  PX: 35,         // 남의 선을 직각으로 건넘 한 번
  PO: 8,          // 남의 선과 같은 칸 같은 축(20px당). 회마다 ×PFMUL, 상한 PFMAX배
  PA: 2,          // 남의 선과 20px 간격 평행(20px당). 거리 d에서 PA×(NEARD−d)/(NEARD−20), 10px 이하면 ×K10
  NEARD: 60,      // 이웃 평행 벌점이 0이 되는 거리
  KEXP: 1,        // 벌점 모양 지수(1=선형). 대가: 벌점이 0이 되는 60px에 다발이 쌓인다(60px 간격 = 벽 전체 0.08배율에서 약 5px라 따로 보임).
                  //   NEARD 100·KEXP 2(꼬리를 길고 약하게)는 그 더미를 60~100px로 흩고 화면 뭉침·교차가 조금 낫지만,
                  //   60px 안쪽 다발 +16%·가장자리 +7%·T자 접합 2.5배였다(results.json '대안' 행). 어느 쪽도 뚜렷이 낫지 않아 단순한 쪽을 둠
  K10: 2,         // 10px 이웃 추가 배율(화면에서 사실상 한 줄)
  PAMAX: 10,      // 이웃 평행 벌점 상한(20px 기준). 끝없이 올리면 한두 칸 나란히 가는 걸 피하려고 지그재그·먼 우회를 한다
  HUG: 2,         // 카드·쪽 가장자리 붙음(20px당, 8px 거리에서 최대, HUGR에서 0)
  HUGR: 30,
  WALLHUG: 4,     // 벽 테두리 붙음(같은 모양, 벽에서 10px가 최대). 2면 벽 끝을 달리는 선 7.6k px, 4면 3.9k(기준 6.0k)
  SOFT: 2,        // 쪽 안 선 위
  PF0: 1, PFMUL: 1.6, PFMAX: 100,
  HO: 2, HA: 0.5, // 이력 증가량(겹침 / 가까운 이웃)
  BADPX: 20,      // 이 거리 안에 남의 평행선이 있으면 '다툼 남은 화살표'로 보고 다시 긋는다
  ALPHA: 0.3,     // 자기 나무 줄기에서 갈라질 때 줄기 길이 × ALPHA를 시작 비용으로(0=줄기 공짜 → 최대 묶음이지만 반대 방향으로 갔다 오는 우회가 생김)
  PAD: 600,       // 탐색 상자 여유(px, 출발 카드 전체 상자 기준)
  PADF: 0.35,     // 화살표 하나의 탐색 상자 여유 = 출발~목표 맨해튼 거리 × PADF (PADMIN~PAD 사이).
  PADMIN: 200,    //   짧은 화살표가 혼잡을 피하려고 크게 돌아가는 것을 막는다(이것 없이 8회 돌리면 길이 3.8배가 된 화살표가 나왔다)
  ORDER: 'many',  // 출발 카드 순서: 'many'(화살표 많은 카드 먼저) | 'short'(짧은 것 먼저)
  GOALORD: 'dyn', // 카드 안 순서: 'dyn'(지금 나무에서 가까운 목표 먼저) | 'near'
  TURNMAP: true,  // 꺾임 수 하한 지도(탐색 가속. 최단 값은 같지만 동점 처리가 달라져 끄면 경로가 여럿 바뀐다)
  WALLM: 10,      // 벽 가장자리에서 이만큼 안쪽만 다님
  M: 8,           // 카드·쪽 여유
};

function routeCrossArrows(input, opts) {
  const o = Object.assign({}, ROUTER_DEFAULTS, opts || {});
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
  const t0 = now();
  const S = o.S, unit = S / 20, M = o.M;
  const BEND = o.BEND, PX = o.PX, SOFT = o.SOFT * unit, PO = o.PO * unit;
  const PFMUL = o.PFMUL, PFMAX = o.PFMAX, HO = o.HO * unit, HA = o.HA * unit, ALPHA = o.ALPHA;
  const PAD = Math.round(o.PAD / S);
  const { W, H } = input;

  // ── 격자: hard(못 지나감) / base(칸 기본값 = 길이 + 쪽 안 선 + 가장자리 붙음)
  const nx = Math.ceil(W / S) + 2, ny = Math.ceil(H / S) + 2, NC = nx * ny;
  const hard = new Uint8Array(NC), soft = new Uint8Array(NC);
  const mark = (arr, x, y, w, h, inf) => {
    const c0 = Math.max(0, Math.ceil((x - inf) / S - .5)), c1 = Math.min(nx - 1, Math.floor((x + w + inf) / S - .5));
    const r0 = Math.max(0, Math.ceil((y - inf) / S - .5)), r1 = Math.min(ny - 1, Math.floor((y + h + inf) / S - .5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) arr[r * nx + c] = 1;
  };
  for (const c of input.cards) mark(hard, c.x, c.y, c.w, c.h, M);
  for (const p of input.pages) mark(hard, p.x, p.y, p.w, p.h, M);
  for (const l of input.labels) if (!l.cross) mark(hard, l.x, l.y, l.w, l.h, 4);
  for (const z of input.zoneSegs) { const n = z.n; mark(soft, Math.min(n[0], n[2]), Math.min(n[1], n[3]), Math.abs(n[2] - n[0]), Math.abs(n[3] - n[1]), 4); }
  // 벽 밖 금지: 칸 중심이 벽 가장자리에서 WALLM 안쪽인 칸만 연다(앱 원본 격자는 벽 밖 2칸까지 열려 있었다)
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const x = c * S + S / 2, y = r * S + S / 2; if (x < o.WALLM || y < o.WALLM || x > W - o.WALLM || y > H - o.WALLM) hard[r * nx + c] = 1; }
  // 가장자리 거리 지도: 칸 중심에서 가장 가까운 카드·쪽 가장자리까지(HUGR 안만). 벽 테두리는 따로.
  const HUGR = o.HUGR, hugD = new Float32Array(NC).fill(1e9);
  for (const r of [...input.cards, ...input.pages]) {
    const c0 = Math.max(0, Math.floor((r.x - HUGR) / S)), c1 = Math.min(nx - 1, Math.ceil((r.x + r.w + HUGR) / S));
    const r0 = Math.max(0, Math.floor((r.y - HUGR) / S)), r1 = Math.min(ny - 1, Math.ceil((r.y + r.h + HUGR) / S));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const x = cc * S + S / 2, y = rr * S + S / 2, dx = Math.max(r.x - x, 0, x - r.x - r.w), dy = Math.max(r.y - y, 0, y - r.y - r.h), dd = Math.sqrt(dx * dx + dy * dy);
      const i = rr * nx + cc; if (dd < hugD[i]) hugD[i] = dd;
    }
  }
  const base = new Float32Array(NC);
  const hugAt = (dd, w, d0) => dd >= HUGR ? 0 : w * unit * Math.min(1, (HUGR - dd) / (HUGR - d0));
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c; if (hard[i]) continue;
    const x = c * S + S / 2, y = r * S + S / 2, dw = Math.min(x, y, W - x, H - y);
    base[i] = unit + (soft[i] ? SOFT : 0) + hugAt(hugD[i], o.HUG, M) + hugAt(dw, o.WALLHUG, o.WALLM);
  }

  // ── 이웃 평행 벌점 모양(칸 k개 옆 = k·S px). 매끄럽게 줄어드는 선형 + 10px 이하 추가 배율.
  const R = Math.max(1, Math.ceil(o.NEARD / S) - 1);
  const KF = new Float32Array(R + 1);   // 모양(20px에서 1)
  for (let k = 1; k <= R; k++) { const dpx = k * S; KF[k] = Math.pow(Math.max(0, (o.NEARD - dpx) / (o.NEARD - 20)), o.KEXP) * (dpx <= 10 ? o.K10 : 1); }
  const BADK = Math.max(1, Math.floor(o.BADPX / S));
  const KW = new Float32Array(R + 1);   // 이번 회의 실제 값(배율·상한 반영)

  // 칸×축(0=가로,1=세로) 점유 = 그 칸을 그 축으로 쓰는 출발 카드 수. CA = 기본+이력+겹침+이웃 평행을 미리 합친 값(탐색 안쪽 고리를 가볍게).
  const occ = [new Uint16Array(NC), new Uint16Array(NC)], hist = [new Float32Array(NC), new Float32Array(NC)], CA = [new Float32Array(NC), new Float32Array(NC)];
  let POp = PO;
  const recomputeCA = () => {
    for (let ax = 0; ax < 2; ax++) {
      const ca = CA[ax], h = hist[ax], oc = occ[ax], step = ax === 0 ? nx : 1;
      for (let i = 0; i < NC; i++) ca[i] = base[i] + h[i];
      for (let i = 0; i < NC; i++) { const n = oc[i]; if (!n) continue; ca[i] += n * POp; for (let k = 1; k <= R; k++) { const w = n * KW[k], c1 = i - k * step, c2 = i + k * step; if (c1 >= 0) ca[c1] += w; if (c2 < NC) ca[c2] += w; } }
    }
  };
  const occChange = (cell, ax, sgn) => {
    occ[ax][cell] += sgn; const ca = CA[ax]; ca[cell] += sgn * POp;
    const step = ax === 0 ? nx : 1;
    for (let k = 1; k <= R; k++) { const w = sgn * KW[k], c1 = cell - k * step, c2 = cell + k * step; if (c1 >= 0) ca[c1] += w; if (c2 < NC) ca[c2] += w; }
  };

  // ── 목표·출발 칸(앱 원본 규칙 그대로)
  const goalCell = g => g.dir === 'left'
    ? { c: Math.floor(((g.comicP ? g.comicP.x : g.bx) - M) / S - .5), r: Math.ceil((g.by - S / 2) / S), d: 0 }
    : { c: Math.ceil((g.bx - S / 2) / S), r: Math.floor((g.comicP.y - M) / S - .5), d: 1 };
  const startCell = a => ({ c: Math.floor((a.x + M) / S - .5) + 1, r: Math.ceil((a.y - S / 2) / S), d: 0 });

  const goals = input.goals, bySrc = new Map();
  goals.forEach((g, idx) => { const k = g.a.x + ',' + g.a.y; if (!bySrc.has(k)) bySrc.set(k, []); bySrc.get(k).push({ g, idx }); });
  const srcs = [...bySrc.values()].map(gs => ({ gs, a: gs[0].g.a, len: gs.reduce((n, e) => n + Math.abs(e.g.bx - e.g.a.x) + Math.abs(e.g.by - e.g.a.y), 0) }));
  if (o.ORDER === 'many') srcs.sort((x, y) => y.gs.length - x.gs.length || x.len - y.len);
  else srcs.sort((x, y) => x.len - y.len);
  const COL = new Int32Array(NC), ROW = new Int32Array(NC); for (let i = 0; i < NC; i++) { COL[i] = i % nx; ROW[i] = (i / nx) | 0; }
  srcs.forEach(s => {
    s.start = startCell(s.a); s.mult = new Map(); s.lifted = false;
    s.arrows = s.gs.map(e => { const gc = goalCell(e.g); return { s, g: e.g, idx: e.idx, gc, gaxis: e.g.dir === 'left' ? 0 : 1, path: null, keys: [], bad: true, tm: null, box: null }; });
    const cs = [s.start.c, ...s.arrows.map(a => a.gc.c)], rs = [s.start.r, ...s.arrows.map(a => a.gc.r)];
    s.box = [Math.max(0, Math.min(...cs) - PAD), Math.min(nx - 1, Math.max(...cs) + PAD), Math.max(0, Math.min(...rs) - PAD), Math.min(ny - 1, Math.max(...rs) + PAD)];
  });
  const arrows = srcs.flatMap(s => s.arrows);

  // ── A* (상태 = 칸×2 + 들어온 축). 4방향 대신 2축: 되돌아가기는 늘 손해라 최단 경로가 바뀌지 않고 상태 수는 절반.
  const NS = NC * 2;
  const dist = new Float32Array(NS), prev = new Int32Array(NS), stamp = new Uint32Array(NS), closed = new Uint32Array(NS); let epoch = 0;
  // 버킷 큐(값을 1/QB 단위로 끊음): 이진 힙보다 약 2배 빠르다. 같은 버킷 안 순서 차이로 최단에서 최대 0.25칸 벗어날 수 있다.
  const QB = 4, NB = 1 << 15, BMASK = NB - 1;
  const bHead = new Int32Array(NB), bStamp = new Uint32Array(NB);
  let poolV = new Int32Array(1 << 18), poolN = new Int32Array(1 << 18), poolG = new Float32Array(1 << 18), pn = 0, cur = 0, qn = 0, popG = 0, pops = 0;
  const push = (f, v, g) => {
    let kq = Math.floor(f * QB); if (kq < cur) kq = cur; else if (kq - cur >= NB) kq = cur + NB - 1;
    const b = kq & BMASK; if (bStamp[b] !== epoch) { bStamp[b] = epoch; bHead[b] = -1; }
    if (pn >= poolV.length) { const a = new Int32Array(poolV.length * 2); a.set(poolV); poolV = a; const b2 = new Int32Array(poolN.length * 2); b2.set(poolN); poolN = b2; const g2 = new Float32Array(poolG.length * 2); g2.set(poolG); poolG = g2; }
    poolV[pn] = v; poolN[pn] = bHead[b]; poolG[pn] = g; bHead[b] = pn++; qn++; closed[v] = 0;   // 더 좋은 값으로 다시 들어오면 다시 펼친다(꺾임 하한 지도는 일관성이 완전하지 않음)
  };
  const pop = () => { for (;;) { const b = cur & BMASK; if (bStamp[b] === epoch && bHead[b] >= 0) { const e = bHead[b]; bHead[b] = poolN[e]; qn--; popG = poolG[e]; return poolV[e]; } cur++; } };
  const O0 = occ[0], O1 = occ[1], CA0 = CA[0], CA1 = CA[1];

  // 꺾임 수 하한 지도: 40px 거친 격자에서 '목표까지 최소 몇 번 꺾나'를 0-1 너비우선으로(장애물만 보므로 회차가 바뀌어도 그대로).
  // 휴리스틱이 '꺾임 최대 2번'만 알면, 장애물을 6~10번 꺾어 돌아가야 하는 긴 화살표에서 (남는 꺾임 × BEND)만큼 엉뚱한 칸까지 뒤진다.
  // 거친 칸은 안의 고운 칸이 전부 막혔을 때만 막힘 → 고운 길의 꺾임 수 ≥ 거친 길의 꺾임 수 → 하한이 맞다(최단 보장 유지).
  const CK = Math.max(1, Math.round(40 / S)), cnx = Math.ceil(nx / CK), cny = Math.ceil(ny / CK);
  const cblk = new Uint8Array(cnx * cny).fill(1);
  for (let i = 0; i < NC; i++) if (!hard[i]) cblk[((ROW[i] / CK) | 0) * cnx + ((COL[i] / CK) | 0)] = 0;
  function turnMap(s, gc) {
    const c0 = (s.box[0] / CK) | 0, c1 = (s.box[1] / CK) | 0, r0 = (s.box[2] / CK) | 0, r1 = (s.box[3] / CK) | 0, w = c1 - c0 + 1, h = r1 - r0 + 1, n = w * h;
    const dd = new Uint8Array(n * 2).fill(255), q = new Int32Array(n * 4 + 4); let qh = n * 2, qt = n * 2;
    const gx = ((gc.c / CK) | 0) - c0, gy = ((gc.r / CK) | 0) - r0, sx = ((s.start.c / CK) | 0) - c0, sy = ((s.start.r / CK) | 0) - r0;
    const open = (x, y) => x >= 0 && x < w && y >= 0 && y < h && (!cblk[(y + r0) * cnx + x + c0] || (x === gx && y === gy) || (x === sx && y === sy));
    for (let a = 0; a < 2; a++) { dd[(gy * w + gx) * 2 + a] = 0; q[qt++] = (gy * w + gx) * 2 + a; }
    while (qh < qt) {
      const st = q[qh++], cell = st >> 1, a = st & 1, D = dd[st], x = cell % w, y = (cell / w) | 0;
      for (const sg of [-1, 1]) {
        const px = a === 0 ? x + sg : x, py = a === 0 ? y : y + sg; if (!open(px, py)) continue;
        const P = (py * w + px) * 2;
        if (D < dd[P + a]) { dd[P + a] = D; q[--qh] = P + a; }
        if (D + 1 < dd[P + 1 - a]) { dd[P + 1 - a] = D + 1; q[qt++] = P + 1 - a; }
      }
    }
    const t = new Uint8Array(n); for (let i = 0; i < n; i++) { const m = Math.min(dd[i * 2], dd[i * 2 + 1]); t[i] = m === 255 ? 0 : m; }
    return { c0, r0, w, h, t };
  }
  function astar(seeds, goal, box, goalAxis, tm) {
    epoch++; pn = 0; cur = 0; qn = 0;
    const gc = goal.c, gr = goal.r, gcell = gr * nx + gc, revDir = (goal.d + 2) & 3;
    const b0 = box[0], b1 = box[1], b2 = box[2], b3 = box[3];
    const hu = unit * (1 + 1e-3), hb = BEND * (1 + 1e-3);   // 1e-3: 동점이면 목표에 가까운 쪽 먼저
    const hOf = (c, r, ax) => {
      const dc = gc - c, dr = gr - r; let t;
      if (dc === 0 && dr === 0) t = 0;
      else if (dc !== 0 && dr !== 0) t = ax !== goalAxis ? 1 : 2;
      else { const X = dc !== 0 ? 0 : 1; t = (ax !== X ? 1 : 0) + (goalAxis !== X ? 1 : 0); }
      if (tm) { const x = ((c / CK) | 0) - tm.c0, y = ((r / CK) | 0) - tm.r0; if (x >= 0 && x < tm.w && y >= 0 && y < tm.h) { const tc = tm.t[y * tm.w + x]; if (tc > t) t = tc; } }
      return (dc < 0 ? -dc : dc) * hu + (dr < 0 ? -dr : dr) * hu + t * hb;
    };
    const hg = hard[gcell]; hard[gcell] = 0;
    let minF = Infinity; for (const [st, g0] of seeds) { const cl = st >> 1; minF = Math.min(minF, g0 + hOf(COL[cl], ROW[cl], st & 1)); }
    cur = Math.floor(minF * QB);
    for (const [st, g0] of seeds) { if (stamp[st] === epoch && dist[st] <= g0) continue; stamp[st] = epoch; dist[st] = g0; prev[st] = -1; const cl = st >> 1; push(g0 + hOf(COL[cl], ROW[cl], st & 1), st, dist[st]); }
    let found = -1;
    const relax = (v, g, cell2, c2, r2, a2, turn) => {
      let k = g + turn + (a2 === 0 ? CA0[cell2] + PX * O1[cell2] : CA1[cell2] + PX * O0[cell2]);   // PX항 = 남의 선을 직각으로 건넘
      if (cell2 === gcell && a2 !== goalAxis) k += BEND;
      const u = cell2 * 2 + a2;
      if (stamp[u] !== epoch || k < dist[u] - 1e-9) { stamp[u] = epoch; dist[u] = k; prev[u] = v; push(k + hOf(c2, r2, a2), u, dist[u]); }
    };
    while (qn) {
      const v = pop(); pops++;
      if (closed[v] === epoch || popG !== dist[v]) continue;
      closed[v] = epoch;
      const cell = v >> 1, ax = v & 1, g = dist[v];
      if (cell === gcell) { found = v; break; }
      const c = COL[cell], r = ROW[cell];
      // 꺾는 칸은 두 축을 다 쓴다 → 새 축의 혼잡 값도 이 칸에서 한 번 더
      const tH = ax === 1 ? BEND + CA0[cell] - base[cell] : 0;
      const tV = ax === 0 ? BEND + CA1[cell] - base[cell] : 0;
      let cell2;
      if (c < b1) { cell2 = cell + 1; if (!hard[cell2]) relax(v, g, cell2, c + 1, r, 0, tH); }
      if (c > b0) { cell2 = cell - 1; if (!hard[cell2] && !(cell2 === gcell && revDir === 2)) relax(v, g, cell2, c - 1, r, 0, tH); }
      if (r < b3) { cell2 = cell + nx; if (!hard[cell2] && !(cell2 === gcell && revDir === 1)) relax(v, g, cell2, c, r + 1, 1, tV); }
      if (r > b2) { cell2 = cell - nx; if (!hard[cell2] && !(cell2 === gcell && revDir === 3)) relax(v, g, cell2, c, r - 1, 1, tV); }
    }
    hard[gcell] = hg;
    if (found < 0) return null;
    const st = []; for (let v = found; v !== -1; v = prev[v]) st.push(v); return st.reverse();
  }

  // ── 나무: 각 화살표는 출발부터 끝까지 칸 목록을 따로 들고 있어서 하나를 뜯어도 나머지가 안 깨진다.
  //    s.mult = 카드 안에서 (칸,축)을 쓰는 화살표 수(점유엔 카드당 1로만 들어감 → 같은 카드 줄기 공유는 공짜).
  const fullBox = [0, nx - 1, 0, ny - 1];
  // 화살표의 마지막 직선 구간(목표 높이로 옮겨 그려지는 칸들) 시작 위치 — 여기서는 남이 갈라지지 않게(옮겨 그리면 두 줄로 벌어져 보임)
  const lastRunStart = ar => {
    const p = ar.path; let k = p.length - 1;
    if (ar.gaxis === 0) { const rl = ROW[p[k] >> 1]; while (k > 0 && ROW[p[k - 1] >> 1] === rl) k--; }
    else { const cl = COL[p[k] >> 1]; while (k > 0 && COL[p[k - 1] >> 1] === cl) k--; }
    return k;
  };
  function keysOf(p, gaxis) {   // 경로가 쓰는 (칸,축): 꺾는 칸은 두 축
    const set = new Set(), last = p.length - 1;
    for (let k = 0; k <= last; k++) { const cell = p[k] >> 1; set.add(cell * 2 + (k === 0 ? 0 : (p[k] & 1))); set.add(cell * 2 + (k === last ? gaxis : (p[k + 1] & 1))); }
    return [...set];
  }
  const multAdd = ar => { const s = ar.s, m = s.mult; for (const e of ar.keys) { const n = m.get(e) || 0; if (n === 0 && !s.lifted) occChange(e >> 1, e & 1, +1); m.set(e, n + 1); } };
  const multRemove = ar => { const s = ar.s, m = s.mult; for (const e of ar.keys) { const n = m.get(e); if (n === 1) { m.delete(e); if (!s.lifted) occChange(e >> 1, e & 1, -1); } else m.set(e, n - 1); } };
  const liftSource = s => { for (const e of s.mult.keys()) occChange(e >> 1, e & 1, -1); s.lifted = true; };
  const dropSource = s => { for (const e of s.mult.keys()) occChange(e >> 1, e & 1, +1); s.lifted = false; };
  // (출발 카드가 들려 있을 때) 한 화살표: 출발 칸 또는 같은 카드의 다른 화살표 줄기 어디서든 시작(줄기 길이 × ALPHA)
  function routeArrow(ar) {
    const s = ar.s, sIdx = s.start.r * nx + s.start.c, startSt = sIdx * 2;
    const seedPath = new Map(); seedPath.set(startSt, [startSt, 0]);
    for (const q of s.arrows) {
      if (q === ar || !q.path) continue;
      const lr = lastRunStart(q);
      for (let k = 1; k < lr; k++) { const st = q.path[k], cv = seedPath.get(st); if (!cv || (cv[0] !== startSt && cv[1] > k)) seedPath.set(st, [q.path, k]); }
    }
    const seeds = []; for (const [st, v] of seedPath) seeds.push([st, v[0] === startSt ? 0 : ALPHA * v[1] * unit]);
    const hs = hard[sIdx]; hard[sIdx] = 0;
    if (o.TURNMAP && !ar.tm) ar.tm = turnMap(s, ar.gc);
    if (!ar.box) {
      const man = Math.abs(ar.gc.c - s.start.c) + Math.abs(ar.gc.r - s.start.r), pad = Math.round(Math.min(o.PAD, Math.max(o.PADMIN, man * S * o.PADF)) / S);
      ar.box = [Math.max(s.box[0], Math.min(s.start.c, ar.gc.c) - pad), Math.min(s.box[1], Math.max(s.start.c, ar.gc.c) + pad), Math.max(s.box[2], Math.min(s.start.r, ar.gc.r) - pad), Math.min(s.box[3], Math.max(s.start.r, ar.gc.r) + pad)];
    }
    let res = astar(seeds, ar.gc, ar.box, ar.gaxis, o.TURNMAP ? ar.tm : null);
    if (!res) res = astar(seeds, ar.gc, s.box, ar.gaxis, o.TURNMAP ? ar.tm : null);   // 화살표 상자 안에 길이 없으면 카드 상자, 그래도 없으면 벽 전체
    if (!res) res = astar(seeds, ar.gc, fullBox, ar.gaxis, null);
    hard[sIdx] = hs;
    if (!res) { ar.path = null; ar.keys = []; return; }
    const sp = seedPath.get(res[0]);
    ar.path = (sp[0] === startSt ? [startSt] : sp[0].slice(0, sp[1] + 1)).concat(res.slice(1));
    ar.keys = keysOf(ar.path, ar.gaxis);
  }
  // 카드 안 긋는 순서. 'dyn' = 매번 지금 나무(출발 칸 + 이미 그은 자기 화살표)에서 맨해튼으로 가장 가까운 목표부터.
  // 먼 목표를 먼저 그으면 가까운 목표가 그 줄기에 억지로 붙으려 돌아가고, 가까운 것부터 키우면 줄기가 자연스럽게 뻗는다.
  function routeSet(s, sel) {
    if (o.GOALORD !== 'dyn' || sel.length < 2) {
      const md = ar => Math.abs(ar.gc.c - s.start.c) + Math.abs(ar.gc.r - s.start.r);
      for (const ar of sel.slice().sort((x, y) => md(x) - md(y))) { routeArrow(ar); multAdd(ar); }
      return;
    }
    const tc = [s.start.c], tr = [s.start.r];
    const addTree = p => { for (const v of p) { const cell = v >> 1; tc.push(COL[cell]); tr.push(ROW[cell]); } };
    for (const q of s.arrows) if (q.path && !sel.includes(q)) addTree(q.path);
    const pending = sel.slice();
    while (pending.length) {
      let bi = 0, bd = Infinity;
      pending.forEach((ar, i) => { let m = Infinity; for (let k = 0; k < tc.length; k++) { const dd = Math.abs(tc[k] - ar.gc.c) + Math.abs(tr[k] - ar.gc.r); if (dd < m) m = dd; } if (m < bd) { bd = m; bi = i; } });
      const ar = pending.splice(bi, 1)[0];
      routeArrow(ar); multAdd(ar); if (ar.path) addTree(ar.path);
    }
  }
  const others = (s, cell, ax) => occ[ax][cell] - (s.mult.has(cell * 2 + ax) ? 1 : 0);
  // 가까운 이웃(BADK칸 안)에 남의 평행선이 있나 / 이웃 평행 가중치(가장 가까운 남의 선 하나 기준)
  const nearHit = (s, cell, ax) => { const step = ax === 0 ? nx : 1; for (let k = 1; k <= BADK; k++) { const c1 = cell - k * step, c2 = cell + k * step; if ((c1 >= 0 && others(s, c1, ax) > 0) || (c2 < NC && others(s, c2, ax) > 0)) return true; } return false; };
  const nearW = (s, cell, ax) => { const step = ax === 0 ? nx : 1; for (let k = 1; k <= R; k++) { const c1 = cell - k * step, c2 = cell + k * step; if ((c1 >= 0 && others(s, c1, ax) > 0) || (c2 < NC && others(s, c2, ax) > 0)) return KF[k]; } return 0; };

  // 다툼 집계 + 다툼 남은 화살표 표시 + 이력 갱신
  const hstamp = new Uint32Array(NC * 2); let hep = 0;
  function audit(updateHist) {
    let over = 0, adj = 0, cross = 0; hep++;
    for (const s of srcs) for (const e of s.mult.keys()) {
      const cell = e >> 1, ax = e & 1, ov = others(s, cell, ax) > 0, hit = nearHit(s, cell, ax);
      if (ov) over++; adj += nearW(s, cell, ax); if (others(s, cell, 1 - ax) > 0) cross++;
      if (updateHist && hstamp[e] !== hep) { hstamp[e] = hep; if (ov) hist[ax][cell] += HO; if (hit) hist[ax][cell] += HA; }
    }
    let nbad = 0;
    for (const ar of arrows) {
      ar.bad = false; if (!ar.path) continue;
      const s = ar.s, gc = ar.gc;
      for (const e of ar.keys) {
        const cell = e >> 1, ax = e & 1, c = COL[cell], r = ROW[cell];
        // 출발·목표 칸 근처(20px)는 어쩔 수 없는 자리(같은 쪽 같은 높이로 들어가는 등)라 빼고 본다 — 안 빼면 매 회 헛되이 다시 긋는다
        if (Math.abs(c - s.start.c) + Math.abs(r - s.start.r) <= 2 * BADK || Math.abs(c - gc.c) + Math.abs(r - gc.r) <= 2 * BADK) continue;
        if (others(s, cell, ax) > 0 || nearHit(s, cell, ax)) { ar.bad = true; break; }
      }
      if (ar.bad) nbad++;
    }
    return { over, adj, cross, nbad };
  }
  const bendsOf = p => { let b = 0; for (let k = 2; k < p.length; k++) if ((p[k] & 1) !== (p[k - 1] & 1)) b++; return b; };

  // ── 협상 루프
  let best = null, bestScore = Infinity; const log = [];
  for (let it = 0; it < o.ITERS; it++) {
    const pfac = Math.min(o.PF0 * Math.pow(PFMUL, it), PFMAX);
    POp = PO * pfac;
    for (let k = 1; k <= R; k++) KW[k] = Math.min(o.PA * pfac, o.PAMAX) * unit * KF[k];
    pops = 0; const ti = now(); recomputeCA();
    // 처음 FULL회: 카드 통째로 뜯고 나무를 새로. 그 뒤: 다툼 있는 화살표만 '같은 카드 안에서 한꺼번에' 뜯고 다시.
    // (하나씩 뜯으면 같은 카드의 다른 화살표 줄기를 공짜로 다시 타서 다툼이 영영 안 풀린다 — 방법 A 실험에서 확인)
    let rerouted = 0;
    for (const s of srcs) {
      const sel = it < o.FULL ? s.arrows : s.arrows.filter(ar => ar.bad);
      if (!sel.length) continue;
      liftSource(s);
      for (const ar of sel) { if (ar.path) multRemove(ar); ar.path = null; ar.keys = []; }
      routeSet(s, sel); rerouted += sel.length;
      dropSource(s);
    }
    const a = audit(true);
    let len = 0, bends = 0; for (const ar of arrows) if (ar.path) { len += ar.path.length; bends += bendsOf(ar.path); }
    // 회차 고르기 점수(격자 기준 근사): 겹침 > 가까운 평행 > 교차 > 길이·꺾임
    const score = a.over * 20 + a.adj * 4 + a.cross + len * unit * 0.02 + bends * 0.3;
    log.push({ it, pfac: +pfac.toFixed(2), over: a.over, adj: Math.round(a.adj), cross: a.cross, len: Math.round(len * S), bends, rerouted, bad: a.nbad, score: +score.toFixed(1), pops, ms: Math.round(now() - ti) });
    if (score < bestScore) { bestScore = score; best = arrows.map(ar => ar.path ? ar.path.slice() : null); }
    if (a.nbad === 0) break;
  }

  // ── 칸 경로 → 실제 좌표(첫 구간은 출발 높이, 마지막 구간은 목표 높이/x로 옮기고 직각만 남김 — 앱 원본과 같음)
  const out = new Array(goals.length).fill(null);
  arrows.forEach((ar, k) => { const p = best[k]; out[ar.idx] = p ? cellsToPtsXY(S, nx, p.map(v => v >> 1), ar.g.a, ar.g) : null; });
  return { routes: out, stats: { log, ms: now() - t0, grid: [nx, ny], S } };
}

function cellsToPtsXY(S, nx, cells, a, g) {
  const pts = cells.map(c => ({ x: (c % nx) * S + S / 2, y: ((c / nx) | 0) * S + S / 2 }));
  const r0 = pts[0].y; for (const q of pts) { if (q.y !== r0) break; q.y = a.y; }
  if (g.dir === 'left') { const rl = pts[pts.length - 1].y; for (let k = pts.length - 1; k >= 0 && pts[k].y === rl; k--) pts[k].y = g.by; }
  else { const cl = pts[pts.length - 1].x; for (let k = pts.length - 1; k >= 0 && pts[k].x === cl; k--) pts[k].x = g.bx; }
  pts.push({ x: g.bx, y: g.by }); pts.unshift({ x: a.x, y: a.y });
  return simplifyPts(pts);
}
// 같은 직선 위 점 합치기, 길이 0 구간 지우기, 비스듬한 구간은 ㄱ자로
function simplifyPts(pts) {
  const q = [pts[0]];
  for (let k = 1; k < pts.length; k++) { const p0 = q[q.length - 1], p1 = pts[k]; if (Math.abs(p0.x - p1.x) > .01 && Math.abs(p0.y - p1.y) > .01) q.push({ x: p1.x, y: p0.y }); q.push(p1); }
  const z = [q[0]];
  for (let k = 1; k < q.length; k++) {
    const p1 = q[k]; if (Math.abs(p1.x - z[z.length - 1].x) < .01 && Math.abs(p1.y - z[z.length - 1].y) < .01) continue;
    if (z.length >= 2) { const p0 = z[z.length - 2], pm = z[z.length - 1]; if ((Math.abs(p0.x - pm.x) < .01 && Math.abs(pm.x - p1.x) < .01) || (Math.abs(p0.y - pm.y) < .01 && Math.abs(pm.y - p1.y) < .01)) z.pop(); }
    z.push(p1);
  }
  return z;
}

if (typeof module !== 'undefined') module.exports = { routeCrossArrows, ROUTER_DEFAULTS, simplifyPts };
