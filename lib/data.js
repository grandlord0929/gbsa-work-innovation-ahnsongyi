// 데이터 접근 계층 (Supabase). 라우트는 이 모듈만 통해 DB 에 접근한다.
const { getSupabase, must, fetchAll, httpError } = require('./supabaseClient');
const { recomputeStatus } = require('./dday');
const { fmtKst } = require('./time');
const { parseMethod, formatMethod } = require('./review');

/* ---------------- 사원 (employees) ---------------- */
let empCache = { at: 0, rows: null };
const EMP_TTL_MS = 30 * 1000; // 사원 명부는 자주 안 바뀌므로 인스턴스 메모리에 잠깐 캐시

const invalidateEmployees = () => { empCache = { at: 0, rows: null }; };

async function listEmployees() {
  if (empCache.rows && Date.now() - empCache.at < EMP_TTL_MS) return empCache.rows;
  const data = await fetchAll(
    () => getSupabase().from('employees').select('emp_no,name,dept').order('emp_no', { ascending: true }),
    'employees 조회'
  );
  empCache = { at: Date.now(), rows: data.map((r) => ({ empNo: r.emp_no, name: r.name, dept: r.dept })) };
  return empCache.rows;
}

async function getEmployee(empNo) {
  const key = String(empNo);
  return (await listEmployees()).find((e) => e.empNo === key) || null;
}

async function listDepartments() {
  const map = new Map();
  (await listEmployees()).forEach((e) => map.set(e.dept, (map.get(e.dept) || 0) + 1));
  return [...map.entries()]
    .map(([dept, employees]) => ({ dept, employees }))
    .sort((a, b) => b.employees - a.employees || a.dept.localeCompare(b.dept, 'ko'));
}

// 직원 모드 로그인 사원: DEMO_USER_EMPNO > '안송이' > '홍길동' > 바이오센터 첫 사원 > 첫 사원
async function getDefaultUser() {
  const emps = await listEmployees();
  return (
    emps.find((e) => e.empNo === process.env.DEMO_USER_EMPNO) ||
    emps.find((e) => e.name === '안송이') ||
    emps.find((e) => e.name === '홍길동') ||
    emps.find((e) => e.dept === '바이오센터') ||
    emps[0] ||
    null
  );
}

// 명부에 없거나 DB 가 비어 있으면 안내가 담긴 404
async function resolveEmp(empNo) {
  const emp = empNo ? await getEmployee(empNo) : await getDefaultUser();
  if (!emp) {
    const anyone = (await listEmployees()).length > 0;
    throw httpError(404, anyone ? `사원 DB에 없는 사번입니다: ${empNo}` : '사원 DB가 비어 있습니다. `npm run seed` 로 초기 데이터를 넣어 주세요.');
  }
  return emp;
}

/* ---------------- 업무 (tasks) ---------------- */
const TASK_COLS = 'id,cat,title,dept,assignee,due,status,source_raw,emp_no,emp_name,emp_dept,request_id,created_at,updated_at';

// DB 행 → API 응답. 시각은 KST 문자열, 마감일 기준 상태는 조회 시점에 계산한다(GET 에서 쓰기 하지 않음).
function toTaskOut(row, cert = null, review = null) {
  return {
    ...row,
    id: Number(row.id),
    request_id: row.request_id == null ? null : Number(row.request_id),
    due: String(row.due).slice(0, 10),
    status: recomputeStatus(String(row.due).slice(0, 10), row.status),
    created_at: fmtKst(row.created_at),
    updated_at: fmtKst(row.updated_at),
    cert,
    review,
  };
}

// 업무별 최신 제출 이력 1건 (id 가 클수록 최신)
async function latestSubs(taskIds) {
  if (!taskIds.length) return new Map();
  const rows = must(
    await getSupabase().from('submissions')
      .select('id,task_id,file_name,course_name,issuer,completed_date,match_method,submitted_at')
      .in('task_id', taskIds).order('id', { ascending: false }),
    'submissions 조회'
  ) || [];
  const map = new Map();
  for (const r of rows) if (!map.has(Number(r.task_id))) map.set(Number(r.task_id), r); // 최신 1건
  return map;
}

// 제출 완료된 업무에 붙일 수료증 정보 (저장소 경로 등 내부 값은 노출하지 않는다)
function certOf(sub, task) {
  if (!sub || task.status !== 'done') return null;
  if (!(sub.course_name || sub.issuer || sub.completed_date)) return null;
  const { task_id, id, match_method, ...rest } = sub; // eslint-disable-line no-unused-vars
  return { ...rest, match_method: parseMethod(match_method).base || 'manual', submitted_at: fmtKst(sub.submitted_at) };
}

// 관리자 확인 상태: 미제출 업무에서는 pending(관리자 확인 중) / rejected(재제출 요청)만 의미가 있다.
function reviewOf(sub, task) {
  if (!sub) return null;
  const m = parseMethod(sub.match_method);
  if (task.status === 'done') return m.review === 'approved' ? { state: 'approved', submissionId: Number(sub.id) } : null;
  if (m.review !== 'pending' && m.review !== 'rejected') return null;
  return { state: m.review, reason: m.reason || '', submissionId: Number(sub.id), at: fmtKst(sub.submitted_at) };
}

async function decorate(rows) {
  const subs = await latestSubs(rows.filter((r) => r.status === 'done' || r.cat === 'edu').map((r) => Number(r.id)));
  return rows.map((r) => toTaskOut(r, certOf(subs.get(Number(r.id)), r), reviewOf(subs.get(Number(r.id)), r)));
}

async function tasksByEmp(empNo, { cat, status } = {}) {
  let q = getSupabase().from('tasks').select(TASK_COLS).eq('emp_no', empNo);
  if (cat) q = q.eq('cat', cat);
  const rows = must(await q, 'tasks 조회') || [];
  let out = await decorate(rows);
  if (status) out = out.filter((t) => t.status === status);
  // 미제출 먼저, 마감일 빠른 순, id 순
  return out.sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.due.localeCompare(b.due) || a.id - b.id);
}

async function getTask(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const row = must(await getSupabase().from('tasks').select(TASK_COLS).eq('id', n).maybeSingle(), 'task 조회');
  return row ? (await decorate([row]))[0] : null;
}

async function pendingEduTasks(empNo) {
  const rows = must(
    await getSupabase().from('tasks').select(TASK_COLS).eq('emp_no', empNo).eq('cat', 'edu').neq('status', 'done'),
    'tasks(교육) 조회'
  ) || [];
  return rows.map((r) => toTaskOut(r));
}

// 제출 완료 처리 + 제출 이력 기록. 이미 done 이면 아무것도 하지 않는다(중복 이력 방지).
async function recordSubmission(taskId, file, cert, matchMethod) {
  const sb = getSupabase();
  const updated = must(
    await sb.from('tasks').update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', taskId).neq('status', 'done').select('id'),
    'task 제출 처리'
  ) || [];
  if (updated.length === 0) return false; // 이미 제출됨(또는 존재하지 않음)

  const ins = await sb.from('submissions').insert({
    task_id: taskId,
    file_name: file ? file.fixedName : null,
    course_name: cert.course_name, issuer: cert.issuer, completed_date: cert.completed_date,
    ocr_text: cert.ocr_text, match_method: matchMethod || 'manual',
  });
  if (ins.error) { // 이력 저장 실패 시 상태를 되돌려 불일치를 남기지 않는다
    await sb.from('tasks').update({ status: 'normal' }).eq('id', taskId);
    must(ins, '제출 이력 저장');
  }
  return true;
}

async function updateTask(id, updates) {
  const rows = must(
    await getSupabase().from('tasks').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select('id'),
    'task 수정'
  ) || [];
  return rows.length > 0;
}

async function deleteTask(id) {
  const rows = must(await getSupabase().from('tasks').delete().eq('id', id).select('id'), 'task 삭제') || [];
  return rows.length > 0;
}

/* ---------------- 수료증 관리자 확인 (본인 확인 제출) ---------------- */
// 성명 확인 제출: 업무를 done 으로 바꾸지 않고 '확인 대기(review=pending)' 이력만 남긴다. 이전 대기 건은 superseded 로 정리.
async function recordReviewSubmission(taskId, cert, methodTags) {
  const sb = getSupabase();
  const task = must(await sb.from('tasks').select('id,status').eq('id', taskId).maybeSingle(), 'task 조회');
  if (!task || task.status === 'done') return null;
  const prev = must(await sb.from('submissions').select('id,match_method').eq('task_id', taskId), 'submissions 조회') || [];
  for (const p of prev) {
    const m = parseMethod(p.match_method);
    if (m.review === 'pending') must(await sb.from('submissions').update({ match_method: formatMethod({ ...m, review: 'superseded' }) }).eq('id', p.id), '이전 확인 요청 정리');
  }
  const rows = must(await sb.from('submissions').insert({
    task_id: taskId, file_name: cert.file_name, course_name: cert.course_name, issuer: cert.issuer, completed_date: cert.completed_date,
    ocr_text: cert.ocr_text, match_method: methodTags,
  }).select('id'), '제출 이력 저장') || [];
  await sb.from('tasks').update({ updated_at: new Date().toISOString() }).eq('id', taskId);
  return Number(rows[0].id);
}

const SUB_COLS = 'id,task_id,file_name,course_name,issuer,completed_date,ocr_text,match_method,submitted_at';

async function getSubmission(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return must(await getSupabase().from('submissions').select(SUB_COLS).eq('id', n).maybeSingle(), 'submission 조회');
}

// 관리자 확인 대기 목록 (확인 요청이 들어온 순서대로)
async function listPendingReviews() {
  const subs = must(
    await getSupabase().from('submissions').select(SUB_COLS).like('match_method', '%review=pending%').order('id', { ascending: true }),
    '확인 대기 목록 조회'
  ) || [];
  if (!subs.length) return [];
  const tasks = must(await getSupabase().from('tasks').select(TASK_COLS).in('id', [...new Set(subs.map((s) => Number(s.task_id)))]), 'tasks 조회') || [];
  const byId = new Map(tasks.map((t) => [Number(t.id), t]));
  return subs.filter((s) => byId.has(Number(s.task_id)) && byId.get(Number(s.task_id)).status !== 'done')
    .map((s) => ({ sub: s, task: toTaskOut(byId.get(Number(s.task_id))) }));
}

async function pendingReviewCount() {
  const rows = must(await getSupabase().from('submissions').select('id,task_id').like('match_method', '%review=pending%'), '확인 대기 건수 조회') || [];
  return rows.length;
}

// 재제출 요청을 보냈고 아직 직원이 다시 올리지 않은 업무 수 (업무별 최신 제출 이력이 rejected 인 미제출 업무)
async function resubmitRequestCount() {
  const rej = must(await getSupabase().from('submissions').select('id,task_id').like('match_method', '%review=rejected%'), '재제출 요청 조회') || [];
  if (!rej.length) return 0;
  const ids = [...new Set(rej.map((r) => Number(r.task_id)))];
  const tasks = must(await getSupabase().from('tasks').select('id,status').in('id', ids), 'tasks 조회') || [];
  const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => Number(t.id)));
  const latest = await latestSubs([...open]);
  return rej.filter((r) => open.has(Number(r.task_id)) && Number(latest.get(Number(r.task_id))?.id) === Number(r.id)).length;
}

// decision: 'approve' → 업무 제출완료 / 'reject' → 재제출 요청(reason)
async function decideReview(subId, decision, reason = '') {
  const sub = await getSubmission(subId);
  if (!sub) throw httpError(404, '확인 요청을 찾을 수 없습니다.');
  const m = parseMethod(sub.match_method);
  if (m.review !== 'pending') throw httpError(409, '이미 처리되었거나 확인 대기 중인 요청이 아닙니다.');
  const sb = getSupabase();
  if (decision === 'approve') {
    const done = must(await sb.from('tasks').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', sub.task_id).neq('status', 'done').select('id'), 'task 제출 처리') || [];
    if (done.length === 0) throw httpError(409, '이미 제출 완료된 업무입니다.');
    must(await sb.from('submissions').update({ match_method: formatMethod({ ...m, review: 'approved' }) }).eq('id', sub.id), '확인 처리');
  } else {
    must(await sb.from('submissions').update({ match_method: formatMethod({ ...m, review: 'rejected', reason }) }).eq('id', sub.id), '재제출 요청 처리');
    await sb.from('tasks').update({ updated_at: new Date().toISOString() }).eq('id', sub.task_id);
  }
  return { submission: await getSubmission(sub.id), task: await getTask(sub.task_id) };
}

/* ---------------- 관리자 집계용 ---------------- */
// 집계에 필요한 최소 컬럼만 전부 읽는다 (1000행 단위로 나눠서)
async function allTaskFacts() {
  return fetchAll(
    () => getSupabase().from('tasks').select('id,emp_no,emp_dept,status,due,request_id,updated_at').order('id', { ascending: true }),
    'tasks 집계 조회'
  );
}

async function recentRequests(limit = 30) {
  return must(
    await getSupabase().from('requests').select('id,title,cat,requester_dept,target_dept,due,created_at').order('id', { ascending: false }).limit(limit),
    'requests 조회'
  ) || [];
}

/* ---------------- 챗봇 로그 ---------------- */
async function addChatLog(question, answer) {
  must(await getSupabase().from('chat_logs').insert({ question, answer }), 'chat_logs 저장');
}

async function chatHistory(limit) {
  const rows = must(
    await getSupabase().from('chat_logs').select('id,question,answer,created_at').order('id', { ascending: false }).limit(limit),
    'chat_logs 조회'
  ) || [];
  return rows.reverse().map((r) => ({ ...r, created_at: fmtKst(r.created_at) }));
}

module.exports = {
  listEmployees, getEmployee, listDepartments, getDefaultUser, resolveEmp, invalidateEmployees,
  tasksByEmp, getTask, pendingEduTasks, recordSubmission, recordReviewSubmission, getSubmission, listPendingReviews, pendingReviewCount, resubmitRequestCount, decideReview, updateTask, deleteTask,
  allTaskFacts, recentRequests, addChatLog, chatHistory, toTaskOut,
};
