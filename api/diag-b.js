// 진단 b: 최상단에서 내장 모듈 path 를 require. GET /api/diag-b
const path = require('path');
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => send(res, { canary: 'b(top-level require path)', ok: true, sep: path.sep, dirname: __dirname });
