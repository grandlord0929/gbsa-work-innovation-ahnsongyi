// 진단 prog-2: 내보내는 함수에 listen 속성을 단 최소 함수. GET /api/prog-2
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
function handler(req, res) { send(res, { canary: 'prog-2(handler.listen)', ok: true }); }
handler.listen = () => { throw new Error('listen 금지'); };
module.exports = handler;
