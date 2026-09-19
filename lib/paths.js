// 실행 환경별 파일 위치. Vercel(서버리스)은 프로젝트 폴더가 읽기 전용이라 쓰기 가능한 /tmp 를 쓴다.
// /tmp 는 함수 인스턴스마다 따로이고 유휴 후 사라지므로 DB/업로드는 휘발성이다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const DATA_DIR = process.env.DATA_DIR || (serverless ? path.join(os.tmpdir(), 'gbsa-data') : path.join(ROOT, 'data'));

// employees.xlsx 위치를 찾는다 (읽기 전용). 우선순위:
//   1) EMPLOYEES_XLSX 환경변수
//   2) 이 프로젝트 루트/employees.xlsx — 파일 위치 기준이라 실행 위치와 무관 (Vercel 에서는 /var/task)
//   3) process.cwd()/employees.xlsx — 보조
// 어디에도 없으면 "새로 만들 위치"를 돌려준다 (서버리스는 /tmp, 그 외는 프로젝트 루트).
function employeesPath() {
  if (process.env.EMPLOYEES_XLSX) return process.env.EMPLOYEES_XLSX;
  // 이 파일 기준(ROOT)을 먼저, process.cwd() 는 예외가 나도 무시하고 보조로 사용한다.
  let cwdCandidate = null;
  try { cwdCandidate = path.join(process.cwd(), 'employees.xlsx'); } catch (e) { /* cwd 를 알 수 없는 환경 */ }
  const found = [path.join(ROOT, 'employees.xlsx'), cwdCandidate].filter(Boolean).find((p) => fs.existsSync(p));
  if (found) return found;
  return serverless ? path.join(DATA_DIR, 'employees.xlsx') : path.join(ROOT, 'employees.xlsx');
}

module.exports = { ROOT, DATA_DIR, employeesPath, serverless };
