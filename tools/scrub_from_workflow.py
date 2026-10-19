#!/usr/bin/env python3
"""Workflow all6-scrub-screen 결과(journal.jsonl) → ../site-data/all6_scrub_fixes.json (고침 사유에 실명이 있어 공개 폴더 밖에 둠). 2026-10-19.
screen 결과 fixes[] + refute 결과 problems[]: problems에 find·replace가 있으면 고침으로 더하고, detail에 '빼기'가 있으면 같은 id·field·find의 기존 고침을 뺀다.
돌리기: python3 tools/scrub_from_workflow.py <wf 폴더> [--dry]
"""
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
def journal(d):
    label, res = {}, []
    for line in (Path(d) / 'journal.jsonl').read_text().splitlines():
        try: j = json.loads(line)
        except Exception: continue
        if j.get('type') == 'started': label[j['key']] = j.get('label', '')
        if j.get('type') == 'result': res.append((label.get(j['key'], ''), j.get('result')))
    return res
res = journal(sys.argv[1]); dry = '--dry' in sys.argv
fixes = [f for lb, r in res if 'refute' not in lb and r for f in r.get('fixes', [])]
checked = sum(r.get('checked', 0) for lb, r in res if 'refute' not in lb and r)
problems = [p for lb, r in res if 'refute' in lb and r for p in (r.get('problems') or [])]
print(f'검사 {checked}항목, 고침 {len(fixes)}, 반박 {len(problems)}')
removed = added = 0
# 책(컷 대사)에 그대로 있는 구절은 가릴 이유가 없음(예: 조난 편 점호 '총원 12 …'). 그리고 작가가 책에 그린 뜻('중대장만 다른 사람이면' 209쪽)과 같은 대본 문장도 둠.
import re
BOOK = re.sub(r'\s+', '', (HERE.parent / 'exhibition-wall' / 'tools' / 'cut_text.md').read_text())
SKIP = {('decision-codex-finale-return-dialogue', '중대장만 아니면 가지 않을까'): '책 209쪽 "중대장만 다른 사람이면"과 같은 뜻 — 작가가 책에 그림',
        ('anchor-p094-a1a2a3b1b2b3', "'이런 시발'"): '욕설 순화는 가리기 기준이 아님(작가 글은 그대로)'}
def skip_reason(f):
    if (f['id'], f['find']) in SKIP: return SKIP[(f['id'], f['find'])]
    core = re.sub(r'\s+', '', f['find'])[:14]
    if f['kind'] in ('rule4', 'drop') and core and core in BOOK: return '책 컷 대사에 그대로 있음'
    return ''
for p in problems:
    if p.get('kind') == '빼기':   # 반박: 과하게 잡은 고침 빼기
        before = len(fixes); fixes = [f for f in fixes if not (f['id'] == p['id'] and f['field'] == p.get('field', f['field']) and (not p.get('find') or f['find'] == p['find']))]
        removed += before - len(fixes); print(' - 뺌(반박)', p['id'], p.get('field'), '|', p['detail'][:100]); continue
    if '빼기' in p.get('detail', '') and not p.get('replace'):
        before = len(fixes); fixes = [f for f in fixes if not (f['id'] == p['id'] and f['field'] == p.get('field', f['field']) and (not p.get('find') or f['find'] == p['find']))]
        removed += before - len(fixes); print(' - 뺌', p['id'], p.get('field'), '|', p['detail'][:100]); continue
    if p.get('find') and ('replace' in p):
        fixes.append({'id': p['id'], 'field': p['field'], 'find': p['find'], 'replace': p.get('replace', ''), 'kind': p.get('kind', 'name'), 'reason': '반박: ' + p['detail'][:160]}); added += 1
        print(' + 더함', p['id'], p['field'], repr(p['find'][:40]), '→', repr(p.get('replace', '')[:40]))
    else: print(' ? 손볼 것', p['id'], p.get('field'), '|', p['detail'][:140])
kept = []
for f in fixes:
    r = skip_reason(f)
    if r: print(' - 안 고침', f['id'], repr(f['find'][:40]), '|', r); continue
    kept.append(f)
fixes = kept
print(f'최종 고침 {len(fixes)} (뺌 {removed}, 더함 {added})')
from collections import Counter
print(Counter(f['kind'] for f in fixes))
if not dry:
    (HERE.parent / 'site-data' / 'all6_scrub_fixes.json').write_text(json.dumps({'fixes': fixes, 'problems': problems, 'checked': checked}, ensure_ascii=False, indent=1))
    print('→', HERE.parent / 'site-data' / 'all6_scrub_fixes.json')
