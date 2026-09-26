// 사번 로그인/세션/접근 제어 테스트 (인메모리 가짜 Supabase)
process.env.SEED_SOURCE = 'synthetic';
delete process.env.BASIC_AUTH_PASS;
process.env.NODE_ENV = 'test';
delete process.env.ADMIN_EMP_NOS;
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./fakeSupabase');
const client = require('../lib/supabaseClient');
const data = require('../lib/data');
const seed = require('../lib/seedData');
const S = require('../lib/session');

let server; let base;
test.before(async () => {
  client.__setClientForTests(createFakeSupabase());
  data.invalidateEmployees();
  await seed.seedEmployees(); data.invalidateEmployees();
  await seed.seedTasks((await data.listEmployees()).map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept })));
  const app = require('../server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server && server.close());

const call = (path, { cookie, json, method } = {}) => fetch(base + path, {
  method: method || (json ? 'POST' : 'GET'),
  headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: json ? JSON.stringify(json) : undefined,
});
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const login = (id, password = id) => call('/api/auth/login', { json: { id, password } });

test('로그인 안 한 요청은 보호 API 에서 401 LOGIN_REQUIRED, 공개 API 는 통과', async () => {
  for (const p of ['/api/tasks', '/api/me', '/api/employees', '/api/admin/overview', '/api/stats', '/api/auth/me']) {
    const r = await call(p); assert.equal(r.status, 401, p); assert.equal((await r.json()).code, 'LOGIN_REQUIRED');
  }
  assert.equal((await call('/api/health')).status, 200);
});

test('사번=비밀번호로 로그인하면 프로필과 HttpOnly 세션 쿠키를 받는다', async () => {
  const r = await login('GBSA2026001');
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.deepEqual([b.user.empNo, b.user.name, b.user.dept], ['GBSA2026001', '홍길동', '바이오센터']);
  assert.equal(b.message, '홍길동 님 환영합니다');
  const raw = r.headers.get('set-cookie');
  assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Lax/); assert.match(raw, /Max-Age=28800/);
});

test('세션 유지: 쿠키로 /api/auth/me, /api/me, /api/tasks(사번 미지정)가 로그인 사원으로 매핑된다', async () => {
  const c = cookieOf(await login('gbsa2026001')); // 대소문자 무관
  const me = await (await call('/api/auth/me', { cookie: c })).json();
  assert.equal(me.user.name, '홍길동');
  assert.equal((await (await call('/api/me', { cookie: c })).json()).empNo, 'GBSA2026001');
  const tasks = await (await call('/api/tasks', { cookie: c })).json();
  assert.equal(tasks.length, 5); assert.ok(tasks.every((t) => t.emp_no === 'GBSA2026001'));
  const other = (await data.listEmployees()).find((e) => e.empNo !== 'GBSA2026001');
  const c2 = cookieOf(await login(other.empNo));
  const t2 = await (await call('/api/tasks', { cookie: c2 })).json();
  assert.ok(t2.length > 0 && t2.every((t) => t.emp_no === other.empNo));
});

test('잘못된 비밀번호/없는 사번/빈 값은 거절하고 사유를 구분해 알려주지 않는다', async () => {
  const a = await login('GBSA2026001', 'wrong'), b = await login('NOPE9999');
  assert.deepEqual([a.status, b.status], [401, 401]);
  assert.equal((await a.json()).error, (await b.json()).error);
  assert.equal((await call('/api/auth/login', { json: { id: '', password: '' } })).status, 400);
  assert.equal(a.headers.get('set-cookie'), null);
});

test('위조/변조/만료 토큰은 거절', async () => {
  const good = S.signSession({ empNo: 'GBSA2026001', name: 'x', dept: 'y' });
  const [p, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'GBSA2026002', n: 'x', d: 'y', x: 9999999999 })).toString('base64url');
  for (const bad of [`${forged}.${sig}`, `${p}.AAAA`, 'garbage', '']) assert.equal((await call('/api/tasks', { cookie: `gbsa_session=${bad}` })).status, 401);
  const expired = S.signSession({ empNo: 'GBSA2026001', name: 'x', dept: 'y' }, Date.now() - 9 * 3600 * 1000);
  assert.equal((await call('/api/tasks', { cookie: `gbsa_session=${expired}` })).status, 401);
});

test('로그아웃하면 쿠키가 만료된다', async () => {
  const r = await call('/api/auth/logout', { json: {} });
  assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

test('ADMIN_EMP_NOS 지정 시: 일반 사원은 본인 업무만, 관리자 API 는 403', async () => {
  const emps = await data.listEmployees();
  const [adm, usr] = [emps[0], emps[1]];
  process.env.ADMIN_EMP_NOS = adm.empNo;
  try {
    const cu = cookieOf(await login(usr.empNo)), ca = cookieOf(await login(adm.empNo));
    assert.equal((await call('/api/admin/overview', { cookie: cu })).status, 403);
    assert.equal((await call('/api/admin/overview', { cookie: ca })).status, 200);
    assert.equal((await call(`/api/tasks?empNo=${adm.empNo}`, { cookie: cu })).status, 403);
    assert.equal((await call(`/api/tasks?empNo=${usr.empNo}`, { cookie: cu })).status, 200);
    const admTask = (await (await call('/api/tasks', { cookie: ca })).json())[0];
    assert.equal((await call(`/api/tasks/${admTask.id}`, { cookie: cu })).status, 403);
    assert.equal((await call(`/api/tasks/${admTask.id}/submit`, { cookie: cu, json: {} })).status, 403);
    assert.equal((await call('/api/tasks/bulk', { cookie: cu, json: { tasks: [] } })).status, 403);
    assert.equal((await call('/api/demo/reset', { cookie: cu, json: {} })).status, 403);
  } finally { delete process.env.ADMIN_EMP_NOS; }
});
