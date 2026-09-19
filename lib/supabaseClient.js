// Supabase(PostgreSQL) 클라이언트. 서버 측에서만 사용한다.
//   SUPABASE_URL : https://<project-ref>.supabase.co
//   SUPABASE_KEY : service_role 키 권장 (서버 전용 — 프론트/저장소/로그에 절대 노출 금지).
//                  테이블에 RLS 를 켜고 정책을 두지 않았으므로 anon 키로는 데이터를 읽을 수 없다.
const { createClient } = require('@supabase/supabase-js');

let client = null;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function getSupabase() {
  if (client) return client;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_KEY || '').trim();
  if (!url || !key) {
    throw httpError(503, 'SUPABASE_URL / SUPABASE_KEY 환경변수가 설정되지 않았습니다. 배포 환경(Vercel/Render)의 Environment Variables 를 확인하세요.');
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// 테스트에서 가짜 클라이언트를 주입하기 위한 훅
function __setClientForTests(c) { client = c; }

// supabase-js 결과 { data, error } 에서 error 를 예외로 바꾸고 data 를 돌려준다. (키/URL 은 메시지에 포함하지 않는다)
function must(result, what) {
  if (result && result.error) {
    const e = result.error;
    const msg = e.message || String(e);
    const missingTable = e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(msg);
    throw httpError(
      missingTable ? 503 : 500,
      missingTable
        ? `DB 테이블을 찾을 수 없습니다(${what}). Supabase SQL Editor 에서 supabase/schema.sql 을 실행했는지 확인하세요. (${msg})`
        : `DB 오류(${what}): ${msg}`
    );
  }
  return result ? result.data : null;
}

// PostgREST 는 한 번에 최대 1000행이므로 range 로 나눠 모두 읽는다. makeQuery 는 매번 새 쿼리 빌더를 반환해야 한다.
async function fetchAll(makeQuery, what, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = must(await makeQuery().range(from, from + pageSize - 1), what) || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

// 큰 배열을 나눠 insert (PostgREST 요청 본문 크기 제한 대비)
async function insertChunks(table, rows, what, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    must(await getSupabase().from(table).insert(rows.slice(i, i + chunk)), what || `${table} insert`);
  }
}

module.exports = { getSupabase, __setClientForTests, must, fetchAll, insertChunks, httpError };
