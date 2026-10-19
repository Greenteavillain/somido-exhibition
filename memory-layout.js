/* Screen-space memory cards around a selected canvas image. Pure geometry. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SomidoMemoryLayout = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const PADDING = 16;
  const EPSILON = 1e-7;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const right = r => r.x + r.width;
  const bottom = r => r.y + r.height;
  const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

  function finite(value, name) {
    if (!Number.isFinite(value)) throw new TypeError(name + ' must be finite');
    return value;
  }
  function rect(value) {
    const result = {};
    for (const key of ['x', 'y', 'width', 'height']) result[key] = finite(value[key], key);
    if (result.width < 0 || result.height < 0) throw new RangeError('Negative target size');
    return result;
  }
  function overlaps(a, b, gap) {
    return a.x < right(b) + gap - EPSILON && right(a) + gap > b.x + EPSILON &&
      a.y < bottom(b) + gap - EPSILON && bottom(a) + gap > b.y + EPSILON;
  }
  function connectors(card, target) {
    const c = center(card), t = center(target);
    if (card.side === 'right' || card.side === 'left') {
      return {
        start: { x: card.side === 'right' ? right(target) : target.x, y: clamp(c.y, target.y, bottom(target)) },
        end: { x: card.side === 'right' ? card.x : right(card), y: clamp(t.y, card.y, bottom(card)) }
      };
    }
    return {
      start: { x: clamp(c.x, target.x, right(target)), y: card.side === 'bottom' ? bottom(target) : target.y },
      end: { x: clamp(t.x, card.x, right(card)), y: card.side === 'bottom' ? card.y : bottom(card) }
    };
  }

  function layout(options) {
    const target = rect(options.target);
    const viewport = {
      width: finite(options.viewport.width, 'viewport width'),
      height: finite(options.viewport.height, 'viewport height')
    };
    if (viewport.width <= 0 || viewport.height <= 0) throw new RangeError('Empty viewport');
    const gap = options.gap === undefined ? 28 : finite(options.gap, 'gap');
    if (gap < 0) throw new RangeError('Negative gap');
    const cards = options.cards.slice(0, 4).map(card => {
      const width = finite(card.width, 'card width'), height = finite(card.height, 'card height');
      if (width <= 0 || height <= 0) throw new RangeError('Empty card');
      return { width, height };
    });
    const tc = center(target);
    const sideOrder = { right: 0, left: 1, bottom: 2, top: 3 };
    const inside = r => r.x >= PADDING - EPSILON && r.y >= PADDING - EPSILON &&
      right(r) <= viewport.width - PADDING + EPSILON && bottom(r) <= viewport.height - PADDING + EPSILON;

    function candidates(card, placed) {
      const maxX = viewport.width - PADDING - card.width;
      const maxY = viewport.height - PADDING - card.height;
      if (maxX < PADDING || maxY < PADDING) return [];
      const xs = [tc.x - card.width / 2, target.x, right(target) - card.width, PADDING, maxX];
      const ys = [tc.y - card.height / 2, target.y, bottom(target) - card.height, PADDING, maxY];
      for (const p of placed) {
        xs.push(right(p) + gap, p.x - gap - card.width);
        ys.push(bottom(p) + gap, p.y - gap - card.height);
      }
      const result = [], seen = new Set();
      function add(x, y, side) {
        const item = { x, y, width: card.width, height: card.height, side };
        const key = x.toFixed(6) + ':' + y.toFixed(6);
        if (seen.has(key) || !inside(item) || overlaps(item, target, gap) || placed.some(p => overlaps(item, p, gap))) return;
        seen.add(key);
        const cc = center(item);
        item.score = Math.hypot(cc.x - tc.x, cc.y - tc.y) + sideOrder[side] * 12;
        result.push(item);
      }
      for (const y of ys) {
        add(right(target) + gap, clamp(y, PADDING, maxY), 'right');
        add(target.x - gap - card.width, clamp(y, PADDING, maxY), 'left');
      }
      for (const x of xs) {
        add(clamp(x, PADDING, maxX), bottom(target) + gap, 'bottom');
        add(clamp(x, PADDING, maxX), target.y - gap - card.height, 'top');
      }
      return result.sort((a, b) => a.score - b.score || sideOrder[a.side] - sideOrder[b.side] || a.y - b.y || a.x - b.x);
    }

    // At most four cards: a bounded search avoids a locally convenient first
    // position preventing a later card from fitting. No runtime layout library.
    let best = [], bestScore = Infinity, visited = 0;
    function search(placed, score) {
      if (placed.length > best.length || (placed.length === best.length && score < bestScore)) {
        best = placed.slice(); bestScore = score;
      }
      if (placed.length === cards.length) return placed;
      if (++visited > 6000) return null;
      for (const next of candidates(cards[placed.length], placed)) {
        const found = search([...placed, next], score + next.score);
        if (found) return found;
        if (visited > 6000) break;
      }
      return null;
    }
    const placed = search([], 0) || best;
    // If the screen cannot contain every card, keep those that fit and stack
    // the remainder below the image. The parent supplies vertical scrolling.
    // The caller must size cards to <= viewport.width - 32 for horizontal fit.
    let nextY = Math.max(PADDING, bottom(target) + gap, ...placed.map(p => bottom(p) + gap));
    for (let i = placed.length; i < cards.length; i++) {
      const c = cards[i];
      placed.push({ x: clamp(tc.x - c.width / 2, PADDING, viewport.width - PADDING - c.width), y: nextY, ...c, side: 'bottom' });
      nextY += c.height + gap;
    }
    return placed.map(card => ({ x: card.x, y: card.y, side: card.side, ...connectors(card, target) }));
  }
  return { layout };
});
