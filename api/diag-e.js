// 진단 e: 핸들러 안에서(try/catch) 상대 경로로 lib/security 를 require. GET /api/diag-e
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => {
  const out = { canary: 'e(relative require in handler)' };
  try { out.keys = Object.keys(require('../lib/security')); } catch (e) { out.error = e.message; }
  send(res, out);
};
