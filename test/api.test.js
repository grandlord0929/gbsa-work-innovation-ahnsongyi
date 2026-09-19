// API 통합 테스트 (node --test). 실제 Supabase 가 아니라 test/fakeSupabase.js 의 인메모리 흉내를 주입해 실행한다.
// → 쿼리/라우트 로직 검증용이며, 실제 Supabase 와의 최종 확인은 `npm run seed` 및 배포 후 /api/_boot?step=supabase 로 한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./fakeSupabase');

delete process.env.BASIC_AUTH_PASS;
process.env.NODE_ENV = 'test';
delete process.env.DEMO_USER_EMPNO;

const client = require('../lib/supabaseClient');
const data = require('../lib/data');
const seed = require('../lib/seedData');

let fake; let server; let base;
const api = async (path, opts = {}) => {
  const res = await fetch(base + path, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};
const post = (path, json) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });

async function freshDb() {
  fake = createFakeSupabase();
  client.__setClientForTests(fake);
  data.invalidateEmployees();
  await seed.seedEmployees();
  data.invalidateEmployees();
  await seed.seedTasks((await data.listEmployees()).map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept })));
}

test.before(async () => {
  const app = require('../server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server && server.close());
test.beforeEach(freshDb);

test('시드: 사원 200명, 7개 부서, 홍길동은 바이오센터, 업무 801건', async () => {
  assert.equal(fake._tables.employees.length, 200);
  assert.equal(fake._tables.tasks.length, 4 * 200 + 1);
  const depts = await api('/api/admin/departments');
  assert.equal(depts.body.totalEmployees, 200);
  assert.equal(depts.body.departments.length, 7);
  assert.equal(depts.body.departments.find((d) => d.dept === '바이오센터').employees, 30);
  const me = (await api('/api/me')).body;
  assert.deepEqual([me.name, me.dept, me.empNo], ['홍길동', '바이오센터', 'GBSA2026001']);
});

test('시드는 멱등: 사원 upsert 를 다시 실행해도 200명', async () => {
  await seed.seedEmployees(); await seed.seedEmployees();
  assert.equal(fake._tables.employees.length, 200);
});

test('/api/employees 는 프론트 호환(한글 키)이고 검색이 동작한다', async () => {
  const r = await api('/api/employees');
  assert.equal(r.body.success, true);
  assert.equal(r.body.count, 200);
  assert.deepEqual(Object.keys(r.body.employees[0]), ['사번', '사원명', '부서명']);
  const s = await api('/api/employees/search?q=' + encodeURIComponent('바이오센터'));
  assert.equal(s.body.count, 30);
  assert.equal((await api('/api/employees/search?q=' + encodeURIComponent('%,()*'))).body.count, 0); // 특수문자에도 안전
});

test('내 업무: 5건, 마감 상태 계산, 시각 형식(KST 문자열), 미제출 우선 정렬', async () => {
  const r = await api('/api/tasks?empNo=GBSA2026001');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 5);
  const t = r.body[0];
  assert.match(t.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.match(t.due, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.body.some((x) => x.status === 'overdue'), true);
  assert.deepEqual(r.body.map((x) => x.due), [...r.body.map((x) => x.due)].sort());
  assert.equal((await api('/api/tasks?empNo=NOPE')).status, 404);
  assert.equal((await api('/api/tasks?empNo=GBSA2026001&cat=edu')).body.length, 2);
});

test('직원 → 관리자: 제출완료가 부서 제출률·사원 표에 반영되고 중복 제출은 이력을 늘리지 않는다', async () => {
  const before = (await api('/api/admin/overview')).body;
  const b0 = before.byDept.find((d) => d.dept === '바이오센터');
  const mine = (await api('/api/tasks?empNo=GBSA2026001')).body;
  const target = mine.find((t) => t.status !== 'done');

  const s1 = await api(`/api/tasks/${target.id}/submit`, { method: 'POST' });
  assert.equal(s1.status, 200); assert.equal(s1.body.status, 'done');
  const s2 = await api(`/api/tasks/${target.id}/submit`, { method: 'POST' });
  assert.equal(s2.body.status, 'done');
  assert.equal(fake._tables.submissions.filter((x) => x.task_id === target.id).length, 1);

  const after = (await api('/api/admin/overview')).body;
  const b1 = after.byDept.find((d) => d.dept === '바이오센터');
  assert.equal(b1.done, b0.done + 1);
  assert.equal(after.doneTasks, before.doneTasks + 1);
  const row = (await api('/api/admin/employees?q=GBSA2026001')).body.employees[0];
  assert.equal(row.done, 1); assert.equal(row.total, 5);
  assert.match(row.lastSubmittedAt, /^\d{4}-\d{2}-\d{2} /);
});

test('관리자 → 직원: 부서 발송은 해당 부서 사원에게만 생성된다 + 입력 검증', async () => {
  const due = '2099-01-01';
  const r = await post('/api/tasks/bulk', { tasks: [{ title: '신규 요청', cat: 'doc', due, targetDept: '바이오센터', dept: '총무인사팀' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.created, 30);
  assert.equal((await api('/api/tasks?empNo=GBSA2026001')).body.some((t) => t.title === '신규 요청'), true);
  const other = (await api('/api/admin/employees?dept=' + encodeURIComponent('정책기획팀') + '&pageSize=1')).body.employees[0];
  assert.equal((await api('/api/tasks?empNo=' + other.empNo)).body.some((t) => t.title === '신규 요청'), false);
  const list = (await api('/api/admin/overview')).body.requests;
  assert.equal(list[0].title, '신규 요청'); assert.equal(list[0].total, 30); assert.equal(list[0].done, 0);
  assert.match(list[0].createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  assert.equal((await post('/api/tasks/bulk', { tasks: [{ title: 'x', cat: 'doc', due, targetDept: '없는부서' }] })).status, 400);
  assert.equal((await post('/api/tasks/bulk', { tasks: [{ title: 'x', cat: 'doc', due }] })).status, 400);
  assert.equal((await post('/api/tasks/bulk', { tasks: [{ title: 'x', cat: 'doc', due: '2026-13-45', targetDept: '전체' }] })).status, 400);
  assert.equal((await post('/api/tasks/bulk', { tasks: [{ title: '', cat: 'doc', due, targetDept: '전체' }] })).status, 400);
  assert.equal((await post('/api/tasks/bulk', { tasks: [{ title: 'x', cat: 'zzz', due, targetDept: '전체' }] })).status, 400);
  assert.equal((await post('/api/tasks/bulk', { tasks: [] })).status, 400);
  assert.equal(fake._tables.requests.filter((x) => x.title === 'x').length, 0); // 실패한 요청은 남지 않음
});

test('1000행 제한: 업무가 1000건을 넘어도 관리자 집계가 전부 읽는다', async () => {
  await post('/api/tasks/bulk', { tasks: [{ title: '대량 A', cat: 'doc', due: '2099-01-01', targetDept: '전체' }, { title: '대량 B', cat: 'doc', due: '2099-01-01', targetDept: '전체' }] });
  assert.equal(fake._tables.tasks.length, 801 + 400);
  const ov = (await api('/api/admin/overview')).body;
  assert.equal(ov.totalTasks, 1201);
  assert.equal(ov.byDept.reduce((n, d) => n + d.total, 0), 1201);
});

function certForm(fields, name = '수료증.png') {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  fd.append('file', new Blob(['x'], { type: 'image/png' }), name);
  return fd;
}

test('수료증 업로드: 키워드 자동 매칭 → 제출완료 + OCR 필드 저장, 모호하면 422, 후보 선택, 없으면 404', async () => {
  const r = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '2026년 하반기 정보보안 교육', issuer: '경기도경제과학진흥원', completedDate: '2026-09-18', ocrText: '정보보안' }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.matchedBy, 'keyword');
  assert.match(r.body.matchedTask.title, /정보보안/);
  assert.equal(r.body.matchedTask.status, 'done');
  assert.equal(r.body.matchedTask.cert.course_name, '2026년 하반기 정보보안 교육');
  assert.equal(r.body.matchedTask.cert.issuer, '경기도경제과학진흥원');

  // 정보보안이 제출되어 대기 교육 업무가 1건만 남으면, 키워드가 안 맞아도 "유일한 대기 업무"로 자동 매칭된다
  const last = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '2026년 청렴 교육', ocrText: '청렴' }) });
  assert.equal(last.status, 200);
  assert.equal(last.body.matchedBy, 'only-pending');
  assert.match(last.body.matchedTask.title, /개인정보/);
  // 더 이상 대기 중인 교육 업무가 없으면 404
  assert.equal((await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '청렴' }) })).status, 404);
});

test('수료증 업로드: 대기 업무 2건 + 불일치면 422, taskId 로 직접 선택 가능', async () => {
  const amb = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '2026년 청렴 교육', ocrText: '청렴' }) });
  assert.equal(amb.status, 422);
  assert.equal(amb.body.candidates.length, 2);
  const pick = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '청렴', taskId: String(amb.body.candidates[1].id) }) });
  assert.equal(pick.status, 200); assert.equal(pick.body.matchedBy, 'manual-select');
  assert.equal((await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: 'x', taskId: '999999' }) })).status, 404);
  assert.equal((await api('/api/tasks/cert-upload', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 400);
});

test('수료증: 한글 파일명이 깨지지 않고 이력에 저장된다', async () => {
  const r = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', ocrText: '정보보안', courseName: '정보보안' }, '정보보안_수료증.png') });
  assert.equal(r.status, 200);
  assert.equal(r.body.fileName, '정보보안_수료증.png');
  assert.equal(fake._tables.submissions.at(-1).file_name, '정보보안_수료증.png');
});

test('업무 수정/삭제 검증', async () => {
  const t = (await api('/api/tasks?empNo=GBSA2026001')).body[0];
  const ok = await api('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due: '2099-12-31' }) });
  assert.equal(ok.status, 200); assert.equal(ok.body.due, '2099-12-31');
  const bad = (b) => api('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await bad({ due: '2026-02-31x' })).status, 400);
  assert.equal((await bad({ status: 'zzz' })).status, 400);
  assert.equal((await bad({ cat: 'zzz' })).status, 400);
  assert.equal((await bad({})).status, 400);
  assert.equal((await api('/api/tasks/99999', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await api('/api/tasks/' + t.id, { method: 'DELETE' })).status, 204);
  assert.equal((await api('/api/tasks/' + t.id, { method: 'DELETE' })).status, 404);
});

test('시연 초기화: 이력 삭제 후 초기 시드로 복원(사원 유지)', async () => {
  await post('/api/tasks/bulk', { tasks: [{ title: '임시', cat: 'doc', due: '2099-01-01', targetDept: '전체' }] });
  const t = (await api('/api/tasks?empNo=GBSA2026001')).body.find((x) => x.status !== 'done');
  await api(`/api/tasks/${t.id}/submit`, { method: 'POST' });
  await post('/api/chat', { question: '미제출 목록' });
  const r = await api('/api/demo/reset', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(fake._tables.employees.length, 200);
  assert.equal(fake._tables.tasks.length, 801);
  assert.equal(fake._tables.submissions.length, 0);
  assert.equal(fake._tables.chat_logs.length, 0);
  assert.equal((await api('/api/tasks?empNo=GBSA2026001')).body.length, 5);
});

test('시연 초기화: 사원이 비어 있으면 사원도 시드한다', async () => {
  fake = createFakeSupabase(); client.__setClientForTests(fake); data.invalidateEmployees();
  const r = await api('/api/demo/reset', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(fake._tables.employees.length, 200);
  assert.equal(fake._tables.tasks.length, 801);
});

test('챗봇: 내 업무 기준 답변 + 대화 로그', async () => {
  const r = await post('/api/chat', { question: '미제출 목록 알려줘', empNo: 'GBSA2026001' });
  assert.equal(r.status, 200);
  assert.match(r.body.answer, /미제출 항목은 5건/);
  const h = await api('/api/chat/history?limit=5');
  assert.equal(h.body.length, 1);
  assert.equal((await post('/api/chat', { question: '  ' })).status, 400);
});

test('공문 분석 API 는 DB 없이 동작한다', async () => {
  const r = await post('/api/analyze', { text: '제목: 2026년 정보보안 교육 이수증 제출\n요청부서: ICT안전팀\n제출기한: 2026년 9월 25일' });
  assert.equal(r.status, 200); assert.equal(r.body.due, '2026-09-25'); assert.equal(r.body.cat, 'edu');
});

test('DB 오류는 500 JSON 으로 응답하고, 테이블이 없으면 안내 문구가 나온다', async () => {
  const broken = createFakeSupabase();
  broken.from = (t) => { if (t === 'tasks') return createFakeSupabase().from('없는테이블'); return fake.from(t); };
  client.__setClientForTests(broken);
  const r = await api('/api/tasks?empNo=GBSA2026001');
  assert.equal(r.status, 503);
  assert.match(r.body.error, /schema\.sql/);
});

test('환경변수가 없으면 크래시 대신 503 과 안내 메시지', async () => {
  client.__setClientForTests(null); data.invalidateEmployees();
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_KEY;
  try {
    const r = await api('/api/employees');
    assert.equal(r.status, 503);
    assert.match(r.body.error, /SUPABASE_URL/);
    assert.equal((await api('/api/health')).status, 200); // 헬스체크는 DB 없이 응답
  } finally {
    if (url) process.env.SUPABASE_URL = url; if (key) process.env.SUPABASE_KEY = key;
  }
});

test('xlsx / sqlite 모듈을 더 이상 불러오지 않는다', () => {
  const root = require('node:path').resolve(__dirname, '..');
  const loaded = Object.keys(require.cache);
  assert.equal(loaded.some((f) => /node_modules[\\/]xlsx[\\/]/.test(f)), false);
  const own = loaded.filter((f) => f.startsWith(root) && !f.includes('node_modules'));
  assert.equal(own.some((f) => /[\\/](excelDb|paths)\.js$/.test(f) || f === require('node:path').join(root, 'db.js')), false);
  const fs = require('node:fs');
  for (const f of ['../server', '../lib/handler', '../lib/data', '../lib/seedData']) {
    assert.doesNotMatch(fs.readFileSync(require.resolve(f), 'utf8'), /node:sqlite|require\('xlsx'\)|excelDb/);
  }
});
