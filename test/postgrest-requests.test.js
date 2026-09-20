// 실제 @supabase/supabase-js 를 그대로 쓰되 fetch 만 가로채서, 우리 코드가 만들어내는 PostgREST HTTP 요청의 형태를 검증한다.
// (응답 의미론은 검증하지 않음 — 그건 api.test.js 의 가짜 클라이언트 + 실제 Supabase 배포 확인 몫)
const test = require('node:test');
const assert = require('node:assert/strict');

const KEY = 'test-service-role-key-DO-NOT-LEAK';
const sent = [];
const canned = (url, method) => {
  const u = new URL(url);
  if (method === 'GET' || method === 'HEAD') return [];
  if (u.searchParams.get('select')) return [{ id: 1 }];
  return null;
};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();
  const headers = Object.fromEntries(new Headers(init.headers || {}));
  sent.push({ method, url, u: new URL(url), headers, body: init.body ? JSON.parse(init.body) : undefined });
  const data = canned(url, method);
  return new Response(data === null ? null : JSON.stringify(data), { status: data === null ? 201 : 200, headers: { 'content-type': 'application/json' } });
};

process.env.SUPABASE_URL = 'https://example-project.supabase.co';
process.env.SUPABASE_KEY = KEY;
const client = require('../lib/supabaseClient');
client.__setClientForTests(null);
const data = require('../lib/data');
const seed = require('../lib/seedData');

const last = () => sent[sent.length - 1];
const decoded = (r) => decodeURIComponent(r.u.search);
test.beforeEach(() => { sent.length = 0; data.invalidateEmployees(); });

test('모든 요청은 /rest/v1 로 가고 키는 헤더로만 전달된다 (URL/본문에 노출 안 됨)', async () => {
  await data.listEmployees();
  const r = last();
  assert.equal(r.method, 'GET');
  assert.equal(r.u.origin, 'https://example-project.supabase.co');
  assert.match(r.u.pathname, /^\/rest\/v1\/employees$/);
  assert.equal(r.headers.apikey, KEY);
  assert.equal(r.headers.authorization, `Bearer ${KEY}`);
  assert.equal(sent.some((x) => x.url.includes(KEY) || JSON.stringify(x.body || '').includes(KEY)), false);
});

test('employees 조회: 필요한 컬럼만, 정렬, 1000행 페이지네이션', async () => {
  await data.listEmployees();
  const r = last();
  assert.equal(r.u.searchParams.get('select'), 'emp_no,name,dept');
  assert.equal(r.u.searchParams.get('order'), 'emp_no.asc');
  assert.equal(r.u.searchParams.get('limit'), '1000');
  assert.equal(r.u.searchParams.get('offset'), '0');
});

test('내 업무 조회: eq 필터 + 수료증 조회는 in 필터', async () => {
  await data.tasksByEmp('GBSA2026001', { cat: 'edu' });
  const r = sent.find((x) => x.u.pathname.endsWith('/tasks'));
  assert.equal(r.u.searchParams.get('emp_no'), 'eq.GBSA2026001');
  assert.equal(r.u.searchParams.get('cat'), 'eq.edu');
  assert.match(r.u.searchParams.get('select'), /^id,cat,title,dept,assignee,due,status,source_raw,emp_no,emp_name,emp_dept,request_id,created_at,updated_at$/);
});

test('수료증 조회: task_id=in.(...) + 최신순', async () => {
  const before = sent.length;
  await require('../lib/data').tasksByEmp('X'); // 빈 결과라 submissions 조회 없음
  assert.equal(sent.length - before, 1);
  // certsFor 는 내부 함수이므로 done 업무가 있는 응답을 흉내 내어 간접 검증
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url);
    sent.push({ method: (init.method || 'GET'), url, u, headers: Object.fromEntries(new Headers(init.headers || {})) });
    const rows = u.pathname.endsWith('/tasks')
      ? [{ id: 7, cat: 'edu', title: 't', dept: 'd', assignee: 'a', due: '2099-01-01', status: 'done', source_raw: null, emp_no: 'X', emp_name: 'n', emp_dept: 'd', request_id: 1, created_at: '2026-09-19T00:00:00Z', updated_at: '2026-09-19T00:00:00Z' }]
      : [];
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  sent.length = 0;
  await data.tasksByEmp('X');
  globalThis.fetch = orig;
  const sub = sent.find((x) => x.u.pathname.endsWith('/submissions'));
  assert.ok(sub, 'submissions 조회가 발생해야 함');
  assert.equal(sub.u.searchParams.get('task_id'), 'in.(7)');
  assert.equal(sub.u.searchParams.get('order'), 'id.desc');
});

test('제출 처리: 이미 done 이 아닌 행만 PATCH + 반환 요청, 이어서 이력 POST', async () => {
  await data.recordSubmission(5, { fixedName: '수료증.png' }, { course_name: 'c', issuer: 'i', completed_date: '2026-09-18', ocr_text: 'o' }, 'keyword');
  const patch = sent.find((x) => x.method === 'PATCH');
  assert.match(patch.u.pathname, /\/tasks$/);
  assert.equal(patch.u.searchParams.get('id'), 'eq.5');
  assert.equal(patch.u.searchParams.get('status'), 'neq.done');
  assert.equal(patch.u.searchParams.get('select'), 'id');
  assert.match(patch.headers.prefer || '', /return=representation/);
  assert.equal(patch.body.status, 'done');
  const post = sent.find((x) => x.method === 'POST');
  assert.match(post.u.pathname, /\/submissions$/);
  assert.equal(post.body.task_id, 5);
  assert.equal(post.body.file_name, '수료증.png');
});

test('사원 시드: upsert(on_conflict=emp_no, merge-duplicates), 500건 단위', async () => {
  await seed.seedEmployees();
  const posts = sent.filter((x) => x.method === 'POST');
  assert.equal(posts.length, 1); // 200명 → 1회
  assert.equal(posts[0].u.searchParams.get('on_conflict'), 'emp_no');
  assert.match(posts[0].headers.prefer || '', /resolution=merge-duplicates/);
  assert.equal(posts[0].body.length, 200);
});

test('초기화: 조건 있는 DELETE 4건(순서: submissions → tasks → requests → chat_logs)', async () => {
  await seed.clearTasks();
  const dels = sent.filter((x) => x.method === 'DELETE');
  assert.deepEqual(dels.map((d) => d.u.pathname.split('/').pop()), ['submissions', 'tasks', 'requests', 'chat_logs']);
  for (const d of dels) assert.equal(d.u.searchParams.get('id'), 'gte.0'); // 조건 없는 DELETE 는 Supabase 가 거부
});

test('업무 시드: requests 는 id 를 돌려받고, tasks 는 500건씩 나눠 insert', async () => {
  const emps = require('../lib/seedData').sampleEmployees();
  await seed.seedTasks(emps);
  const reqPosts = sent.filter((x) => x.method === 'POST' && x.u.pathname.endsWith('/requests'));
  assert.equal(reqPosts.length, 5);
  for (const r of reqPosts) { assert.equal(r.u.searchParams.get('select'), 'id'); assert.match(r.headers.prefer || '', /return=representation/); }
  const taskPosts = sent.filter((x) => x.method === 'POST' && x.u.pathname.endsWith('/tasks'));
  assert.deepEqual(taskPosts.map((p) => p.body.length), [500, 301]); // 801건
  assert.equal(taskPosts[0].body[0].emp_no.startsWith('GBSA2026'), true);
});

test('요청 헤더/본문에 서비스 키가 한 번도 실리지 않는다(헤더 제외)', () => {
  for (const r of sent) { assert.equal(r.url.includes(KEY), false); assert.equal(JSON.stringify(r.body || '').includes(KEY), false); }
});

// ---- SUPABASE_URL 입력 실수에 대한 방어 (대시보드 'REST URL' 복사 등) ----
async function requestPathFor(rawUrl) {
  const saved = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = rawUrl;
  client.__setClientForTests(null);
  sent.length = 0; data.invalidateEmployees();
  try { await data.listEmployees(); return last(); }
  finally { process.env.SUPABASE_URL = saved; client.__setClientForTests(null); data.invalidateEmployees(); }
}

test('SUPABASE_URL 에 /rest/v1 이 붙어 있어도 경로가 이중으로 만들어지지 않는다', async () => {
  for (const raw of ['https://example-project.supabase.co/rest/v1', 'https://example-project.supabase.co/rest/v1/', 'https://example-project.supabase.co/', 'https://example-project.supabase.co/dashboard?x=1']) {
    const r = await requestPathFor(raw);
    assert.equal(r.u.origin, 'https://example-project.supabase.co', raw);
    assert.equal(r.u.pathname, '/rest/v1/employees', raw);
  }
});

test('SUPABASE_URL 앞뒤 공백/줄바꿈/따옴표/프로토콜 누락도 보정한다', async () => {
  for (const raw of ['  https://example-project.supabase.co\n', '"https://example-project.supabase.co"', "'https://example-project.supabase.co/rest/v1'", 'example-project.supabase.co']) {
    const r = await requestPathFor(raw);
    assert.equal(r.u.origin, 'https://example-project.supabase.co', JSON.stringify(raw));
    assert.equal(r.u.pathname, '/rest/v1/employees', JSON.stringify(raw));
  }
});

test('잘못된 URL 은 503 안내 오류, 설정 상태 요약은 값을 노출하지 않는다', async () => {
  await assert.rejects(() => requestPathFor('http://'), (e) => e.status === 503 && /SUPABASE_URL 형식/.test(e.message));
  process.env.SUPABASE_URL = 'https://example-project.supabase.co/rest/v1';
  const d = client.describeSupabaseEnv();
  assert.deepEqual(d, { SUPABASE_URL: true, SUPABASE_KEY: true, urlValid: true, urlHadExtraPath: true });
  assert.equal(JSON.stringify(d).includes('example-project'), false);
  assert.equal(JSON.stringify(d).includes(KEY), false);
  process.env.SUPABASE_URL = 'https://example-project.supabase.co';
  assert.equal(client.describeSupabaseEnv().urlHadExtraPath, false);
});

test('Supabase 오류 코드별 안내 문구 (경로 오류 / 키 오류)', () => {
  assert.throws(() => client.must({ error: { code: 'PGRST125', message: 'Invalid path specified in request URL' } }, 'employees 조회'),
    (e) => e.status === 503 && /SUPABASE_URL/.test(e.message));
  assert.throws(() => client.must({ error: { message: 'Invalid API key' } }, 'x'), (e) => e.status === 500 && /service_role/.test(e.message));
  assert.throws(() => client.must({ error: { code: 'PGRST205', message: "Could not find the table 'public.tasks' in the schema cache" } }, 'x'), (e) => /schema\.sql/.test(e.message));
});
