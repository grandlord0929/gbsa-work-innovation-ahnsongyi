// 공문/OCR 원문 텍스트에서 업무 항목을 추출하는 로직.
// 프론트엔드 index.html 의 classify()/date()/analyze() 정규식 로직을 서버 측으로 이식하여
// 클라이언트-서버 판정 결과가 어긋나지 않도록 했다.

function classify(text) {
  const s = text.toLowerCase();
  if (/출퇴근|근태|복무|지문|소명/.test(s)) return 'service';
  if (/교육|수료증|이수증|보안|개인정보/.test(s)) return 'edu';
  return 'doc';
}

function parseDate(text) {
  const m = text.match(/(20\d{2})\s*[년.\/-]\s*(\d{1,2})\s*[월.\/-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const iso = text.match(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}/);
  return iso ? iso[0].replace(/\./g, '-').replace(/\//g, '-') : '';
}

function analyze(text) {
  const titleMatch = text.match(/(?:제목|업무명|건명)\s*[:：]\s*(.+)/);
  const title = (titleMatch && titleMatch[1]) || (text.split('\n').find((x) => x.trim()) || '공문 기반 행정업무');
  const due = parseDate(text);
  const deptMatch = text.match(/(?:요청부서|담당부서|소관부서)\s*[:：]\s*(.+)/);
  const dept = (deptMatch && deptMatch[1]) || '관리부서';
  const assigneeMatch = text.match(/(?:대상자|수신자)\s*[:：]\s*(.+)/);
  const assignee = (assigneeMatch && assigneeMatch[1]) || '전체 직원';

  return {
    title: title.trim(),
    due,
    dept: dept.trim(),
    assignee: assignee.trim(),
    cat: classify(text),
    raw: text,
  };
}

module.exports = { classify, parseDate, analyze };
