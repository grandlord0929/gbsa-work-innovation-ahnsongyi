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
  const target = mine.find((t) => t.status !== 'done' && t.cat !== 'edu'); // 교육 수료증 업무는 수동 제출 불가

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

// person: 수료증에 적힌 성명(OCR 원문에 '성명 : …' 줄로 추가). 기본은 로그인 사원(홍길동). null 이면 성명 줄 없음.
function certForm(fields, name = '수료증.png', person = '홍길동') {
  const f = { ...fields };
  if (person) f.ocrText = `${f.ocrText || ''}\n성명 : ${person}`.trim();
  const fd = new FormData();
  Object.entries(f).forEach(([k, v]) => fd.append(k, v));
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
  const t = (await api('/api/tasks?empNo=GBSA2026001')).body.find((x) => x.status !== 'done' && x.cat !== 'edu');
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

// =================== 본인 성명 검증 (타인 수료증 제출 차단) ===================
const nameOf = (empNo) => fake._tables.employees.find((e) => e.emp_no === empNo).name;
const uploadAs = (empNo, person, fields = {}, fileName) =>
  api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo, courseName: '2026년 하반기 정보보안 교육', ocrText: '정보보안 교육', ...fields }, fileName, person) });
const stateOf = (empNo) => ({
  done: fake._tables.tasks.filter((t) => t.emp_no === empNo && t.status === 'done').length,
  subs: fake._tables.submissions.length,
});

test('타인의 수료증(성명 불일치)은 403 NAME_MISMATCH 로 거부되고 DB 는 그대로다', async () => {
  const emp = fake._tables.employees.find((e) => e.name !== '강하율' && e.emp_no !== 'GBSA2026001');
  const before = stateOf(emp.emp_no);
  const r = await uploadAs(emp.emp_no, '강하율');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NAME_MISMATCH');
  assert.equal(r.body.isNameMatched, false);
  assert.equal(r.body.matchedName, '강하율');
  assert.equal(r.body.expectedName, emp.name);
  assert.equal(r.body.error, `⚠️ 제출자 성명('${emp.name}')과 수료증 상 성명('강하율')이 일치하지 않습니다.`);
  assert.deepEqual(stateOf(emp.emp_no), before); // 제출완료·제출이력 모두 변화 없음
});

test('성명 불일치는 taskId 를 직접 지정해도 우회할 수 없다', async () => {
  const pending = (await api('/api/tasks?empNo=GBSA2026001')).body.find((t) => t.cat === 'edu');
  const before = stateOf('GBSA2026001');
  const r = await uploadAs('GBSA2026001', '강하율', { taskId: String(pending.id) });
  assert.equal(r.status, 403);
  assert.deepEqual(stateOf('GBSA2026001'), before);
});

test('수료증에서 성명을 읽지 못하면 403 NAME_UNVERIFIED (본인 확인 불가)', async () => {
  const before = stateOf('GBSA2026001');
  const r = await uploadAs('GBSA2026001', null);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NAME_UNVERIFIED');
  assert.match(r.body.error, /자동으로 확인하지 못했습니다/);
  assert.deepEqual(stateOf('GBSA2026001'), before);
});

test('성명이 일치하면 제출되고, 공백/줄바꿈으로 흩어진 성명도 일치로 본다', async () => {
  const r = await uploadAs('GBSA2026001', '홍 길 동');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nameCheck, { isNameMatched: true, confirmedByUser: false, matchedName: '홍길동', expectedName: '홍길동' });
  assert.equal(r.body.matchedTask.status, 'done');
});

test('원문에 성명 라벨이 없어도 본인 이름이 원문에 있으면 확인, 타인 이름만 있으면 미확인', async () => {
  const ok = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '정보보안', ocrText: '수료증\n정보보안 교육\n홍길동 귀하' }, '수료증.png', null) });
  assert.equal(ok.status, 200);
  const bad = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '개인정보', ocrText: '수료증\n개인정보보호 교육\n강하율 귀하' }, '수료증.png', null) });
  assert.equal(bad.status, 403); assert.equal(bad.body.code, 'NAME_UNVERIFIED');
});

test('성명 검증 우회 시도: certName 을 본인 이름으로 위조하면 OCR 원문과 달라 400', async () => {
  const r = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '정보보안', ocrText: '정보보안', certName: '홍길동' }, '수료증.png', '강하율') });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'NAME_TAMPERED');
  assert.equal(fake._tables.submissions.length, 0);
});

test('한 글자 차이(OCR 오인식 가능성)도 제출은 거부하되 안내 문구가 붙는다', async () => {
  const r = await uploadAs('GBSA2026001', '홍길둥');
  assert.equal(r.status, 403);
  assert.equal(r.body.similar, true);
  assert.match(r.body.error, /OCR 오인식/);
});

test('교육 수료증 업무는 [제출완료] 수동 제출로 성명 검증을 우회할 수 없다 (403 CERT_REQUIRED)', async () => {
  const edu = (await api('/api/tasks?empNo=GBSA2026001')).body.find((t) => t.cat === 'edu' && t.status !== 'done');
  const r = await api(`/api/tasks/${edu.id}/submit`, { method: 'POST' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'CERT_REQUIRED');
  assert.equal((await api(`/api/tasks/${edu.id}`)).body.status !== 'done', true);
  assert.equal(fake._tables.submissions.length, 0);
  // 수료증 필드를 함께 보내 우회하려는 시도도 동일하게 거부
  const sneaky = await post(`/api/tasks/${edu.id}/submit`, { courseName: '정보보안', ocrText: '성명 : 홍길동' });
  assert.equal(sneaky.status, 403);
  // 운영자가 명시적으로 허용한 경우에만 수동 제출 가능
  process.env.ALLOW_MANUAL_EDU_SUBMIT = 'true';
  try { assert.equal((await api(`/api/tasks/${edu.id}/submit`, { method: 'POST' })).status, 200); } finally { delete process.env.ALLOW_MANUAL_EDU_SUBMIT; }
});

test('수동 제출은 수료증 OCR 필드를 기록하지 않는다 (검증되지 않은 값이 OCR 자동 제출처럼 보이지 않게)', async () => {
  const doc = (await api('/api/tasks?empNo=GBSA2026001')).body.find((t) => t.cat === 'doc' && t.status !== 'done');
  const r = await post(`/api/tasks/${doc.id}/submit`, { courseName: '위조 교육명', issuer: '위조 기관', completedDate: '2026-01-01', ocrText: '성명 : 홍길동' });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'done'); assert.equal(r.body.cert, null);
  const sub = fake._tables.submissions.at(-1);
  assert.equal(sub.match_method, 'manual');
  assert.deepEqual([sub.course_name, sub.issuer, sub.completed_date, sub.ocr_text], [null, null, null, null]);
});

test('여러 줄 교육명은 서버 매칭·이력에 공백 정규화된 한 줄로 저장된다', async () => {
  const wrapped = '2026년 하반기 개인정보보호 및 정보\n보안 교육';
  const r = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: wrapped.replace(/\s+/g, ' '), ocrText: `교육명 : ${wrapped}\n발급기관 : 경기도경제과학진흥원` }) });
  assert.ok([200, 422].includes(r.status)); // 개인정보/정보보안 키워드가 모두 있어 업무 특정이 모호하면 422(후보 선택)
  if (r.status === 422) assert.equal(r.body.candidates.length, 2);
  else assert.equal(r.body.cert.course_name, '2026년 하반기 개인정보보호 및 정보 보안 교육');
});

// ---- 본인 확인 제출 → 관리자 확인(승인 / 재제출 요청) ----
const confirmUpload = (empNo, person, extra = {}) => api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo, courseName: '정보보안', ocrText: '정보보안 교육', nameConfirmed: 'true', ...extra }, '수료증.png', person) });

test('성명을 못 읽은 수료증은 본인 확인 시 202 + 관리자 확인 대기(업무는 아직 미제출)', async () => {
  const noConfirm = await uploadAs('GBSA2026001', null);
  assert.equal(noConfirm.status, 403); assert.equal(noConfirm.body.confirmable, true);
  const r = await confirmUpload('GBSA2026001', null);
  assert.equal(r.status, 202);
  assert.equal(r.body.review, 'pending');
  assert.equal(r.body.matchedTask.status !== 'done', true);
  assert.equal(r.body.matchedTask.review.state, 'pending');
  const list = await api('/api/tasks?empNo=GBSA2026001');
  const t = list.body.find((x) => x.id === r.body.matchedTask.id);
  assert.equal(t.review.state, 'pending'); assert.notEqual(t.status, 'done');
  const q = await api('/api/admin/reviews');
  assert.equal(q.body.count >= 1, true);
  const item = q.body.reviews.find((x) => x.taskId === t.id);
  assert.equal(item.empName, '홍길동'); assert.equal(item.hasFile, true);
});

const myTask = async (empNo, id) => (await api('/api/tasks?empNo=' + empNo)).body.find((x) => x.id === id);

test('관리자 확인: 승인하면 제출완료, 이미지 열람 가능, 중복 처리는 409', async () => {
  const sub = await confirmUpload('GBSA2026001', null);
  assert.equal(sub.status, 202);
  const item = (await api('/api/admin/reviews')).body.reviews[0];
  const img = await fetch(base + '/api/admin/reviews/' + item.id + '/file');
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  const ok = await post('/api/admin/reviews/' + item.id + '/approve', {});
  assert.equal(ok.status, 200); assert.equal(ok.body.task.status, 'done');
  assert.equal((await post('/api/admin/reviews/' + item.id + '/approve', {})).status, 409);
  const mine = await myTask(item.empNo, item.taskId);
  assert.equal(mine.status, 'done'); assert.equal(mine.review.state, 'approved');
  assert.equal((await api('/api/admin/reviews')).body.reviews.some((x) => x.id === item.id), false);
  assert.equal((await api('/api/admin/overview')).body.pendingReviews, 0);
});

test('관리자 재제출 요청: 사유가 직원에게 전달되고, 재업로드하면 다시 확인 대기', async () => {
  assert.equal((await confirmUpload('GBSA2026001', null)).status, 202);
  assert.equal((await api('/api/admin/overview')).body.pendingReviews, 1);
  const item = (await api('/api/admin/reviews')).body.reviews[0];
  const rej = await post('/api/admin/reviews/' + item.id + '/reject', { reason: '성명이 가려져 있습니다' });
  assert.equal(rej.status, 200); assert.notEqual(rej.body.task.status, 'done');
  const mine = await myTask(item.empNo, item.taskId);
  assert.deepEqual([mine.review.state, mine.review.reason], ['rejected', '성명이 가려져 있습니다']);
  assert.equal((await post('/api/admin/reviews/' + item.id + '/reject', {})).status, 409);
  assert.equal((await api('/api/admin/reviews')).body.count, 0);
  // 재제출 → 다시 대기, 이전 요청은 대기 목록에 남지 않는다
  assert.equal((await confirmUpload('GBSA2026001', null)).status, 202);
  assert.equal((await myTask(item.empNo, item.taskId)).review.state, 'pending');
  assert.equal((await api('/api/admin/reviews')).body.count, 1);
});

test('재제출로 이전 대기 건은 대체(superseded)되어 목록에 1건만 남는다', async () => {
  await confirmUpload('GBSA2026001', null);
  await confirmUpload('GBSA2026001', null);
  assert.equal((await api('/api/admin/reviews')).body.count, 1);
});

test('본인 확인 제출은 파일이 필수이고, 명백히 다른 이름은 확인해도 거부', async () => {
  const fd = new FormData(); fd.append('empNo', 'GBSA2026001'); fd.append('courseName', '정보보안'); fd.append('ocrText', '정보보안'); fd.append('nameConfirmed', 'true');
  const noFile = await api('/api/tasks/cert-upload', { method: 'POST', body: fd });
  assert.equal(noFile.status, 400); assert.equal(noFile.body.code, 'FILE_REQUIRED');
  const clear = await confirmUpload('GBSA2026001', '강하율');
  assert.equal(clear.status, 403); assert.equal(clear.body.code, 'NAME_MISMATCH'); assert.equal(clear.body.confirmable, false);
  const near = await api('/api/tasks/cert-upload', { method: 'POST', body: certForm({ empNo: 'GBSA2026001', courseName: '정보보안', ocrText: '정보보안' }, '수료증.png', '홍길둥') });
  assert.equal(near.status, 403); assert.equal(near.body.confirmable, true);
  assert.equal((await confirmUpload('GBSA2026001', '홍길둥')).status, 202);
});

test('1MB 초과 수료증 파일은 413 "파일 용량 초과"로 거부되고 DB는 그대로', async () => {
  const fd = new FormData(); fd.append('empNo', 'GBSA2026001'); fd.append('courseName', '정보보안'); fd.append('ocrText', '정보보안\n성명 : 홍길동');
  fd.append('file', new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' }), 'big.png');
  const r = await api('/api/tasks/cert-upload', { method: 'POST', body: fd });
  assert.equal(r.status, 413); assert.equal(r.body.code, 'FILE_TOO_LARGE'); assert.match(r.body.error, /파일 용량 초과/);
  assert.equal(fake._tables.submissions.length, 0);
  const fd2 = new FormData(); fd2.append('empNo', 'GBSA2026001'); fd2.append('courseName', '정보보안'); fd2.append('ocrText', '정보보안\n성명 : 홍길동');
  fd2.append('file', new Blob([new Uint8Array(1024 * 1024)], { type: 'image/png' }), 'ok.png'); // 정확히 1MB 는 허용
  assert.equal((await api('/api/tasks/cert-upload', { method: 'POST', body: fd2 })).status, 200);
});

test('관리자 대시보드: 재제출 요청 중 건수는 직원이 다시 올리면 빠진다', async () => {
  await confirmUpload('GBSA2026001', null);
  const item = (await api('/api/admin/reviews')).body.reviews[0];
  assert.equal((await api('/api/admin/overview')).body.resubmitRequested, 0);
  await post('/api/admin/reviews/' + item.id + '/reject', { reason: 'x' });
  assert.equal((await api('/api/admin/overview')).body.resubmitRequested, 1);
  assert.equal((await api('/api/admin/reviews')).body.resubmitRequested, 1);
  await confirmUpload('GBSA2026001', null);
  assert.equal((await api('/api/admin/overview')).body.resubmitRequested, 0);
});
