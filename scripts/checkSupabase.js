// Supabase 연결/키/데이터 진단 (읽기 전용, 값은 출력하지 않음).  npm run db:check
//  - 키 종류(service_role / anon / 새 형식 sb_secret_·sb_publishable_)와 URL 일치 여부
//  - 테이블 5개 접근 가능 여부와 행 수
//  - 사원/업무 데이터 정합성(200명, 부서 분포, 업무 수, 제출 수)
const { getSupabase } = require('../lib/supabaseClient');

const TABLES = ['employees', 'requests', 'tasks', 'submissions', 'chat_logs'];
const mask = (s) => (s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-3)}`);

function describeKey(key) {
  if (key.startsWith('sb_secret_')) return { kind: 'secret 키 (새 형식, 서버용) ✓', ok: true };
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable 키 (새 형식, 브라우저용) ✗ — 서버에는 secret 키가 필요', ok: false };
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const p = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const ok = p.role === 'service_role';
      const exp = p.exp ? new Date(p.exp * 1000).toISOString().slice(0, 10) : '없음';
      return { kind: `JWT role=${p.role}${ok ? ' ✓' : ' ✗ — 서버에는 service_role 키가 필요 (anon 키는 RLS 로 차단됨)'}, 만료 ${exp}`, ok, ref: p.ref };
    } catch { /* fallthrough */ }
  }
  return { kind: '알 수 없는 형식의 키', ok: false };
}

async function main() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_KEY || '').trim();
  console.log('== Supabase 연결 진단');
  if (!url || !key) { console.error('❌ SUPABASE_URL / SUPABASE_KEY 가 설정되지 않았습니다 (.env 확인)'); process.exit(1); }

  const host = (() => { try { return new URL(url).host; } catch { return null; } })();
  console.log(`URL   : ${host ? `${url.startsWith('https') ? 'https' : 'http'}://${mask(host)}` : '❌ URL 형식 오류'}`);
  if (!host) process.exit(1);
  if (/\/rest\/v1|\/$/.test(new URL(url).pathname) && new URL(url).pathname !== '/') console.log('⚠️  URL 에 경로가 포함돼 있습니다. https://<ref>.supabase.co 형태(경로 없음)여야 합니다.');

  const k = describeKey(key);
  console.log(`KEY   : ${mask(key)}  → ${k.kind}`);
  if (k.ref && !host.startsWith(k.ref + '.')) console.log(`⚠️  키의 프로젝트(ref)와 SUPABASE_URL 의 프로젝트가 다릅니다.`);

  const sb = getSupabase();
  console.log('\n== 테이블 접근 (행 수)');
  let bad = 0; const counts = {};
  for (const t of TABLES) {
    const r = await sb.from(t).select('*', { count: 'exact', head: true });
    if (r.error) { bad += 1; console.log(`  ✗ ${t.padEnd(12)} ${r.error.message} (${r.error.code || '-'})`); }
    else { counts[t] = r.count; console.log(`  ✓ ${t.padEnd(12)} ${String(r.count).padStart(5)}행`); }
  }
  if (bad) {
    console.log('\n❌ 일부 테이블에 접근할 수 없습니다.');
    console.log('   · 테이블이 없다면 → SQL Editor 에서 supabase/schema.sql 실행');
    console.log('   · permission denied / Invalid API key 라면 → service_role(secret) 키인지, 같은 프로젝트의 키인지 확인');
    process.exit(1);
  }

  console.log('\n== 데이터 정합성');
  const emps = (await sb.from('employees').select('emp_no,name,dept')).data || [];
  const byDept = {}; emps.forEach((e) => { byDept[e.dept] = (byDept[e.dept] || 0) + 1; });
  console.log(`  사원 ${emps.length}명 · 부서 ${Object.keys(byDept).length}개 (${Object.entries(byDept).map(([d, n]) => `${d} ${n}`).join(', ')})`);
  const hong = emps.find((e) => e.name === '홍길동');
  console.log(`  기본 로그인 사원: ${hong ? `${hong.name} / ${hong.dept} / ${hong.emp_no}` : '홍길동 없음 → 바이오센터 첫 사원 사용'}`);
  const done = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'done');
  console.log(`  업무 ${counts.tasks}건 (제출완료 ${done.count}건, 요청 ${counts.requests}건, 제출이력 ${counts.submissions}건)`);
  if (emps.length === 0) console.log('  ⚠️ 사원이 비어 있습니다 → npm run seed');
  console.log('\n✅ Supabase 연결 정상 — 키 권한과 테이블 모두 확인되었습니다.');
}

main().catch((e) => { console.error('❌ 진단 실패:', e.message); process.exit(1); });
