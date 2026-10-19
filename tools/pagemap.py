#!/usr/bin/env python3
"""all6: 최종 쪽 그림(간지포함2 PDF 재단본, assets/pages/pNNN.webp 1704×2136) ↔ 오타수정본 PDF 쪽(3408×4272, 컷 상자의 좌표 기준) 맞추기. 2026-10-19.
왜: 벽 기록(일기·구술·포스트잇·실)은 컷 번호(인쇄 쪽-칸)로 붙어 있고 컷 상자는 오타수정본 쪽 픽셀 기준인데, all4 쪽 그림은 최종 재단본(1.12배 키우고 바깥쪽 자름)이라
    쪽마다 배율·어긋남이 달라 상자를 그대로 못 얹는다. 쪽마다 배율 f와 이동(tx,ty)을 그림 맞춤(위상 상관)으로 구해 data/page_map.json에 둔다.
    쪽 번호 대응은 exhibition/data/final_page_map.json(10-18 swap, [pageId, 간지포함2 PDF 쪽, 점수])을 쓴다 — 간지포함2 PDF 쪽 = 인쇄 쪽(앞 간지 2장 = 오타수정본의 +2).
결과: final_x = orig_x * f + tx (final 그림 1704 기준 px). 검사 그림: tools/_pagemap_check.jpg(상자를 최종 쪽 위에 그림).
돌리기: python3 tools/pagemap.py [--check 3,59,145,196]
"""
import json, sys, io
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from pypdf import PdfReader
HERE = Path(__file__).resolve().parent.parent
E = HERE.parent / 'exhibition'
PDF = Path.home() / 'Documents' / '소미도 페이지번호_전체_최종_오타수정.pdf'
TOOLS = HERE.parent / 'exhibition-wall' / 'tools'
W0, H0 = 3408, 4272
FW, FH = 1704, 2136
LOW = 320                                    # 맞춤 계산용 너비(최종 그림 기준)
fmap = {pid: pg for pid, pg, sc in json.loads((E / 'data' / 'final_page_map.json').read_text()) if pid}
R = PdfReader(open(PDF, 'rb'))               # 파일 핸들로 한 번만(큰 PDF를 쪽마다 통째로 읽다 커널 패닉 났던 교훈)

def orig_page(pg):
    """인쇄 쪽 pg의 오타수정본 쪽 그림(그레이, 원본 크기)."""
    p = R.pages[pg - 3]
    im = p.images[0].image.convert('L')
    if im.size != (W0, H0): im = im.resize((W0, H0))
    return im

def gray(im): return np.asarray(im, dtype=np.float32) / 255.0

def phase_corr(a, b):
    """a, b 같은 크기. b를 얼마나 옮기면 a가 되는지 (dy, dx)와 상관 피크."""
    A = np.fft.fft2(a - a.mean()); B = np.fft.fft2(b - b.mean())
    Rr = A * np.conj(B); Rr /= np.abs(Rr) + 1e-9
    r = np.fft.ifft2(Rr).real
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    if dy > r.shape[0] // 2: dy -= r.shape[0]
    if dx > r.shape[1] // 2: dx -= r.shape[1]
    return dy, dx, r.max()

def ncc(a, b):
    a = a - a.mean(); b = b - b.mean(); d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0

def fit(final_im, orig_im):
    """final = orig * f + (tx, ty). 배율 후보마다 위상 상관으로 이동을 찾고 NCC가 가장 큰 것."""
    k = LOW / FW
    fa = gray(final_im.resize((LOW, round(FH * k)), Image.BILINEAR))
    S = 512
    best = None
    for f in np.arange(0.46, 0.60, 0.005):
        ow, oh = round(W0 * f * k), round(H0 * f * k)
        ob = gray(orig_im.resize((ow, oh), Image.BILINEAR))
        A = np.ones((S, S), np.float32); A[:fa.shape[0], :fa.shape[1]] = fa
        B = np.ones((S, S), np.float32); B[:min(oh, S), :min(ow, S)] = ob[:S, :S]
        dy, dx, pk = phase_corr(A, B)
        # 겹치는 부분의 NCC로 검증
        y0, y1 = max(0, dy), min(fa.shape[0], oh + dy); x0, x1 = max(0, dx), min(fa.shape[1], ow + dx)
        if y1 - y0 < 50 or x1 - x0 < 50: continue
        c = ncc(fa[y0:y1, x0:x1], ob[y0 - dy:y1 - dy, x0 - dx:x1 - dx])
        if best is None or c > best[0]: best = (c, float(f), dx / k, dy / k)
    return best

if __name__ == '__main__':
    out = {}
    pids = sorted(fmap)
    for i, pid in enumerate(pids):
        pg = fmap[pid]
        try:
            fi = Image.open(E / 'assets' / 'pages' / f'{pid}.webp').convert('L')
            if fi.size != (FW, FH): fi = fi.resize((FW, FH))
            oi = orig_page(pg)
        except Exception as e:
            print(pid, pg, 'skip', e); continue
        c, f, tx, ty = fit(fi, oi)
        out[pid] = {'page': pg, 'f': round(f, 4), 'tx': round(tx, 1), 'ty': round(ty, 1), 'ncc': round(c, 3)}
        if i % 20 == 0: print(i, pid, out[pid], flush=True)
    (HERE / 'data' / 'page_map.json').write_text(json.dumps(out, ensure_ascii=False, indent=0))
    import statistics
    print('done', len(out), 'ncc median', statistics.median(v['ncc'] for v in out.values()), 'min', min(out.values(), key=lambda v: v['ncc']))
    # 검사 그림: 컷 상자를 최종 쪽 위에
    cp = {r['page']: r for r in json.loads((TOOLS / 'cutpanels_result.json').read_text())}
    checks = [int(x) for x in (sys.argv[sys.argv.index('--check') + 1].split(',') if '--check' in sys.argv else ['3', '59', '145', '196'])]
    tiles = []
    for pg in checks:
        pid = next((k for k, v in out.items() if v['page'] == pg), None)
        if not pid: continue
        m = out[pid]; im = Image.open(E / 'assets' / 'pages' / f'{pid}.webp').convert('RGB'); d = ImageDraw.Draw(im)
        for fdef in cp.get(pg, {}).get('files', []):
            b = fdef.get('box');
            if not b or fdef['file'].endswith('-0.jpg'): continue
            x0, y0, x1, y1 = b[0] * m['f'] + m['tx'], b[1] * m['f'] + m['ty'], b[2] * m['f'] + m['tx'], b[3] * m['f'] + m['ty']
            d.rectangle([x0, y0, x1, y1], outline=(230, 40, 40), width=6)
        im.thumbnail((500, 640)); tiles.append(im)
    if tiles:
        W = Image.new('RGB', (sum(t.width for t in tiles) + 10 * len(tiles), max(t.height for t in tiles)), 'white'); x = 0
        for t in tiles: W.paste(t, (x, 0)); x += t.width + 10
        W.save(HERE / 'tools' / '_pagemap_check.jpg', quality=85); print('check →', HERE / 'tools' / '_pagemap_check.jpg')
