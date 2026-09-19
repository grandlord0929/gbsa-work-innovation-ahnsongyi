// 마감일(due)과 오늘 날짜를 비교해 상태(status)를 자동 보정한다.
// 이미 'done'인 업무는 건드리지 않고, 그 외에는 D-day 기준으로 재계산한다.
function recomputeStatus(due, currentStatus) {
  if (currentStatus === 'done' || !due) return currentStatus;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(due + 'T00:00:00');
  if (Number.isNaN(dueDate.getTime())) return currentStatus;

  const diffDays = Math.round((dueDate - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 1) return 'urgent';
  if (diffDays <= 3) return 'warn';
  return 'normal';
}

module.exports = { recomputeStatus };
