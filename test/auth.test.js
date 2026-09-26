// 사번 로그인/세션/접근 제어 테스트 (인메모리 가짜 Supabase)
process.env.SEED_SOURCE = 'synthetic';
process.env.NODE_ENV = 'test';
delete process.env.ADMIN_DEPTS;
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

// 관리자 모드는 기획조정실 / 인사총무팀 소속만 (그 외 부서는 관리자 API 403, 타인 업무 접근 403)
const ADMIN_DEPTS = ['기획조정실', '인사총무팀'];
async function addEmp(empNo, name, dept) {
  await client.getSupabase().from('employees').upsert({ emp_no: empNo, name, dept }, { onConflict: 'emp_no' });
  data.invalidateEmployees();
}

test('부서별 관리자 권한: 기획조정실·인사총무팀만 관리자, 그 외 부서는 숨김/403', async () => {
  const cases = [['T0001', '기획팀장', '기획조정실', true], ['T0002', '총무담당', '인사총무팀', true], ['T0003', '일반사원', '바이오센터', false], ['T0004', '유사부서', '총무인사팀', false]];
  for (const [no, name, dept] of cases) await addEmp(no, name, dept);
  for (const [no, , dept, admin] of cases) {
    const r = await login(no); const b = await r.json(); const c = cookieOf(r);
    assert.equal(b.user.isAdmin, admin, `${dept} 프로필 isAdmin`);
    assert.equal((await call('/api/auth/me', { cookie: c })).status, 200);
    const ov = await call('/api/admin/overview', { cookie: c });
    assert.equal(ov.status, admin ? 200 : 403, `${dept} /api/admin/overview`);
    if (!admin) assert.equal((await ov.json()).code, 'ADMIN_ONLY');
    for (const p of ['/api/stats', '/api/admin/reviews']) assert.equal((await call(p, { cookie: c })).status, admin ? 200 : 403, `${dept} ${p}`);
    assert.equal((await call('/api/demo/reset', { cookie: c, json: {}, method: 'POST' })).status === 403, !admin, `${dept} demo/reset`);
    assert.equal((await call('/api/analyze', { cookie: c, json: { text: '제목: x' } })).status === 403, !admin, `${dept} analyze`);
  }
});

test('일반 부서 사원은 본인 업무만: 타인 사번/업무 접근·발송·수정은 403, 관리자 부서는 가능', async () => {
  const adm = cookieOf(await login('T0001')), usr = cookieOf(await login('T0003'));
  const mine = await (await call('/api/tasks', { cookie: usr })).json();
  assert.ok(Array.isArray(mine));
  assert.equal((await call('/api/tasks?empNo=GBSA2026001', { cookie: usr })).status, 403);
  assert.equal((await call('/api/tasks?empNo=GBSA2026001', { cookie: adm })).status, 200);
  const other = (await (await call('/api/tasks?empNo=GBSA2026001', { cookie: adm })).json())[0];
  assert.equal((await call(`/api/tasks/${other.id}`, { cookie: usr })).status, 403);
  assert.equal((await call(`/api/tasks/${other.id}/submit`, { cookie: usr, json: {} })).status, 403);
  assert.equal((await call(`/api/tasks/${other.id}`, { cookie: usr, method: 'PATCH', json: { title: 'x' } })).status, 403);
  assert.equal((await call(`/api/tasks/${other.id}`, { cookie: usr, method: 'DELETE' })).status, 403);
  assert.equal((await call('/api/tasks/bulk', { cookie: usr, json: { tasks: [] } })).status, 403);
  assert.equal((await call(`/api/tasks/${other.id}`, { cookie: adm })).status, 200);
});

test('ADMIN_DEPTS 로 관리자 부서를 재정의할 수 있다', async () => {
  process.env.ADMIN_DEPTS = '바이오센터';
  try {
    assert.equal(S.isAdmin({ dept: '바이오센터' }), true);
    assert.equal(S.isAdmin({ dept: '기획조정실' }), false);
  } finally { delete process.env.ADMIN_DEPTS; }
  assert.deepEqual(S.adminDepts(), ADMIN_DEPTS);
  assert.equal(S.isAdmin(null), false); assert.equal(S.isAdmin({ dept: '' }), false);
});
