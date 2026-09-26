// HTTP Basic 인증 제거 확인: 브라우저 기본 로그인 팝업(WWW-Authenticate)이 어떤 경로에서도 나오지 않고,
// 인증은 사번 로그인 세션으로만 이뤄진다. Vercel 진입점(lib/handler.js)을 운영 모드로 별도 프로세스에서 띄워 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { assertProductionSafe } = require('../lib/security');

test('assertProductionSafe: 운영에서 세션 서명 키(SUPABASE_KEY/SESSION_SECRET)가 없을 때만 거부, BASIC_AUTH_PASS 는 더 이상 필요 없음', () => {
  assert.throws(() => assertProductionSafe({ NODE_ENV: 'production' }), /세션 서명 키/);
  assert.doesNotThrow(() => assertProductionSafe({ NODE_ENV: 'production', SUPABASE_KEY: 'k' }));
  assert.doesNotThrow(() => assertProductionSafe({ NODE_ENV: 'production', SESSION_SECRET: 's' }));
  assert.doesNotThrow(() => assertProductionSafe({ NODE_ENV: 'development' }));
});

test('Vercel 핸들러(운영 모드, 옛 BASIC_AUTH_* 값이 남아 있어도): 팝업 헤더 없음, /api/* 는 JSON 401, 헬스체크/로그인 경로 정상', () => {
  const script = `
    const http = require('http');
    const S = require('./lib/session');
    const handler = require('./lib/handler');
    const srv = http.createServer(handler).listen(0, async () => {
      const base = 'http://localhost:' + srv.address().port;
      const get = async (p, cookie) => { const r = await fetch(base + p, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' }); const t = await r.text(); return { s: r.status, www: r.headers.get('www-authenticate'), t }; };
      const admin = 'gbsa_session=' + encodeURIComponent(S.signSession({ empNo: 'A1', name: 'a', dept: '인사총무팀' }));
      const user = 'gbsa_session=' + encodeURIComponent(S.signSession({ empNo: 'U1', name: 'u', dept: '바이오센터' }));
      const out = {};
      for (const p of ['/api/health', '/api/tasks', '/api/employees', '/api/me', '/api/admin/overview', '/api/login', '/api/_boot?step=info', '/api/nope']) out[p] = await get(p);
      out.bootUser = await get('/api/_boot?step=info', user);
      out.bootAdmin = await get('/api/_boot?step=info', admin);
      const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', password: 'x' }) });
      out.login = { s: login.status, www: login.headers.get('www-authenticate') };
      console.log(JSON.stringify(out)); srv.close(); process.exit(0);
    });`;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NODE_ENV: 'production', BASIC_AUTH_USER: 'gbsa', BASIC_AUTH_PASS: 'legacy-secret', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_KEY: 'dummy-service-role-key' },
  });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());

  for (const [k, v] of Object.entries(o)) assert.equal(v.www ?? null, null, `${k}: WWW-Authenticate(브라우저 팝업) 헤더가 있으면 안 됨`);
  assert.equal(o['/api/health'].s, 200);
  for (const p of ['/api/tasks', '/api/employees', '/api/me', '/api/admin/overview', '/api/login']) {
    assert.equal(o[p].s, 401, p); assert.equal(JSON.parse(o[p].t).code, 'LOGIN_REQUIRED', p);
  }
  assert.equal(o['/api/nope'].s, 401);                          // 로그인 전에는 존재 여부도 알려주지 않음
  assert.equal(o['/api/_boot?step=info'].s, 401);               // 진단 엔드포인트도 로그인 필요
  assert.equal(o.bootUser.s, 403);
  assert.equal(o.bootAdmin.s, 200);
  const info = JSON.parse(o.bootAdmin.t);
  assert.equal(info.env.SESSION_KEY, true); assert.equal('BASIC_AUTH_PASS' in info.env, false);
  assert.notEqual(o.login.s, 404);                                          // 로그인 경로는 살아 있음(이 테스트의 DB 는 연결 불가라 200/401/5xx 무관)
  assert.equal(o.login.www ?? null, null);                                 // 어떤 응답이든 팝업 헤더 없음
});
