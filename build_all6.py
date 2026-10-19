#!/usr/bin/env python3
"""all6 데이터 묶기 → data/bundle.js. 2026-10-19.
작가: "기존 exhibition4에서 디자인 바꾸고 내용들 바꾸는 방향으로 가자. 내용은 이미 바꿨을 것 같으니 교체" / 범위 "전부 다. 벽에 있는 것 스타일로 전부".
그래서: all4의 책·쪽·장면·기록 구조는 그대로 두고,
 - 구술 기록 21개(녹취 원문) → 벽 말풍선 36개(잘라 내고 가린 글, site/data/site.json의 bubbles)로 바꿈. 옛 구술 장면(author.anchors 37개)은 버리고 벽의 컷 자리(cut)에 새 장면을 만듦.
 - 일기 76장: 기록은 그대로(10-18에 다듬은 글·손글씨 SVG로 바뀜) + 벽의 형광펜 자리(marks → SVG 비율 상자)를 기록에 붙이고, 벽에서 정한 컷/쪽에 장면을 더함(이미 같은 쪽에 이어져 있으면 안 더함).
 - 포스트잇 42장: 실 매듭 것(38)은 실 선 위 문구로(B.threads), 따로 붙이는 것(4)은 '작업 메모' 기록(sourceType postit)으로 컷에 장면.
 - 실(요리 22·사람 16)과 짝 24 → B.threads, B.pairs (app.js가 그림).
 - 나머지 기록(Floe 메모·대화·구성안·결정·초안)은 그대로 두되, 장면에 쓰이는 것만 남기고(안 쓰이는 Floe 500장 등은 공개 파일에 안 실음) 실명·지명·§4를 가림:
   site-data/all6_scrub_fixes.json(Workflow all6-scrub-screen 결과) + site-data/_scrub.json(치환표·금지어). 금지어가 남으면 빌드 중단.
 - 쪽 그림(assets/pages, 간지포함2 PDF)과 컷 상자(오타수정본 기준)는 같은 그림이라(tools/pagemap.py로 확인: 배율 0.5·이동 0) 상자 비율을 그대로 씀. 쪽 id↔인쇄 쪽은 data/final_page_map.json.
돌리기: python3 build_all6.py   (--dev = 금지어가 남아도 씀, 화면 확인용. 배포 전엔 반드시 플래그 없이)
"""
import json, re, sys, unicodedata
from pathlib import Path
HERE = Path(__file__).resolve().parent
SM = HERE.parent                                   # somido-map
E = SM / 'exhibition'
NFC = lambda s: unicodedata.normalize('NFC', s)

raw = (E / 'data' / 'bundle.js').read_text()
B = json.loads(raw[raw.index('{'):].rstrip().rstrip(';'))
S = json.loads((SM / 'site' / 'data' / 'site.json').read_text())
SCRUB = json.loads((SM / 'site-data' / '_scrub.json').read_text())
book = json.loads((E / 'data' / 'book.json').read_text())   # 원본에서 읽고, 가린 사본을 data/book.json에 씀
fmap = {pid: pg for pid, pg, sc in json.loads((HERE / 'data' / 'final_page_map.json').read_text()) if pid}
pid_of_page = {pg: pid for pid, pg in fmap.items()}
pids = {p['id'] for p in book['pages']}
# 화면에 보이는 쪽 번호 = 인쇄 쪽(벽·포스트잇·컷 번호와 같은 기준). all4는 PDF 순번(1~218)이라 벽 기록의 '3쪽'이 화면엔 '1쪽'으로 보였음
for p in book['pages']:
    if p['id'] in fmap: p['number'] = fmap[p['id']]

# ── 1. all4가 실행 때 하던 합치기(author.sources·sourcePatches·author.anchors)를 여기서 미리 해 평평하게 ──
au = B['author']
src = {s['id']: dict(s) for s in B['sources']}
for s in au.get('sources', []): src[s['id']] = dict(s)
for sid, patch in au.get('sourcePatches', {}).items():
    if sid in src: src[sid] = {**src[sid], **patch, 'id': sid}
anchors = {a['id']: dict(a) for a in B['anchors']}
for a in au.get('anchors', []): anchors[a['id']] = dict(a)
for aid, patch in au.get('anchorPatches', {}).items():
    if aid in anchors: anchors[aid] = {**anchors[aid], **patch, 'id': aid}
for a in anchors.values():
    a['regions'] = [{**r, 'page': r.get('page') or a.get('page')} for r in a.get('regions', [])]

def walk_set(obj, path, value):
    cur = obj; parts = path.split('.')
    for p in parts[:-1]: cur = cur[int(p)] if isinstance(cur, list) else cur[p]
    last = parts[-1]
    if isinstance(cur, list): cur[int(last)] = value
    else: cur[last] = value
def walk_get(obj, path):
    cur = obj
    for p in path.split('.'): cur = cur[int(p)] if isinstance(cur, list) else cur.get(p, '')
    return cur
# ── 1b. 가리기(워크플로 고침) — 2단계(옛 구술 링크 빼기)보다 먼저: 고침의 field 'links.N'이 원래 순서 기준이라 뒤에 하면 번호가 어긋남
fixes_path = SM / 'site-data' / 'all6_scrub_fixes.json'   # 고침 사유에 실명이 있어 공개 폴더(all6) 밖
applied = missed = 0
if fixes_path.exists():
    F = json.loads(fixes_path.read_text())
    fv = B.get('floeVersions', {}); fvi = {v['id']: v for vs in fv.values() for v in vs['versions']}
    for f in F['fixes']:
        tgt = src.get(f['id']) or anchors.get(f['id']) or fvi.get(f['id'])
        if tgt is None: continue
        if f['kind'] == 'drop' and f['field'] in ('content', 'text') and not f['find']:
            tgt[f['field']] = ''; applied += 1; continue
        try: cur = walk_get(tgt, f['field'])
        except Exception: missed += 1; continue
        if isinstance(cur, str) and f['find'] and f['find'] in cur: walk_set(tgt, f['field'], cur.replace(f['find'], f['replace'])); applied += 1
        else: missed += 1; print('   못 찾음', f['id'], f['field'], repr(f['find'][:40]))
    print('워크플로 고침', applied, '적용 / 못 찾음', missed)
    # id 자체를 고친 기록(예: 'dongwoo'가 든 id → 'myeo'): 사전 키와 장면의 참조(links·lanes·lineage·lineageHops)도 같이 바꿈
    renamed = {old: s_['id'] for old, s_ in src.items() if s_['id'] != old}
    for old, new in renamed.items():
        src[new] = src.pop(old)
        for a in anchors.values():
            for l in a['links']:
                if l['sourceId'] == old: l['sourceId'] = new
            for k in ('lineage', 'sourceIds'):
                if a.get(k): a[k] = [new if x == old else x for x in a[k]]
            if a.get('lanes'):
                for lane in ('memory', 'decision'): a['lanes'][lane] = [new if x == old else x for x in a['lanes'].get(lane, [])]
                if a['lanes'].get('into') == old: a['lanes']['into'] = new
            if a.get('lineageHops'): a['lineageHops'] = {k.replace(old, new): v for k, v in a['lineageHops'].items()}
        print('  id 바꿈', old, '→', new)
else: print('⚠ site-data/all6_scrub_fixes.json 없음 — 워크플로 결과 전엔 치환표·금지어 검사만')

# ── 2. 옛 구술 기록·장면 버리기 ──
old_oral = {sid for sid, s in src.items() if s.get('sourceType') in ('oral_recollection', 'submitted_story')}
for sid in old_oral: del src[sid]
for aid in [aid for aid, a in anchors.items() if any(l['sourceId'] in old_oral for l in a['links'])]:
    a = anchors[aid]
    a['links'] = [l for l in a['links'] if l['sourceId'] not in old_oral]
    for k in ('lineage',):
        if a.get(k): a[k] = [x for x in a[k] if x not in old_oral]
    if a.get('lanes'):
        for lane in ('memory', 'decision'): a['lanes'][lane] = [x for x in a['lanes'].get(lane, []) if x not in old_oral]
    if not a['links']: del anchors[aid]
print('옛 구술 기록', len(old_oral), '뺌 → 장면', len(anchors))

# ── 3. 컷 상자·쪽 ──
def region_of(cid, label=''):
    c = S['cuts'].get(cid)
    pg = int(cid[:3]); pid = pid_of_page.get(pg)
    if not pid: return None
    rect = [round(v, 4) for v in c['box']] if c else [0, 0, 1, 1]
    return {'id': f'r-{cid}', 'page': pid, 'rect': rect, 'label': label or cid}
def page_region(pg):
    pid = pid_of_page.get(int(pg)); return {'id': f'r-p{pg}', 'page': pid, 'rect': [0, 0, 1, 1], 'label': f'{pg}쪽 전체'} if pid else None

# ── 4. 구술 → 말풍선 기록 + 장면 ──
meta_of = {s['id']: s for s in au.get('sources', [])}   # 옛 구술 기록의 제목·들은 사람 등
def base_id(bid): return re.sub(r'-\d+$', '', bid)
new_src, new_anchors = [], []
for b in S['bubbles']:
    m = meta_of.get(base_id(b['id']), {})
    s = {'id': b['id'], 'kind': 'source', 'sourceType': 'oral_recollection', 'title': m.get('title', ''), 'content': b['text'], 'summary': '',
         'status': 'documented', 'speaker': '작가', 'heardBy': m.get('heardBy', ''), 'heardByGuess': m.get('heardByGuess', False), 'recordedAt': m.get('recordedAt', '2026-10-18'),
         'date': m.get('date', '2026-10'), 'eventDate': m.get('eventDate', ''), 'episodeIds': [], 'wall': b.get('wall', True)}
    if base_id(b['id']) == 'oral-gpt-omelet': s['sourceType'] = 'submitted_story'; s['sentTo'] = m.get('sentTo', '')
    src[b['id']] = s
    reg = region_of(b['cut']) if b['cut'] else page_region(b['page'])
    if not reg: print('⚠ 말풍선 쪽 없음', b['id'], b['cut'], b['page']); continue
    new_anchors.append({'id': f'wall-oral-{b["id"]}', 'page': reg['page'], 'title': s['title'], 'scope': 'region', 'regions': [reg], 'episodeIds': [],
                        'sourceIds': [b['id']], 'links': [{'sourceId': b['id'], 'relation': 'recollection', 'status': 'confirmed', 'basis': 'author_wall_2026-10-18', 'sourceExcerpt': '', 'publicQuote': ''}],
                        'lanes': {'memory': [b['id']], 'decision': [], 'into': 'comic'}, 'lineageHops': {}})
print('말풍선', len(S['bubbles']))

# ── 5. 일기: 형광펜 상자 + 벽 장면 ──
by_image = {}
for sid, s in src.items():
    if s.get('sourceType') == 'diary' and s.get('image'): by_image[NFC(Path(s['image']).name)] = sid
diary_sid = {}
for d in S['diaries']:
    sid = by_image.get(d['file'])
    if not sid:   # 기록이 없던 일기(없어야 정상)
        sid = 'diary-' + d['file'][:-4]; src[sid] = {'id': sid, 'kind': 'source', 'sourceType': 'diary', 'title': d['date'], 'content': '', 'summary': '', 'status': 'documented', 'date': d['date'], 'episodeIds': [], 'image': f'assets/diary-svg/{d["file"]}'}
        print('  새 일기 기록', sid)
    diary_sid[d['file']] = sid
    s = src[sid]; vw, vh = d['viewBox'][2], d['viewBox'][3]
    ln = {l[0]: l for l in d['lines']}
    boxes = []
    for m in d['marks']:
        Ls = [ln[i] for i in m['lines'] if i in ln]
        if not Ls: continue
        y0 = min(l[1] for l in Ls) - 14; y1 = max(l[1] for l in Ls) + 5; x0 = min(l[2] for l in Ls) - 4; x1 = max(l[3] for l in Ls) + 4
        boxes.append({'box': [round(x0 / vw, 4), round(y0 / vh, 4), round((x1 - x0) / vw, 4), round((y1 - y0) / vh, 4)], 'reason': m['reason']})
    s['marks'] = boxes; s['aspect'] = round(vh / vw, 4); s['wallSummary'] = d.get('summary', ''); s['wallKind'] = d['kind']; s['wall'] = d['wall']
    s['image'] = f'assets/diary-svg/{d["file"]}'
    s['content'] = ''   # 공개 파일엔 일기 본문 글을 싣지 않음(손글씨 SVG만 — 작가가 가린 조각이 SVG에만 반영돼 있음)
    # 장면: 컷 또는 쪽. 이미 같은 쪽에 이 일기가 이어져 있으면 안 더함
    reg = region_of(d['cut']) if d['cut'] else (page_region(d['page']) if d['page'] else None)
    if not reg: continue
    already = any(l['sourceId'] == sid and any(r['page'] == reg['page'] for r in a['regions']) for a in anchors.values() for l in a['links'])
    if already: continue
    hop = {'drawn': '', 'nearby': '그 무렵의 일', 'none': '만화가 되지 않은 날'}.get(d['kind'], '')
    new_anchors.append({'id': f'wall-diary-{d["file"][:-4]}', 'page': reg['page'], 'title': d['date'] + ' 일기', 'scope': 'region', 'regions': [reg], 'episodeIds': [],
                        'sourceIds': [sid], 'links': [{'sourceId': sid, 'relation': 'source_for' if d['kind'] == 'drawn' else 'related_record', 'status': 'confirmed', 'basis': 'author_wall_2026-10-18', 'sourceExcerpt': '', 'publicQuote': ''}],
                        'lanes': {'memory': [sid], 'decision': [], 'into': 'comic'}, 'lineageHops': {f'{sid}>comic': hop} if hop else {}})
print('일기', len(S['diaries']), '→ 벽 장면', sum(1 for a in new_anchors if a['id'].startswith('wall-diary')))

# ── 6. 포스트잇: 실 매듭 문구 / 따로 붙이는 쪽지 ──
seq = {}
for k, t in S['threads'].items():
    for i, (cid, stage) in enumerate(t['nodes']): seq.setdefault(cid, []).append((k, i))
thread_note, extra = {}, []
for p in S['postits']:
    tg = p['target']
    if tg in seq and tg not in thread_note: thread_note[tg] = p['text']
    else: extra.append(p)
pn = 0
for p in extra:
    pn += 1; sid = f'postit-{pn}'
    src[sid] = {'id': sid, 'kind': 'source', 'sourceType': 'postit', 'title': '', 'content': p['text'], 'summary': '', 'status': 'documented', 'date': '2026-10', 'episodeIds': []}
    tg = p['target']
    if tg.startswith('일기 '):
        date = tg.split(' ', 1)[1]
        d = next((d for d in S['diaries'] if d['date'] == date), None)
        a = next((a for a in new_anchors if d and a['id'] == f'wall-diary-{d["file"][:-4]}'), None)
        if a: a['lanes']['memory'].append(sid); a['links'].append({'sourceId': sid, 'relation': 'author_note', 'status': 'confirmed', 'basis': 'author_wall_2026-10-18'}); a['sourceIds'].append(sid)
        else: print('⚠ 포스트잇 일기 장면 없음', tg)
        continue
    reg = region_of(tg)
    if not reg: print('⚠ 포스트잇 쪽 없음', tg); continue
    new_anchors.append({'id': f'wall-postit-{pn}', 'page': reg['page'], 'title': '', 'scope': 'region', 'regions': [reg], 'episodeIds': [], 'sourceIds': [sid],
                        'links': [{'sourceId': sid, 'relation': 'author_note', 'status': 'confirmed', 'basis': 'author_wall_2026-10-18'}], 'lanes': {'memory': [sid], 'decision': [], 'into': 'comic'}, 'lineageHops': {}})
print('포스트잇 실 매듭', len(thread_note), '따로', pn)

# ── 7. 실·짝 ──
threads = []
for k, t in S['threads'].items():
    nodes = []
    for cid, stage in t['nodes']:
        reg = region_of(cid)
        if not reg: print('⚠ 실 컷 쪽 없음', cid); continue
        nodes.append({'cut': cid, 'page': reg['page'], 'rect': reg['rect'], 'stage': stage, 'note': thread_note.get(cid, '')})
    threads.append({'id': k, 'name': t['name'], 'nodes': nodes})
pairs = []
for p in S['pairs']:
    a, b = region_of(p['first']), region_of(p['last'])
    if a and b: pairs.append({'name': p['name'], 'first': {'cut': p['first'], 'page': a['page'], 'rect': a['rect'], 'quote': p['first_quote']}, 'last': {'cut': p['last'], 'page': b['page'], 'rect': b['rect'], 'quote': p['last_quote']}, 'meaning': p['meaning']})
print('실', [(t['id'], len(t['nodes'])) for t in threads], '짝', len(pairs))

for a in new_anchors: anchors[a['id']] = a
# 일기 글은 공개 파일에 안 싣기로(손글씨 SVG만) → 일기 링크의 발췌(sourceExcerpt·publicQuote·quote)도 지움. 다른 링크의 quote류 키도 화면에 안 쓰므로 뺌
LINK_DROP = {'quote', 'excerptNote', 'evidence'}
for a in anchors.values():
    for l in a['links']:
        for k in list(l):
            if k in LINK_DROP: del l[k]
        if src.get(l['sourceId'], {}).get('sourceType') == 'diary':
            for k in ('sourceExcerpt', 'publicQuote'): l[k] = ''

# ── 8. 공개 파일에 실을 기록만 남기기: 장면에 쓰이는 기록(+lanes·lineage) + Floe 판본 ──
used = set()
for a in anchors.values():
    for l in a['links']: used.add(l['sourceId'])
    for k in ('lineage',): used.update(a.get(k) or [])
    if a.get('lanes'): used.update(a['lanes'].get('memory', [])); used.update(a['lanes'].get('decision', []))
fv = B.get('floeVersions', {})
used.update(fv.keys())
used = {u.split('@')[0] for u in used}
src = {sid: s for sid, s in src.items() if sid in used}
print('기록', len(src), '(장면에 쓰이는 것만)')

# ── 9. 가리기: 워크플로 결과 + 치환표 + 금지어 검사 ──
def scrub_str(t):
    for a_, b_ in SCRUB['replace'].items(): t = t.replace(a_, b_)
    return t
def scrub(obj):
    if isinstance(obj, str): return scrub_str(obj)
    if isinstance(obj, list): return [scrub(x) for x in obj]
    if isinstance(obj, dict): return {k: scrub(v) for k, v in obj.items()}
    return obj
# 공개용엔 화면이 쓰는 키만 남김(화이트리스트). 검토 메모(reason·verifier·verifyNote·why…)와 경로·전사(locator·notes·transcription)에 실명이 그대로 있었음
SRC_KEEP = {'id', 'kind', 'sourceType', 'title', 'summary', 'content', 'status', 'date', 'dateLabel', 'dateKind', 'recordedAt', 'eventDate', 'speaker', 'heardBy', 'heardByGuess', 'sentTo', 'via',
            'image', 'marks', 'aspect', 'wall', 'wallKind', 'wallSummary', 'episodeIds', 'medium', 'firstSeenExport', 'userCorrected'}
ANC_KEEP = {'id', 'page', 'title', 'scope', 'regions', 'episodeIds', 'sourceIds', 'links', 'lanes', 'lineage', 'lineageHops', 'hidden'}
LINK_KEEP = {'sourceId', 'relation', 'status', 'basis', 'sourceExcerpt', 'publicQuote', 'publicQuoteIsRedacted', 'transform', 'note'}
REG_KEEP = {'id', 'page', 'rect', 'label'}
src = {sid: scrub({k: v for k, v in s.items() if k in SRC_KEEP}) for sid, s in src.items()}
def clean_anchor(a):
    a = {k: v for k, v in a.items() if k in ANC_KEEP}
    a['links'] = [{k: v for k, v in l.items() if k in LINK_KEEP} for l in a['links']]
    a['regions'] = [{k: v for k, v in r.items() if k in REG_KEEP} for r in a['regions']]
    return a
anchors = {aid: scrub(clean_anchor(a)) for aid, a in anchors.items()}
fv = scrub(fv); threads = scrub(threads); pairs = scrub(pairs)
# 책 차례(sections)·쪽 제목·메모에도 실제 부대 이름(13화 제목)·윗부대 간부 이름(막간 설명)이 있었음 → 책 자료 전체를 같이 가림. 공개 파일에 안 쓰는 경로·검수 정보는 뺌
for k in ('source', 'build', 'verification', 'imageSource'): book.pop(k, None)
book = scrub(book)
blob = json.dumps({'s': src, 'a': anchors, 'f': fv, 't': threads, 'p': pairs, 'b': book}, ensure_ascii=False)
bad = [w for w in SCRUB['forbid'] if w in blob]
if bad:
    for w in bad:
        i = blob.find(w); print('금지어', w, '|', blob[max(0, i - 80):i + 40].replace('\n', ' '))
    if '--dev' not in sys.argv: sys.exit(f'공개 글에 금지어가 남음: {bad}')
    print('⚠⚠ --dev: 금지어가 남은 채로 씀 — 이 bundle.js는 올리면 안 됨')

# ── 10. 쓰기 ──
out = {'schemaVersion': 1, 'book': book, 'sources': list(src.values()), 'anchors': list(anchors.values()), 'relationLabels': B.get('relationLabels', {}),
       'author': {'schemaVersion': 1, 'sources': [], 'anchors': [], 'sourcePatches': {}, 'anchorPatches': {}, 'bookHash': book['sourceHash']},
       'floeVersions': fv, 'threads': threads, 'pairs': pairs, 'meta': {**B.get('meta', {}), 'all6': '2026-10-19 벽 재료로 교체'}, 'revision': 'all6-2026-10-19'}
(HERE / 'data' / 'book.json').write_text(json.dumps(book, ensure_ascii=False, indent=1))
(HERE / 'data' / 'bundle.js').write_text('window.SOMIDO = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('bundle.js', round((HERE / 'data' / 'bundle.js').stat().st_size / 1e6, 2), 'MB, 장면', len(anchors), '기록', len(src))
