// 제출요청 생성: 대상 부서(또는 전체) 사원 전원에게 사원별 업무 행을 배포한다.
const { getSupabase, must, insertChunks, httpError } = require('./supabaseClient');
const { listEmployees, listDepartments } = require('./data');
const { recomputeStatus } = require('./dday');
const { isValidDate } = require('./time');

const ALL_DEPTS = '전체';

// targetDept: '전체' 또는 사원 DB에 존재하는 부서명
async function resolveTargets(targetDept) {
  const emps = await listEmployees();
  if (!targetDept || targetDept === ALL_DEPTS || targetDept === '__ALL__') return emps;
  const found = emps.filter((e) => e.dept === targetDept);
  if (found.length === 0) {
    const names = (await listDepartments()).map((d) => d.dept).join(', ');
    throw httpError(400, `대상 부서 '${targetDept}' 의 사원을 사원 DB에서 찾을 수 없습니다. (등록 부서: ${names})`);
  }
  return found;
}

async function createRequest({ title, cat, dept, due, targetDept, raw }) {
  if (!['service', 'edu', 'doc'].includes(cat)) throw httpError(400, 'cat 은 service|edu|doc 중 하나여야 합니다.');
  title = String(title || '').trim();
  if (!title || title.length > 200) throw httpError(400, '업무명은 1~200자로 입력하세요.');
  if (!isValidDate(due)) throw httpError(400, '마감일은 YYYY-MM-DD 형식이어야 합니다.');

  const targets = await resolveTargets(targetDept);
  if (targets.length === 0) throw httpError(400, '제출요청 대상 사원이 없습니다.');

  const requester = String(dept || '관리부서').trim().slice(0, 50) || '관리부서';
  const label = !targetDept || targetDept === '__ALL__' ? ALL_DEPTS : targetDept;
  const status = recomputeStatus(due, 'normal');
  const sb = getSupabase();

  const req = must(
    await sb.from('requests').insert({ title, cat, requester_dept: requester, target_dept: label, due }).select('id'),
    'requests 생성'
  );
  const requestId = Number(req[0].id);

  try {
    await insertChunks('tasks', targets.map((e) => ({
      cat, title, dept: requester, assignee: e.name, due, status,
      source_raw: raw ? String(raw).slice(0, 8000) : null,
      emp_no: e.empNo, emp_name: e.name, emp_dept: e.dept, request_id: requestId,
    })), 'tasks 생성');
  } catch (e) {
    // 트랜잭션이 없으므로 실패하면 만들다 만 요청을 정리한다 (tasks 는 request 삭제 시 함께 삭제됨)
    await sb.from('requests').delete().eq('id', requestId);
    throw e;
  }
  return { id: requestId, title, cat, due, targetDept: label, requesterDept: requester, count: targets.length };
}

module.exports = { createRequest, resolveTargets, isValidDate, httpError, ALL_DEPTS };
