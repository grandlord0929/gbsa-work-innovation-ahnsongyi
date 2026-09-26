// 제출 요청 이메일 (관리자) — 가짜 Supabase + 가짜 Resend 전송으로 검증. 실제 메일은 보내지 않는다.
process.env.SEED_SOURCE = 'synthetic';
delete process.env.BASIC_AUTH_PASS;
process.env.NODE_ENV = 'test';
delete process.env.ADMIN_DEPTS;
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./fakeSupabase');
const client = require('../lib/supabaseClient');
const data = require('../lib/data');
const seed = require('../lib/seedData');
const S = require('../lib/session');
const mailer = require('../lib/mailer');
const admin = require('../routes/admin');

let server; let base; let fake; let sentMails;
const cookie = (dept) => `gbsa_session=${encodeURIComponent(S.signSession({ empNo: 'GBSA2026001', name: '홍길동', dept }))}`;
const ADMIN = cookie('인사총무팀'), USER = cookie('바이오센터');
const post = (path, json, c = ADMIN) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(json) });

test.before(async () => {
  fake = createFakeSupabase(); client.__setClientForTests(fake);
  data.invalidateEmployees(); await seed.seedEmployees(); data.invalidateEmployees();
  await seed.seedTasks((await data.listEmployees()).map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept })));
  const app = require('../server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server && server.close());
test.beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test_key'; process.env.REMINDER_TEST_RECIPIENTS = 'demo1@example.com, demo2@example.com';
  process.env.SENDER_EMAIL = 'onboarding@resend.dev'; process.env.APP_URL = 'https://gbsa-demo.vercel.app';
  admin.__resetReminderCooldown(); sentMails = [];
  mailer.__setFetchForTests(async (url, init) => { sentMails.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ id: 'msg_123' }) }; });
});
test.afterEach(() => mailer.__setFetchForTests(null));

test('템플릿: 성명/부서/업무명/마감일/제출 링크가 들어가고 HTML 은 이스케이프된다', () => {
  const m = mailer.buildReminderEmail({ name: '홍길동', dept: '바이오센터', empNo: 'GBSA2026001', url: 'https://x.vercel.app/', tasks: [{ title: '정보보안 <b>교육</b> 제출', due: '2026-09-30', dday: -2 }, { title: '요구자료', due: '2026-10-05', dday: 3 }] });
  assert.equal(m.subject, "[GBSA 업무 리마인더] '정보보안 <b>교육</b> 제출' 제출 기한 안내 외 1건");
  for (const s of ['홍길동', '바이오센터', '2026-09-30', '기한 초과 (D+2)', 'D-3', 'https://x.vercel.app/', '경기도경제과학진흥원', '서류 제출하러 가기']) assert.ok(m.html.includes(s), s);
  assert.ok(!m.html.includes('<b>교육</b>') && m.html.includes('&lt;b&gt;교육&lt;/b&gt;'));
  assert.ok(m.text.includes('https://x.vercel.app/'));
});

test('APP_URL: 스킴이 없어도 https 로 보정, 없으면 요청 Host 사용', () => {
  assert.equal(mailer.appUrl(null, { APP_URL: 'my-app.vercel.app' }), 'https://my-app.vercel.app');
  assert.equal(mailer.appUrl(null, { APP_URL: ' "https://my-app.vercel.app/" ' }), 'https://my-app.vercel.app');
  assert.equal(mailer.appUrl({ headers: { host: 'localhost:4000' } }, {}), 'http://localhost:4000');
  assert.equal(mailer.appUrl({ headers: { 'x-forwarded-host': 'a.vercel.app', 'x-forwarded-proto': 'https' } }, {}), 'https://a.vercel.app');
});

test('수신자는 REMINDER_TEST_RECIPIENTS 중 유효한 최대 3개만', () => {
  assert.deepEqual(mailer.recipients({ REMINDER_TEST_RECIPIENTS: 'a@x.com, bad, a@x.com,b@x.com,c@x.com,d@x.com' }), ['a@x.com', 'b@x.com', 'c@x.com']);
  assert.deepEqual(mailer.recipients({}), []);
  assert.equal(mailer.status({ REMINDER_TEST_RECIPIENTS: 'a@x.com' }).configured, false);
});

test('발송 성공: Resend HTTPS 로 지정 수신자에게만, 발송 일시/이력/토스트용 응답', async () => {
  const emp = (await data.listEmployees())[5];
  const before = (await data.tasksByEmp(emp.empNo)).filter((t) => t.status !== 'done').length;
  const r = await post('/api/admin/send-reminder', { empNo: emp.empNo });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true); assert.match(b.sentAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(b.messageId, 'msg_123'); assert.equal(b.logged, true); assert.deepEqual(b.to, ['d***@example.com', 'd***@example.com']);
  assert.equal(sentMails.length, 1);
  const { url, init, body } = sentMails[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.Authorization, 'Bearer re_test_key');
  assert.deepEqual(body.to, ['demo1@example.com', 'demo2@example.com']); // 사원 메일이 아니라 시연용 주소
  assert.equal(body.from, '경기도경제과학진흥원 지능형 통합 업무 리마인더 <onboarding@resend.dev>');
  assert.match(body.subject, /^\[GBSA 업무 리마인더\] '.+' 제출 기한 안내/);
  assert.ok(body.html.includes(emp.name) && body.html.includes(emp.dept) && body.html.includes('https://gbsa-demo.vercel.app/'));
  assert.equal(b.taskCount, before);
  const log = fake._tables.reminder_logs; assert.equal(log.length, 1); assert.equal(log[0].emp_no, emp.empNo); assert.equal(log[0].sent_by, 'GBSA2026001');
});

test('중복 방지: 같은 사원 60초 내 재요청은 429, taskId 지정은 그 업무만', async () => {
  const emp = (await data.listEmployees())[6];
  const one = (await data.tasksByEmp(emp.empNo)).find((t) => t.status !== 'done');
  assert.equal((await post('/api/admin/send-reminder', { empNo: emp.empNo, taskId: one.id })).status, 200);
  assert.equal(sentMails[0].body.subject.includes(one.title), true); assert.ok(!sentMails[0].body.subject.includes('외 '));
  const again = await post('/api/admin/send-reminder', { empNo: emp.empNo });
  assert.equal(again.status, 429); assert.equal((await again.json()).code, 'TOO_SOON'); assert.equal(sentMails.length, 1);
});

test('오류: 설정 없음 503 / 없는 사원 404 / 미제출 없음 409 / Resend 거절 502(키 비노출)', async () => {
  const emp = (await data.listEmployees())[7];
  delete process.env.RESEND_API_KEY;
  let r = await post('/api/admin/send-reminder', { empNo: emp.empNo }); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'EMAIL_NOT_CONFIGURED');
  process.env.RESEND_API_KEY = 're_test_key';
  assert.equal((await post('/api/admin/send-reminder', { empNo: 'NOPE' })).status, 404);
  for (const t of await data.tasksByEmp(emp.empNo)) await data.updateTask(t.id, { status: 'done' });
  r = await post('/api/admin/send-reminder', { empNo: emp.empNo }); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'NOTHING_PENDING');
  assert.equal(sentMails.length, 0);
  const emp2 = (await data.listEmployees())[8];
  mailer.__setFetchForTests(async () => ({ ok: false, status: 403, json: async () => ({ message: 'You can only send testing emails to your own email address' }) }));
  r = await post('/api/admin/send-reminder', { empNo: emp2.empNo }); assert.equal(r.status, 502);
  const j = await r.json(); assert.equal(j.code, 'EMAIL_REJECTED'); assert.ok(!JSON.stringify(j).includes('re_test_key'));
  assert.equal(fake._tables.reminder_logs.some((l) => l.emp_no === emp2.empNo), false); // 실패는 이력 없음
});

test('권한: 일반 부서와 비로그인은 거절', async () => {
  const emp = (await data.listEmployees())[9];
  assert.equal((await post('/api/admin/send-reminder', { empNo: emp.empNo }, USER)).status, 403);
  assert.equal((await fetch(base + '/api/admin/send-reminder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal(sentMails.length, 0);
});

test('발송 이력 테이블이 없어도 발송은 성공한다', async () => {
  const emp = (await data.listEmployees())[10];
  const sb = client.getSupabase();
  const realFrom = sb.from.bind(sb);
  sb.from = (t) => (t === 'reminder_logs' ? { insert: () => ({ select: async () => ({ data: null, error: { message: 'relation "reminder_logs" does not exist', code: '42P01' } }) }) } : realFrom(t));
  try {
    const r = await post('/api/admin/send-reminder', { empNo: emp.empNo }); const b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.logged, false); assert.ok(b.sentAt);
  } finally { sb.from = realFrom; }
});
