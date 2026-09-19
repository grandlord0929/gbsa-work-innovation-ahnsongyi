// 마감일(due)과 오늘(KST)을 비교해 상태(status)를 계산한다. 이미 'done'인 업무는 그대로 둔다.
const { todayStr, diffDays } = require('./time');

function recomputeStatus(due, currentStatus) {
  if (currentStatus === 'done' || !due) return currentStatus;
  const n = diffDays(todayStr(), String(due).slice(0, 10));
  if (Number.isNaN(n)) return currentStatus;
  if (n < 0) return 'overdue';
  if (n <= 1) return 'urgent';
  if (n <= 3) return 'warn';
  return 'normal';
}

module.exports = { recomputeStatus };
