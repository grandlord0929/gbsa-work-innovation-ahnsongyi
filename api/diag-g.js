// 진단 g: 서드파티/내장 모듈이 배포 환경에서 로드되는지 각각 확인 (각각 try/catch). GET /api/diag-g
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => {
  const out = { canary: 'g(module loading)', node: process.version };
  for (const m of ['express', 'multer', 'xlsx', 'cors', 'node:sqlite']) {
    try { const x = require(m); out[m] = 'ok ' + typeof x; } catch (e) { out[m] = 'ERR: ' + e.message.split('\n')[0]; }
  }
  send(res, out);
};
