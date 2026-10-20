#!/usr/bin/env python3
"""메모 손질 워크플로(all6-memo-trim, wf_1e7ec362-8e6) 결과 → site-data/all6_memo_edits.json

작가 10-20 규칙("ㅇㅇ ㄱㄱ"): 자르기만(보태기·어미 바꾸기 없음) ① AI에게 한 말·대화 운영 말 빼기 ② 긴 메모는 컷별로 쪼개기 ③ AI가 쓴 기록 6개 빼기 ④ 중복 빼기.
반박 9건 반영:
 - 원문 그대로 되돌림 3: decision-soya-one-conversation·decision-fire-learning-in-bamung('…' 없이 몰래 이어 붙임), chat-character-background(작가 고민 문장이라 두는 쪽)
 - floe-episodes-4330: [노트]본에만 있던 작가 줄 "(기대치가 낮으니 불만도 없겠군) (제육과 멸치 저울질)"을 054-4 조각 뒤에 되살림
 - codex-kitchen-counter-memo: 작가가 보기 1로 승인한 대로 통째로 뺌
 - 중복(④): 글자가 같은 조각은 한 번만 — 다듬은 판(floe-episodes-4330·8011·8012)을 남기고 초안(floe-text-d258567…·73f3…·fec17…)·따로 떨어진 같은 글(claude-omelette-misnaming 등)에서 뺌.
   초안에만 있는 조각(말이 다른 것)은 둠 = 과정이 보이게(작가 "변화한 것이나 과정이 있으면 차례로")
 - floe-text-15a77c26…: '총원 12'는 인쇄본(106-1 '총원 열둘')과 같아 그대로
쓰는 법: python3 tools/memo_from_workflow.py  (site-data/_memo_trim_result.json → all6_memo_edits.json, 바뀐 것만 적음)
"""
import json, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent; SM = HERE.parent.parent; SD = SM / 'site-data'
R = json.loads((SD / '_memo_trim_result.json').read_text())
raw = (SM / 'exhibition-all6' / 'data' / 'bundle.js').read_text()   # 손질 전 원문 비교용(이미 가려진 글)
B = json.loads(raw[raw.index('{'):].rstrip().rstrip(';'))
S = B['sources'] if isinstance(B['sources'], dict) else {s['id']: s for s in B['sources']}
raw4 = (SM / 'exhibition' / 'data' / 'bundle.js').read_text(); B4 = json.loads(raw4[raw4.index('{'):].rstrip().rstrip(';'))
ORIG = {s['id']: s.get('content', '') for s in B4['sources']}
for s in B4['author'].get('sources', []): ORIG[s['id']] = s.get('content', '')

RESTORE = {'decision-soya-one-conversation', 'decision-fire-learning-in-bamung', 'chat-character-background'}
DROP = {'codex-kitchen-counter-memo': '작가 승인 보기 1 — AI에게 부탁하는 머리말뿐',
        'decision-weekday-shift': 'AI가 쓴 기록(대조 메모)', 'decision-all-endings-rule-corrected': 'AI가 쓴 기록(대조 메모)',
        'decision-barbecue-trigger-merge': 'AI가 쓴 기록(구성안)', 'decision-bibim-tv': 'AI가 쓴 기록(구성안)',
        'decision-mural-flashback-old': 'AI가 쓴 기록(AI 제안)', 'codex-finale-time-line-proposal': 'AI가 쓴 기록(AI 제안)'}
PREFER = ['floe-episodes-4330', 'floe-episodes-8011', 'floe-episodes-8012']   # 중복이면 이쪽을 남김(더 다듬은 판)
NOTE_LINE = '(기대치가 낮으니 불만도 없겠군) (제육과 멸치 저울질)'

edits = {e['id']: {'drop': bool(e.get('drop')), 'reason': e.get('reason', ''), 'pieces': [dict(p) for p in e.get('pieces', [])]} for e in R['edits']}
for i in RESTORE:
    if i in edits: edits[i] = {'drop': False, 'reason': '반박 반영 — 원문 그대로', 'pieces': [{'text': ORIG.get(i, ''), 'cut': ''}]}
for i, why in DROP.items(): edits[i] = {'drop': True, 'reason': why, 'pieces': []}
e = edits['floe-episodes-4330']
for p in e['pieces']:
    if p['cut'] == '054-4' and NOTE_LINE not in p['text']: p['text'] = p['text'].rstrip() + '\n' + NOTE_LINE
e['reason'] += ' / 반박 반영: [노트]본에만 있던 작가 줄을 054-4 조각에 되살림'

norm = lambda t: re.sub(r'\s+', ' ', t).strip()
order = PREFER + sorted((i for i in edits if i not in PREFER), key=lambda i: -len(ORIG.get(i, '')))
seen = {}; dup_log = []
for i in order:
    e = edits[i]
    if e['drop']: continue
    keep = []
    for p in e['pieces']:
        k = norm(p['text'])
        if not k: continue
        if k in seen: dup_log.append((i, p.get('cut', ''), seen[k], p['text'][:40])); continue
        seen[k] = i; keep.append(p)
    e['pieces'] = keep
# 한 조각짜리가 다른(남긴) 기록 글의 일부와 글자까지 같으면 그것도 중복(claude-galbi-compliment-draft 류)
full = {i: norm('\n'.join(p['text'] for p in e['pieces'])) for i, e in edits.items() if not e['drop']}
for i, e in edits.items():
    if e['drop'] or len(e['pieces']) != 1: continue
    k = norm(e['pieces'][0]['text'])
    if len(k) < 20: continue
    owner = next((j for j in order if j != i and not edits[j]['drop'] and len(edits[j]['pieces']) > 1 and k in full[j]), None)
    if owner: dup_log.append((i, '', owner, k[:40])); e['pieces'] = []
for i, e in edits.items():
    if not e['drop'] and not e['pieces']: e['drop'] = True; e['reason'] = (e['reason'] + ' / 조각이 전부 다른 기록과 중복이라 뺌').strip(' /')

out = {}
for i, e in edits.items():
    o = norm(ORIG.get(i, ''))
    if e['drop']: out[i] = {'drop': True, 'reason': e['reason']}; continue
    if len(e['pieces']) == 1 and norm(e['pieces'][0]['text']) == o and not e['pieces'][0].get('cut'): continue   # 그대로
    out[i] = {'drop': False, 'reason': e['reason'], 'pieces': e['pieces']}
(SD / 'all6_memo_edits.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
n_drop = sum(1 for v in out.values() if v.get('drop')); n_split = sum(1 for v in out.values() if len(v.get('pieces', [])) > 1)
print(f'손질 {len(edits)}개 중 바뀐 것 {len(out)} — 뺌 {n_drop}, 쪼갬 {n_split}, 잘라냄 {len(out) - n_drop - n_split}, 그대로 {len(edits) - len(out)}')
for d in dup_log: print('  중복 뺌:', d[0], d[1] or '', '← 남긴 쪽', d[2], '|', d[3].replace('\n', '⏎'))
