// 수료증 OCR 결과(교육명/원문/파일명)와 미제출 교육 업무를 매칭한다.
// 공백을 모두 제거한 문자열로 비교해 OCR이 한글 사이에 넣는 불필요한 띄어쓰기에 강하게 만든다.
const KEYWORDS = [
  '정보보안', '개인정보', '보안', '청렴', '성희롱', '성폭력', '산업안전', '안전', '장애인',
  '폭력예방', '괴롭힘', '부패방지', '윤리', '인권', '저작권', '재난', '소방', '응급',
];
const GENERIC = new Set(['교육', '수료증', '이수증', '제출', '요청', '자료', '필수', '법정']);

const compact = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

function scoreTask(task, hay) {
  const title = compact(task.title);
  let score = 0;
  for (const k of KEYWORDS) {
    if (title.includes(k) && hay.includes(k)) score += k.length >= 4 ? 3 : 2;
  }
  const tokens = task.title.match(/[가-힣]{2,}/g) || [];
  for (const tok of tokens) {
    if (!GENERIC.has(tok) && hay.includes(tok)) score += 1;
  }
  return score;
}

// pendingTasks 중 가장 잘 맞는 1건을 고른다. 모호하면 task=null + candidates 반환.
function pickMatch(pendingTasks, { courseName, ocrText, fileName }) {
  const hay = compact([courseName, ocrText, fileName].join(' '));
  const scored = pendingTasks
    .map((task) => ({ task, score: scoreTask(task, hay) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (best && best.score > 0 && (!second || best.score > second.score)) {
    return { task: best.task, score: best.score, matchedBy: 'keyword' };
  }
  if (pendingTasks.length === 1) {
    return { task: pendingTasks[0], score: 0, matchedBy: 'only-pending' };
  }
  return { task: null, candidates: scored.map((s) => s.task) };
}

module.exports = { pickMatch, compact };
