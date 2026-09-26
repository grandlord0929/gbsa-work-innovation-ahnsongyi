// 가상(허구) 시연 데이터 생성 + Supabase 시드/초기화. scripts/seedSupabase.js 와 POST /api/demo/reset 이 함께 사용한다.
const { getSupabase, must, insertChunks } = require('./supabaseClient');
const { recomputeStatus } = require('./dday');
const { todayStr, addDays } = require('./time');

// ---------- 사원 200명 (시드 고정 난수 → 언제 생성해도 같은 명단) ----------
function sampleEmployees() {
  let seed = 20260919;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const family = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
  const given = ['서윤', '하준', '지유', '도윤', '서연', '시우', '민서', '예준', '하윤', '주원', '지호', '수아', '지안', '건우', '유나', '현우', '채원', '준서', '다은', '은우', '소율', '태민', '나윤', '승현', '아린'];
  const depts = [['정책기획팀', 35], ['HRD기획팀', 36], ['감사담당관실', 31], ['바이오센터', 30], ['ICT융합팀', 27], ['경영지원팀', 22], ['총무인사팀', 19]];

  const list = depts.flatMap(([d, n]) => Array.from({ length: n }, () => d));
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }

  const rows = list.map((dept, i) => ({
    emp_no: `GBSA2026${String(i + 1).padStart(3, '0')}`,
    name: i === 0 ? '홍길동' : pick(family) + pick(given),
    dept: i === 0 ? '바이오센터' : dept,
  }));
  // 홍길동이 바이오센터로 고정되므로 부서 인원수를 원래 분포(바이오센터 30명)에 맞춘다
  if (list[0] !== '바이오센터') { const k = list.indexOf('바이오센터', 1); rows[k].dept = list[0]; }
  return rows;
}

const fnv = (s) => {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
};

// 마감일은 실행 시점(KST) 기준 상대값 → 언제 시연해도 긴급/주의/기한초과가 골고루 보인다.
const SEED_REQUESTS = [
  { title: '2026년 법정 필수 개인정보보호 교육 수료증 제출', cat: 'edu', dept: '감사담당관실', off: -5, bias: 10 },
  { title: '2026년 상반기 주요 연구성과지표 도의회 요구자료 회신', cat: 'doc', dept: '경영지원팀', off: 0, bias: 0 },
  { title: '2026년 하반기 정보보안 교육 이수증 제출', cat: 'edu', dept: 'ICT융합팀', off: 2, bias: -5 },
  { title: '사내 직무역량진단 결과 분석 자료 제출 요청', cat: 'doc', dept: 'HRD기획팀', off: 6, bias: -20 },
];

// ---------- Supabase 에 반영 ----------
async function seedEmployees() {
  const rows = sampleEmployees();
  for (let i = 0; i < rows.length; i += 500) {
    must(await getSupabase().from('employees').upsert(rows.slice(i, i + 500), { onConflict: 'emp_no' }), 'employees 시드');
  }
  return rows.length;
}

async function insertRequest({ title, cat, requester_dept, target_dept, due }) {
  const rows = must(
    await getSupabase().from('requests').insert({ title, cat, requester_dept, target_dept, due }).select('id'),
    'requests 생성'
  );
  return Number(rows[0].id);
}

// 초기 업무 배포: 전 직원 대상 4건 + 로그인 사원 개별 소명서 1건
async function seedTasks(employees) {
  const me = employees.find((e) => e.name === '홍길동') || employees.find((e) => e.dept === '바이오센터') || employees[0];
  if (!me) throw new Error('사원이 없어 업무를 시드할 수 없습니다. 먼저 사원을 시드하세요.');
  const today = todayStr();
  const taskRows = [];

  for (const d of SEED_REQUESTS) {
    const due = addDays(today, d.off);
    const requestId = await insertRequest({ title: d.title, cat: d.cat, requester_dept: d.dept, target_dept: '전체', due });
    const base = recomputeStatus(due, 'normal');
    for (const e of employees) {
      // 로그인 사원은 항상 미제출로 시작(시연 흐름 보장). 나머지 사원의 초기 제출 이력은 시연용 시뮬레이션.
      const rate = Math.min(95, Math.max(5, 45 + (fnv(e.dept) % 40) + d.bias));
      const done = e.emp_no !== me.emp_no && fnv(e.emp_no + '|' + d.title) % 100 < rate;
      taskRows.push({
        cat: d.cat, title: d.title, dept: d.dept, assignee: e.name, due, status: done ? 'done' : base,
        emp_no: e.emp_no, emp_name: e.name, emp_dept: e.dept, request_id: requestId,
      });
    }
  }

  const soDue = addDays(today, 1);
  const soTitle = '출퇴근 지문 미인식 소명서 제출 (근태 누락분)';
  const soId = await insertRequest({ title: soTitle, cat: 'service', requester_dept: '총무인사팀', target_dept: `${me.dept} (개별)`, due: soDue });
  taskRows.push({
    cat: 'service', title: soTitle, dept: '총무인사팀', assignee: me.name, due: soDue, status: recomputeStatus(soDue, 'normal'),
    emp_no: me.emp_no, emp_name: me.name, emp_dept: me.dept, request_id: soId,
  });

  await insertChunks('tasks', taskRows, 'tasks 시드');
  return taskRows.length;
}

// 업무/제출/요청/대화 이력을 모두 지운다 (사원은 유지). PostgREST 는 조건 없는 delete 를 막으므로 항상 참인 조건을 준다.
async function clearTasks() {
  const sb = getSupabase();
  must(await sb.from('submissions').delete().gte('id', 0), 'submissions 삭제');
  must(await sb.from('tasks').delete().gte('id', 0), 'tasks 삭제');
  must(await sb.from('requests').delete().gte('id', 0), 'requests 삭제');
  must(await sb.from('chat_logs').delete().gte('id', 0), 'chat_logs 삭제');
}

// 시연 초기화: 업무 이력을 지우고 초기 시드로 되돌린다. seed-data/*.csv 가 있으면 CSV 데이터(사원 포함)로 교체한다(SEED_SOURCE=synthetic 이면 가상 200명). 사원이 하나도 없으면 사원도 시드한다.
async function resetDemo() {
  const { invalidateEmployees, listEmployees } = require('./data');
  const csv = require('./seedCsv');
  if (csv.useCsv()) { const r = await csv.seedFromCsv(); invalidateEmployees(); return { employees: r.employees, tasks: r.tasks }; }
  invalidateEmployees();
  let emps = await listEmployees();
  if (emps.length === 0) {
    await seedEmployees();
    invalidateEmployees();
    emps = await listEmployees();
  }
  await clearTasks();
  const n = await seedTasks(emps.map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept })));
  return { employees: emps.length, tasks: n };
}

module.exports = { sampleEmployees, seedEmployees, seedTasks, clearTasks, resetDemo, SEED_REQUESTS };
