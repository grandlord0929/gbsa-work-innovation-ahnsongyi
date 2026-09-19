// 제출요청 생성(부서 전원에게 사원별 업무 행 배포) + 초기 시드 + 시연 초기화
const { db, transaction } = require('../db');
const { listEmployees, listDepartments, getDefaultUser } = require('./excelDb');
const { recomputeStatus } = require('./dday');

const ALL_DEPTS = '전체';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());
}

// targetDept: '전체' 또는 엑셀에 존재하는 부서명. empNos 를 주면 해당 사원만.
function resolveTargets(targetDept, empNos) {
  const emps = listEmployees();
  if (Array.isArray(empNos)) return emps.filter((e) => empNos.includes(e.empNo));
  if (!targetDept || targetDept === ALL_DEPTS || targetDept === '__ALL__') return emps;
  const found = emps.filter((e) => e.dept === targetDept);
  if (found.length === 0) {
    const names = listDepartments().map((d) => d.dept).join(', ');
    throw httpError(400, `대상 부서 '${targetDept}' 의 사원을 사원 DB에서 찾을 수 없습니다. (등록 부서: ${names})`);
  }
  return found;
}

// statusFor(emp): 시드용 - 특정 사원의 초기 상태를 'done' 으로 지정할 때 사용
function createRequest({ title, cat, dept, due, targetDept, empNos, raw, targetLabel }, statusFor) {
  if (!['service', 'edu', 'doc'].includes(cat)) throw httpError(400, 'cat 은 service|edu|doc 중 하나여야 합니다.');
  title = String(title || '').trim();
  if (!title || title.length > 200) throw httpError(400, '업무명은 1~200자로 입력하세요.');
  if (!isValidDate(due)) throw httpError(400, '마감일은 YYYY-MM-DD 형식이어야 합니다.');

  const targets = resolveTargets(targetDept, empNos);
  if (targets.length === 0) throw httpError(400, '제출요청 대상 사원이 없습니다.');

  const requester = String(dept || '관리부서').trim().slice(0, 50) || '관리부서';
  const label = targetLabel || (!targetDept || targetDept === '__ALL__' ? ALL_DEPTS : targetDept);
  const baseStatus = recomputeStatus(due, 'normal');

  let requestId;
  transaction(() => {
    requestId = Number(
      db.prepare('INSERT INTO requests (title, cat, requester_dept, target_dept, due) VALUES (?, ?, ?, ?, ?)')
        .run(title, cat, requester, label, due).lastInsertRowid
    );
    const ins = db.prepare(`
      INSERT INTO tasks (cat, title, dept, assignee, due, status, source_raw, emp_no, emp_name, emp_dept, request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    targets.forEach((e) => {
      ins.run(cat, title, requester, e.name, due, (statusFor && statusFor(e)) || baseStatus,
        raw ? String(raw).slice(0, 8000) : null, e.empNo, e.name, e.dept, requestId);
    });
  })();

  return { id: requestId, title, cat, due, targetDept: label, count: targets.length };
}

// ---------------- 초기 시드 ----------------
const fnv = (s) => {
  let h = 2166136261;
  for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};

function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n > 0) return false;
  const me = getDefaultUser();
  if (!me) throw new Error('사원 DB(employees.xlsx)에 사원이 없어 시드를 만들 수 없습니다.');

  // 마감일은 실행 시점 기준 상대값 → 언제 시연해도 긴급/주의/기한초과가 골고루 보인다.
  const defs = [
    { title: '2026년 법정 필수 개인정보보호 교육 수료증 제출', cat: 'edu', dept: '감사담당관실', off: -5, bias: 10 },
    { title: '2026년 상반기 주요 연구성과지표 도의회 요구자료 회신', cat: 'doc', dept: '경영지원팀', off: 0, bias: 0 },
    { title: '2026년 하반기 정보보안 교육 이수증 제출', cat: 'edu', dept: 'ICT융합팀', off: 2, bias: -5 },
    { title: '사내 직무역량진단 결과 분석 자료 제출 요청', cat: 'doc', dept: 'HRD기획팀', off: 6, bias: -20 },
  ];
  defs.forEach((d) => {
    createRequest({ title: d.title, cat: d.cat, dept: d.dept, due: addDays(d.off), targetDept: ALL_DEPTS },
      // 로그인 사원은 항상 미제출로 시작(시연 흐름 보장). 나머지 사원의 초기 제출 이력은 시연용 시뮬레이션.
      (e) => {
        if (e.empNo === me.empNo) return null;
        const rate = Math.min(95, Math.max(5, 45 + (fnv(e.dept) % 40) + d.bias));
        return fnv(e.empNo + '|' + d.title) % 100 < rate ? 'done' : null;
      });
  });
  createRequest({
    title: '출퇴근 지문 미인식 소명서 제출 (근태 누락분)', cat: 'service', dept: '총무인사팀',
    due: addDays(1), empNos: [me.empNo], targetLabel: `${me.dept} (개별)`,
  });
  return true;
}

// 시연 반복용: 업무/제출/요청/대화 이력을 지우고 초기 시드로 되돌린다.
function resetDemo() {
  transaction(() => {
    db.exec('DELETE FROM submissions');
    db.exec('DELETE FROM tasks');
    db.exec('DELETE FROM requests');
    db.exec('DELETE FROM chat_logs');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('tasks','submissions','requests','chat_logs')");
  })();
  seedIfEmpty();
}

module.exports = { createRequest, seedIfEmpty, resetDemo, resolveTargets, isValidDate, httpError, ALL_DEPTS };
