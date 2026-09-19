// 진단 prog-fs: 파일시스템 동작을 요청마다 하나씩 실행. GET /api/prog-fs?op=cwd|lib|exists|tmp
const fs = require('fs');
const path = require('path');
const send = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
module.exports = (req, res) => {
  const op = new URL(req.url, 'http://x').searchParams.get('op') || 'none';
  const out = { canary: 'prog-fs', op };
  try {
    if (op === 'cwd') out.result = fs.readdirSync(process.cwd()).slice(0, 40);
    else if (op === 'lib') out.result = fs.readdirSync(path.join(__dirname, '..', 'lib'));
    else if (op === 'exists') out.result = fs.existsSync(path.join(__dirname, '..', 'employees.xlsx'));
    else if (op === 'tmp') { fs.writeFileSync('/tmp/.canary', '1'); out.result = fs.readFileSync('/tmp/.canary', 'utf8'); }
  } catch (e) { out.error = e.message; }
  send(res, out);
};
