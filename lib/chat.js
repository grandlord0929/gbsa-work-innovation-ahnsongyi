// 챗봇 규칙 기반 응답. 프론트엔드 reply() 로직을 서버 측으로 이식해
// 실시간 업무 데이터(DB)를 반영한 답변을 준다.
const { todayStr } = require('./time');

function reply(question, tasks) {
  const q = question || '';
  const pending = tasks.filter((t) => t.status !== 'done');

  if (/미제출|목록/.test(q)) {
    return `현재 미제출 항목은 ${pending.length}건입니다: ${pending.map((t) => t.title).join(', ') || '없음'}`;
  }
  if (/오늘/.test(q)) {
    const today = todayStr();
    const todayTasks = pending.filter((t) => t.due === today);
    if (todayTasks.length === 0) return '오늘 마감인 업무는 없습니다.';
    return `오늘 마감 업무는 ${todayTasks.map((t) => t.title).join(', ')} 입니다.`;
  }
  if (/교육|수료증/.test(q)) {
    return '교육 수료증은 하단 업로드 영역에 올리면 자동 인식·제출됩니다.';
  }
  if (/기한초과|초과/.test(q)) {
    const overdue = pending.filter((t) => t.status === 'overdue');
    return overdue.length
      ? `기한 초과 항목: ${overdue.map((t) => t.title).join(', ')}`
      : '기한 초과된 업무가 없습니다.';
  }
  return '예시: 오늘 마감자료, 미제출 목록, 기한초과 항목, 교육 수료증 업로드를 물어보세요.';
}

module.exports = { reply };
