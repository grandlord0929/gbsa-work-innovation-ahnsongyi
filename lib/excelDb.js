// 사원 명부(employees.xlsx) 조회. 경로는 process.cwd()/employees.xlsx 를 우선 사용한다 (lib/paths.js 참고).
// 파일 수정 시각(mtime)이 바뀌면 자동으로 다시 읽으므로, 엑셀을 고친 뒤 서버 재시작 없이 반영된다.
const XLSX = require('xlsx');
const fs = require('fs');

const { employeesPath } = require('./paths');

let cache = { file: '', mtime: 0, rows: [] };

function getEmployees() {
  const file = employeesPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `employees.xlsx 파일을 찾을 수 없습니다: ${file} (cwd: ${process.cwd()}). ` +
      'Vercel 에서는 파일이 배포 번들에 포함되어야 합니다(vercel.json 의 includeFiles, .gitignore 예외 확인). ' +
      '윈도우에서 확장자가 숨겨져 employees.xlsx.xlsx 로 저장되지 않았는지도 확인하세요.'
    );
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (file !== cache.file || mtime !== cache.mtime) {
    const workbook = XLSX.readFile(file);
    cache = { file, mtime, rows: XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]) };
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
  getEmployees, findEmployee, employeesPath,
  listEmployees, getEmployee, listDepartments, getDefaultUser,
};
