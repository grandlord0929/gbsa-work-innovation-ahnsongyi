// Supabase 초기 데이터 시드: 가상 사원 200명 + 기본 업무 체크리스트.
//   npm run seed                 seed-data/*.csv(백업 데이터)로 사원·업무·제출 이력을 통째로 교체 (멱등: 여러 번 실행해도 같은 결과)
//   npm run seed -- --synthetic  이전 방식: 가상 사원 200명 upsert + 업무가 비어 있을 때만 시드
//   npm run seed -- --synthetic --reset  업무/제출/요청/대화 이력을 지우고 가상 업무를 다시 시드 (사원 유지)
// 필요 환경변수: SUPABASE_URL, SUPABASE_KEY(service_role) — .env 또는 셸 환경변수
const { getSupabase } = require('../lib/supabaseClient');
const { seedEmployees, seedTasks, clearTasks } = require('../lib/seedData');
const { listEmployees, invalidateEmployees } = require('../lib/data');
const { seedFromCsv, csvAvailable } = require('../lib/seedCsv');

const TABLES = ['employees', 'requests', 'tasks', 'submissions', 'chat_logs'];

async function checkTables(sb) {
  const missing = [];
  for (const t of TABLES) {
    const r = await sb.from(t).select('*').limit(1);
    if (r.error) missing.push(`${t} (${r.error.message})`);
  }
  if (missing.length) {
    console.error('❌ 아래 테이블에 접근할 수 없습니다:\n  - ' + missing.join('\n  - '));
    console.error('\n→ Supabase 대시보드 → SQL Editor 에서 supabase/schema.sql 전체를 실행한 뒤 다시 시도하세요.');
    console.error('→ SUPABASE_KEY 는 anon 키가 아니라 service_role 키여야 합니다 (RLS 가 anon 접근을 막습니다).');
    process.exit(1);
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  let sb;
  try { sb = getSupabase(); } catch (e) { console.error('❌ ' + e.message); process.exit(1); }

  await checkTables(sb);
  console.log('✓ Supabase 연결 및 테이블 확인 완료');

  if (!process.argv.includes('--synthetic')) {
    if (!csvAvailable()) { console.error('❌ seed-data/*.csv 가 없습니다. (가상 데이터를 쓰려면: npm run seed -- --synthetic)'); process.exit(1); }
    const r = await seedFromCsv();
    invalidateEmployees();
    console.log(`✓ 백업 CSV 로 교체 완료: 사원 ${r.employees}명 · 업무 ${r.tasks}건 · 제출 이력 ${r.submissions}건`);
    return;
  }

  const nEmp = await seedEmployees();
  invalidateEmployees();
  console.log(`✓ 사원 ${nEmp}명 upsert 완료 (홍길동 = GBSA2026001)`);

  const existing = await sb.from('tasks').select('id').limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data.length > 0 && !reset) {
    console.log('ℹ️ tasks 에 이미 데이터가 있어 업무 시드를 건너뜁니다. (처음부터 다시 만들려면: npm run seed -- --reset)');
    return;
  }
  if (reset) { await clearTasks(); console.log('✓ 기존 업무/제출/요청/대화 이력 삭제'); }

  const emps = (await listEmployees()).map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept }));
  const nTask = await seedTasks(emps);
  console.log(`✓ 업무 ${nTask}건 시드 완료`);
}

main().then(() => console.log('완료')).catch((e) => { console.error('❌ 시드 실패:', e.message); process.exit(1); });
