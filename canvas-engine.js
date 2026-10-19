/* Local canvas camera and gestures. No dependency on the book's data or layout. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SomidoCanvas = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const DEFAULT_MIN = 0.035;
  const DEFAULT_MAX = 3;
  const DRAG_THRESHOLD = 4;

  function number(value, name) {
    if (!Number.isFinite(value)) throw new TypeError(name + ' must be a finite number');
    return value;
  }
  function limits(min, max) {
    number(min, 'minScale'); number(max, 'maxScale');
    if (min <= 0 || max < min) throw new RangeError('Invalid scale limits');
  }
  function clampScale(value, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    limits(min, max);
    return Math.max(min, Math.min(max, number(value, 'scale')));
  }
  function point(value) {
    return { x: number(value.x, 'x'), y: number(value.y, 'y') };
  }
  function cameraValue(value) {
    const p = point(value);
    p.scale = number(value.scale, 'scale');
    if (p.scale <= 0) throw new RangeError('Camera scale must be positive');
    return p;
  }
  function rectangle(value) {
    const p = point(value);
    p.width = number(value.width, 'width');
    p.height = number(value.height, 'height');
    if (p.width < 0 || p.height < 0) throw new RangeError('Negative bounds');
    return p;
  }
  function size(value) {
    const width = number(value.width, 'viewport width');
    const height = number(value.height, 'viewport height');
    if (width <= 0 || height <= 0) throw new RangeError('Viewport size must be positive');
    return { width, height };
  }
  function zoomCameraAt(camera, factor, at, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    const c = cameraValue(camera), p = point(at);
    number(factor, 'zoom factor');
    if (factor <= 0) throw new RangeError('Zoom factor must be positive');
    const scale = clampScale(c.scale * factor, min, max);
    const ratio = scale / c.scale;
    return { x: p.x - (p.x - c.x) * ratio, y: p.y - (p.y - c.y) * ratio, scale };
  }
  function fitCamera(bounds, viewport, padding = 60, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    const b = rectangle(bounds), v = size(viewport);
    number(padding, 'padding');
    if (padding < 0) throw new RangeError('Padding must not be negative');
    const availableW = Math.max(1, v.width - padding * 2);
    const availableH = Math.max(1, v.height - padding * 2);
    const scale = clampScale(Math.min(
      b.width ? availableW / b.width : max,
      b.height ? availableH / b.height : max
    ), min, max);
    return {
      x: v.width / 2 - (b.x + b.width / 2) * scale,
      y: v.height / 2 - (b.y + b.height / 2) * scale,
      scale
    };
  }
  function focusCamera(camera, bounds, viewport, requestedScale, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    const c = cameraValue(camera), b = rectangle(bounds), v = size(viewport);
    const scale = clampScale(requestedScale === undefined ? c.scale : requestedScale, min, max);
    return {
      x: v.width / 2 - (b.x + b.width / 2) * scale,
      y: v.height / 2 - (b.y + b.height / 2) * scale,
      scale
    };
  }
  function pinchCamera(camera, startMid, currentMid, factor, min = DEFAULT_MIN, max = DEFAULT_MAX) {
    const from = point(startMid), to = point(currentMid);
    const next = zoomCameraAt(camera, factor, from, min, max);
    return { x: next.x + to.x - from.x, y: next.y + to.y - from.y, scale: next.scale };
  }

  function create(viewport, options) {
    options = options || {};
    const world = options.world;
    if (!viewport || !world || !viewport.addEventListener || !world.style) {
      throw new TypeError('A viewport element and options.world element are required');
    }
    const min = options.minScale === undefined ? DEFAULT_MIN : options.minScale;
    const max = options.maxScale === undefined ? DEFAULT_MAX : options.maxScale;
    limits(min, max);
    const ownerWindow = viewport.ownerDocument.defaultView;
    const listeners = [], pointers = new Map();
    const original = {
      transform: world.style.transform,
      origin: world.style.transformOrigin,
      willChange: world.style.willChange,
      touchAction: viewport.style.touchAction,
      cursor: viewport.style.cursor,
      tabindex: viewport.getAttribute('tabindex'),
      panning: viewport.classList.contains('is-panning'),
      spacePan: viewport.classList.contains('space-pan')
    };
    let camera = { x: 0, y: 0, scale: 1 }, gesture = null, disposed = false;
    let spacePressed = false, dragging = false, suppressClickUntil = 0;
    let lastFit = null;
    const interactiveSelector = 'button,a,input,textarea,select,option,label,summary,[role="button"],[contenteditable]:not([contenteditable="false"]),[data-canvas-no-pan]';
    const editableSelector = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
    const closest = (target, selector) => target && target.closest ? target.closest(selector) : null;
    const local = (clientX, clientY) => {
      const r = viewport.getBoundingClientRect();
      return { x: clientX - r.left - viewport.clientLeft, y: clientY - r.top - viewport.clientTop };
    };
    const viewportSize = () => ({ width: Math.max(1, viewport.clientWidth), height: Math.max(1, viewport.clientHeight) });
    const getCamera = () => ({ ...camera });
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    function listen(target, event, handler, opts) {
      target.addEventListener(event, handler, opts);
      listeners.push(() => target.removeEventListener(event, handler, opts));
    }
    function cursor() {
      viewport.classList.toggle('is-panning', dragging || original.panning);
      viewport.classList.toggle('space-pan', spacePressed || original.spacePan);
      viewport.style.cursor = dragging ? 'grabbing' : spacePressed ? 'grab' : original.cursor;
    }
    function capture(id) {
      try { viewport.setPointerCapture(id); } catch (_) { /* Pointer may already have ended. */ }
    }
    function release(id) {
      try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch (_) {}
    }
    function suppressClick() {
      suppressClickUntil = Date.now() + 450;
    }
    function beginGesture() {
      const entries = [...pointers.values()];
      if (!entries.length) { gesture = null; return; }
      const touches = entries.filter(p => p.type === 'touch');
      if (touches.length >= 2) {
        const a = touches[0], b = touches[1];
        gesture = { kind: 'pinch', ids: [a.id, b.id], camera: getCamera(), mid: midpoint(a, b), distance: Math.max(1, distance(a, b)) };
      } else {
        const p = entries[0];
        gesture = { kind: 'pan', id: p.id, camera: getCamera(), start: { x: p.x, y: p.y } };
      }
    }
    function applyCamera(next) {
      if (disposed) return getCamera();
      const c = cameraValue(next);
      c.scale = clampScale(c.scale, min, max);
      camera = c;
      world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.scale})`;
      if (typeof options.onChange === 'function') options.onChange(getCamera());
      return getCamera();
    }
    function setCamera(next) {
      const result = applyCamera({ ...camera, ...next });
      if (pointers.size) beginGesture();
      return result;
    }
    function zoomAt(factor, clientX, clientY) {
      return setCamera(zoomCameraAt(camera, factor, local(clientX, clientY), min, max));
    }
    function fit(bounds, padding = 60) {
      lastFit = { bounds: rectangle(bounds), padding };
      return setCamera(fitCamera(lastFit.bounds, viewportSize(), padding, min, max));
    }
    function focus(bounds, scale) {
      return setCamera(focusCamera(camera, bounds, viewportSize(), scale, min, max));
    }
    function cancelPointers() {
      const ids = [...pointers.keys()];
      if (dragging) suppressClick();
      pointers.clear(); gesture = null; dragging = false;
      ids.forEach(release);
      cursor();
    }
    function reset() {
      spacePressed = false;
      cancelPointers();
    }
    function onPointerDown(event) {
      const touch = event.pointerType === 'touch';
      const editable = closest(event.target, editableSelector);
      // all4: [data-canvas-pan](만화 쪽 button)은 끌면 화면 이동, 그냥 누르면 click.
      const interactive = closest(event.target, interactiveSelector) && !closest(event.target, '[data-canvas-pan]');
      if (touch && editable) return;
      if (!touch && !(event.button === 1 || (event.button === 0 && !editable && (spacePressed || !interactive)))) return;
      // 창 밖에서 버튼을 놓아 pointerup을 못 받았으면(누를 때 포인터를 안 잡으므로) 남은 마우스 기록을 지운다
      if (!touch && pointers.size) { for (const [id, q] of pointers) if (q.type === 'mouse') pointers.delete(id); if (!pointers.size) dragging = false; else return; }
      const p = local(event.clientX, event.clientY);
      pointers.set(event.pointerId, { ...p, id: event.pointerId, type: touch ? 'touch' : 'mouse' });
      if (!interactive || !touch) viewport.focus({ preventScroll: true });
      if (!touch) {
        // all4: 누르는 순간엔 포인터를 잡지 않는다(잡으면 click이 viewport로 가서 카드 사진·여백을 눌러도 안 모이고 고정이 풀렸다). 4px 넘게 끌면 onPointerMove가 잡는다.
        event.preventDefault();
      } else if (pointers.size >= 2) {
        event.preventDefault();
        // Suppress the tap generated after a two-finger gesture, even at its scale limit.
        dragging = true; suppressClick();
        pointers.forEach(p => capture(p.id));
      }
      beginGesture(); cursor();
    }
    function onPointerMove(event) {
      const p = pointers.get(event.pointerId);
      if (!p || !gesture) return;
      Object.assign(p, local(event.clientX, event.clientY));
      if (gesture.kind === 'pinch') {
        const a = pointers.get(gesture.ids[0]), b = pointers.get(gesture.ids[1]);
        if (!a || !b) return;
        event.preventDefault(); dragging = true; suppressClick();
        applyCamera(pinchCamera(gesture.camera, gesture.mid, midpoint(a, b), Math.max(1, distance(a, b)) / gesture.distance, min, max));
      } else {
        if (gesture.id !== event.pointerId) return;
        const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
        if (!dragging && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
        event.preventDefault(); dragging = true; capture(p.id); suppressClick();
        applyCamera({ x: gesture.camera.x + dx, y: gesture.camera.y + dy, scale: gesture.camera.scale });
      }
      cursor();
    }
    function onPointerEnd(event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId); release(event.pointerId);
      if (dragging) suppressClick();
      if (!pointers.size) dragging = false;
      beginGesture(); cursor();
    }
    // 휠·트랙패드 (2026-10-13 작가: "pan 줌 너무 천천히"). 느린 건 성능이 아니라 손동작 배정이었다(실측 60~120fps, 휠 처리 0.09ms).
    //   예전: 모든 휠을 확대로 썼다(exp(-delta·0.0015)). 그래서 트랙패드 두 손가락 쓸기가 이동이 아니라 느린 확대였고,
    //   핀치(크롬·파이어폭스는 ctrlKey 붙은 휠로 보냄, delta가 작음)는 한 번에 0.5%쯤만 커졌다.
    //   지금(Figma식): ctrl/⌘ + 휠 = 확대(트랙패드 핀치·⌘+마우스 휠), 그 밖의 휠 = 화면 이동(픽셀 1:1, 맥 관성 스크롤도 그대로 따라옴).
    //   핀치(ctrlKey만): 배율 0.01/단위 = 예전의 6.7배. 크롬은 핀치 delta를 exp(-d·0.01)이 손가락 배율이 되게 보낸다(d3-zoom 약 0.014와 비슷).
    //     ±30으로 잘라 ctrl+마우스 휠 한 칸(delta≈100)은 1.35배까지만.
    //   ⌘+휠·⌘+쓸기(metaKey): 매직마우스·트랙패드는 작은 delta를 관성까지 수십 개 보내서, 핀치 배율을 쓰면 한 번 쓸기에 최소↔최대 끝까지 튀었다
    //     (검토에서 node로 확인: 관성 61개·누적 561px → 0.05에서 3.0). 그래서 배율 0.0025, 자르기 ±100 — 마우스 한 칸 1.28배, 쓸기는 약 4배 느림.
    function onWheel(event) {
      if (closest(event.target, editableSelector)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportSize().height : 1;
      if (event.ctrlKey || event.metaKey) {
        const pinch = event.ctrlKey && !event.metaKey, lim = pinch ? 30 : 100, k = pinch ? 0.01 : 0.0025;
        const delta = Math.max(-lim, Math.min(lim, event.deltaY * unit));
        if (delta) zoomAt(Math.exp(-delta * k), event.clientX, event.clientY);
        return;
      }
      let dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (event.shiftKey && !dx) { dx = dy; dy = 0; } // shift + 마우스 휠 = 가로 이동(맥은 브라우저가 이미 바꿔 주지만 윈도는 안 바꿈)
      if (dx || dy) setCamera({ x: camera.x - dx, y: camera.y - dy });
    }
    // 사파리는 트랙패드 핀치를 ctrlKey 휠이 아니라 gesture* 이벤트(scale = 시작 대비 배율)로 보낸다. 안 막으면 페이지 전체가 확대된다.
    //   아이폰·아이패드는 손가락 핀치에 포인터 이벤트와 gesture*를 함께 보낸다. 손가락 핀치는 이미 포인터 쪽(pinchCamera)이 처리하므로
    //   여기서 또 확대하면 두 배율이 곱해진다(검토에서 node로 확인: 2배로 벌리면 4배). 그래서 터치 포인터가 있으면 막기만 한다.
    //   gestureScale은 그때도 갱신해서, 도중에 처리 주체가 바뀌어도 다음 비율이 튀지 않게 한다. clientX가 없으면 화면 가운데 기준.
    let gestureScale = 1;
    const touchActive = () => { for (const p of pointers.values()) if (p.type === 'touch') return true; return false; };
    function onGestureStart(event) { event.preventDefault(); gestureScale = 1; }
    function onGestureChange(event) {
      event.preventDefault();
      const s = Number(event.scale) || 1;
      if (!touchActive()) {
        if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) zoomAt(s / gestureScale, event.clientX, event.clientY);
        else { const v = viewportSize(); setCamera(zoomCameraAt(camera, s / gestureScale, { x: v.width / 2, y: v.height / 2 }, min, max)); }
      }
      gestureScale = s;
    }
    function onKeyDown(event) {
      if (closest(event.target, editableSelector) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === ' ' || event.code === 'Space') {
        event.preventDefault(); spacePressed = true; cursor(); return;
      }
      const pan = (event.shiftKey ? 3 : 1) * 80;
      const directions = { ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
      if (directions[key]) {
        event.preventDefault();
        const [dx, dy] = directions[key];
        setCamera({ x: camera.x + dx, y: camera.y + dy });
      } else if (key === '+' || key === '=' || key === '-' || key === '_') {
        event.preventDefault();
        const v = viewportSize();
        setCamera(zoomCameraAt(camera, key === '+' || key === '=' ? 1.2 : 1 / 1.2, { x: v.width / 2, y: v.height / 2 }, min, max));
      } else if (key === '0') {
        event.preventDefault();
        if (lastFit) fit(lastFit.bounds, lastFit.padding);
      }
    }
    function onKeyUp(event) {
      if (event.key === ' ' || event.code === 'Space') {
        if (spacePressed) event.preventDefault();
        spacePressed = false; cursor();
      }
    }
    function destroy() {
      if (disposed) return;
      reset(); disposed = true;
      listeners.splice(0).forEach(remove => remove());
      world.style.transform = original.transform;
      world.style.transformOrigin = original.origin;
      world.style.willChange = original.willChange;
      viewport.style.touchAction = original.touchAction;
      viewport.style.cursor = original.cursor;
      viewport.classList.toggle('is-panning', original.panning);
      viewport.classList.toggle('space-pan', original.spacePan);
      if (original.tabindex === null) viewport.removeAttribute('tabindex');
      else viewport.setAttribute('tabindex', original.tabindex);
    }

    world.style.transformOrigin = '0 0';
    world.style.willChange = 'transform';
    viewport.style.touchAction = 'none';
    if (viewport.tabIndex < 0) viewport.tabIndex = 0;
    listen(viewport, 'pointerdown', onPointerDown);
    listen(viewport, 'pointermove', onPointerMove);
    listen(viewport, 'pointerup', onPointerEnd);
    listen(viewport, 'pointercancel', onPointerEnd);
    // Taking touch capture away from a page button emits a bubbling lost event
    // on that button. Only loss of our own capture ends the tracked gesture.
    listen(viewport, 'lostpointercapture', event => {
      if (event.target === viewport) onPointerEnd(event);
    });
    listen(viewport, 'wheel', onWheel, { passive: false });
    listen(viewport, 'gesturestart', onGestureStart, { passive: false });
    listen(viewport, 'gesturechange', onGestureChange, { passive: false });
    listen(viewport, 'gestureend', event => event.preventDefault(), { passive: false });
    listen(viewport, 'mousedown', event => { if (event.button === 1) event.preventDefault(); }, true);
    listen(viewport, 'auxclick', event => {
      if (event.button === 1) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    listen(viewport, 'click', event => {
      if (event.detail !== 0 && Date.now() < suppressClickUntil) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0;
      }
    }, true);
    listen(viewport, 'keydown', onKeyDown);
    listen(viewport, 'keyup', onKeyUp);
    listen(viewport, 'focusout', event => {
      if (!event.relatedTarget || !viewport.contains(event.relatedTarget)) reset();
    });
    if (ownerWindow) listen(ownerWindow, 'blur', reset);
    setCamera({ x: 0, y: 0, scale: 1, ...(options.initialCamera || {}) });
    return { getCamera, setCamera, zoomAt, fit, focus, destroy };
  }

  return { create, math: { clampScale, zoomCameraAt, fitCamera, focusCamera, pinchCamera } };
});
