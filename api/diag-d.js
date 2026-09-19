// 진단 d: process.cwd() 만 (try/catch 로 보호). GET /api/diag-d
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => {
  const out = { canary: 'd(process.cwd)', dirname: __dirname };
  try { out.cwd = process.cwd(); } catch (e) { out.cwdError = e.message; }
  send(res, out);
};
