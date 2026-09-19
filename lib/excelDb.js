// 사원 명부(gbsa-backend/employees.xlsx) 조회. 실행 위치(cwd)와 무관하게 이 파일 기준으로 경로를 잡는다.
// 파일 수정 시각(mtime)이 바뀌면 자동으로 다시 읽으므로, 엑셀을 고친 뒤 서버 재시작 없이 반영된다.
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const EMPLOYEES_XLSX = process.env.EMPLOYEES_XLSX || path.join(__dirname, '..', 'employees.xlsx');

let cache = { mtime: 0, rows: [] };

function getEmployees() {
  if (!fs.existsSync(EMPLOYEES_XLSX)) {
    throw new Error(
      `employees.xlsx 파일을 찾을 수 없습니다: ${EMPLOYEES_XLSX} ` +
      '(윈도우에서 확장자가 숨겨져 employees.xlsx.xlsx 로 저장되지 않았는지 확인하세요)'
    );
  }
  const mtime = fs.statSync(EMPLOYEES_XLSX).mtimeMs;
  if (mtime !== cache.mtime) {
    const workbook = XLSX.readFile(EMPLOYEES_XLSX);
    cache = { mtime, rows: XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]) };
  }
  return cache.rows;
}

function findEmployee(keyword) {
  const employees = getEmployees();
  if (!keyword) return employees;
  const has = (v) => v != null && String(v).includes(keyword);
  return employees.filter((e) => has(e.사원명) || has(e.사번) || has(e.부서명));
}

// ---- 정규화된 형태 (사번/사원명/부서명 → empNo/name/dept) ----
function listEmployees() {
  return getEmployees()
    .filter((r) => r.사번 != null && r.사원명 && r.부서명)
    .map((r) => ({ empNo: String(r.사번).trim(), name: String(r.사원명).trim(), dept: String(r.부서명).trim() }));
}

function getEmployee(empNo) {
  return listEmployees().find((e) => e.empNo === String(empNo)) || null;
}

function listDepartments() {
  const map = new Map();
  listEmployees().forEach((e) => map.set(e.dept, (map.get(e.dept) || 0) + 1));
  return [...map.entries()]
    .map(([dept, employees]) => ({ dept, employees }))
    .sort((a, b) => b.employees - a.employees || a.dept.localeCompare(b.dept, 'ko'));
}

// 직원 모드 로그인 사원: DEMO_USER_EMPNO 환경변수 > '홍길동' > 바이오센터 첫 사원 > 첫 사원
function getDefaultUser() {
  const emps = listEmployees();
  return (
    emps.find((e) => e.empNo === process.env.DEMO_USER_EMPNO) ||
    emps.find((e) => e.name === '홍길동') ||
    emps.find((e) => e.dept === '바이오센터') ||
    emps[0] ||
    null
  );
}

module.exports = {
  getEmployees, findEmployee, EMPLOYEES_XLSX,
  listEmployees, getEmployee, listDepartments, getDefaultUser,
};
