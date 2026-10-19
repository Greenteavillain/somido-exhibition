/* 벽 화살표 길찾기를 화면 밖(웹 워커)에서 돌린다. 2026-10-13.
   작가: 새로고침할 때마다 빈 틀이 2초쯤 보임("이거 왜 계속 뜨는거야… 진짜 개못생겼다").
   잰 값: 벽 짓기 2.06초 중 1.60초가 이 길찾기(routeCrossArrows)였다. all4에서는 화살표가 마우스를 올리기 전엔 숨어 있으므로,
   쪽·카드를 먼저 그리고 길찾기는 여기서 돌려 끝나면 선·문구만 붙인다(app.js startCrossRouting).
   cross-router.js는 DOM을 쓰지 않는 순수 함수라 그대로 불러 쓴다. 파일로 직접 연(file://) 화면에선 워커가 안 떠서 app.js가 같은 함수를 늦게 직접 부른다. */
importScripts('cross-router.js');
onmessage = e => {
  const { id, input } = e.data;
  try {
    const r = routeCrossArrows(input);
    postMessage({ id, routes: r.routes, stats: { ms: r.stats.ms, iters: r.stats.log.length } });
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err) });
  }
};
