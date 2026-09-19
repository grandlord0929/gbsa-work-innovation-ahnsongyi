// 진단용 카나리 #2: 프로젝트 내부 파일(lib/security.js)을 불러오는 최소 함수. GET /api/ping2
// ping 은 되는데 ping2 가 실패하면 함수 번들에 프로젝트 파일이 빠졌거나 상대 경로 로딩이 문제다.
const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const out = { canary: 'ping2', node: process.version, cwd: process.cwd() };
  try {
    out.security = Object.keys(require('../lib/security')); // 상대 경로 require
  } catch (e) {
    out.securityError = e.message;
  }
  try { out.rootFiles = fs.readdirSync(process.cwd()).slice(0, 40); } catch (e) { out.rootFiles = 'ERR: ' + e.message; }
  try { out.libFiles = fs.readdirSync(path.join(process.cwd(), 'lib')); } catch (e) { out.libFiles = 'ERR: ' + e.message; }
  out.employeesXlsx = fs.existsSync(path.join(process.cwd(), 'employees.xlsx'));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
};
