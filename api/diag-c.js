// 진단 c: 최상단에서 내장 모듈 fs 를 require. GET /api/diag-c
const fs = require('fs');
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => send(res, { canary: 'c(top-level require fs)', ok: true, readdirSync: typeof fs.readdirSync });
