// 진단 prog-1: process.on 리스너 등록만 추가한 최소 함수. GET /api/prog-1
process.on('uncaughtExceptionMonitor', (e, origin) => console.error('[uncaughtException]', origin, e));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => send(res, { canary: 'prog-1(process.on)', ok: true });
