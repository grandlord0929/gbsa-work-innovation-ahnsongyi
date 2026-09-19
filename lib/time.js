// 한국 표준시(Asia/Seoul) 기준 날짜/시각 유틸. 서버 OS 시간대(Vercel 은 UTC)와 무관하게 동작한다.
const TZ = 'Asia/Seoul';

const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// 오늘(KST) 'YYYY-MM-DD'
const todayStr = () => dateFmt.format(new Date());

// 'YYYY-MM-DD' 에 일수를 더한 'YYYY-MM-DD'
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 두 'YYYY-MM-DD' 의 일수 차이 (b - a)
const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// timestamptz(ISO) → KST 'YYYY-MM-DD HH:MM:SS' (프론트가 slice 로 표시)
function fmtKst(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : dateTimeFmt.format(d);
}

const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

module.exports = { TZ, todayStr, addDays, diffDays, fmtKst, isValidDate };
