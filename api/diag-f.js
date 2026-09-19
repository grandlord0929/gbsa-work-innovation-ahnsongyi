// 진단 f: 최상단에서 상대 경로 lib/security 를 require. GET /api/diag-f
const security = require('../lib/security');
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => send(res, { canary: 'f(top-level relative require)', ok: true, keys: Object.keys(security) });
