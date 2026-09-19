// Vercel 서버리스 함수 진입점. vercel.json 의 rewrites 가 /api/* 요청을 이 함수로 보낸다.
//
// - Express 앱(server.js)은 첫 요청 때 지연 로드한다. 로드 실패(환경변수 누락, 모듈 오류 등)는 JSON 으로 사유를 응답하고,
//   처리되지 않은 예외/거부는 Vercel 런타임 로그에 남긴다. (프로세스 자체가 죽는 경우는 응답할 수 없음)
// - GET /api/_boot?step=... : 배포 환경에서 어느 단계가 실패하는지 좁혀 보는 진단용 엔드포인트.
//   BASIC_AUTH_PASS 가 설정돼 있으면 같은 아이디/암호가 필요하다. 문제 해결 후 삭제해도 된다.
const path = require('path');
const { isAuthorized } = require('../lib/security');

process.on('uncaughtExceptionMonitor', (e, origin) => console.error(`❌ [${origin}]`, e));

let app = null;
let loadError = null;
let loadMs = 0;
function loadApp() {
  if (app || loadError) return;
  const t = Date.now();
  try {
    app = require('../server');
  } catch (e) {
    loadError = e;
    console.error('❌ 서버 시작 실패:', e);
  }
  loadMs = Date.now() - t;
  console.log(`[boot] server.js 로드 ${loadError ? '실패' : '성공'} (${loadMs}ms)`);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

// 각 단계는 독립 요청으로 실행된다. 어느 단계에서 함수가 죽는지(플랫폼 500)로 원인 범위를 좁힐 수 있다.
function boot(step) {
  const fs = require('fs');
  const os = require('os');
  const out = { step, node: process.version, platform: `${process.platform}/${process.arch}` };
  const t = Date.now();
  switch (step) {
    case 'info': {
      out.cwd = process.cwd();
      out.env = { VERCEL: !!process.env.VERCEL, NODE_ENV: process.env.NODE_ENV || null, BASIC_AUTH_PASS: !!process.env.BASIC_AUTH_PASS, TZ: process.env.TZ || null };
      out.tmpdir = os.tmpdir();
      try { fs.writeFileSync(path.join(os.tmpdir(), '.w'), '1'); out.tmpWritable = true; } catch (e) { out.tmpWritable = e.message; }
      out.employeesBundled = fs.existsSync(path.join(process.cwd(), 'employees.xlsx'));
      try { out.sqliteBuiltin = typeof require('node:sqlite').DatabaseSync; } catch (e) { out.sqliteBuiltin = 'ERR: ' + e.message; }
      try { out.cwdFiles = fs.readdirSync(process.cwd()).slice(0, 40); } catch (e) { out.cwdFiles = 'ERR: ' + e.message; }
      break;
    }
    case 'sqlite': {
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(':memory:');
      d.exec('CREATE TABLE t(a)'); d.prepare('INSERT INTO t VALUES (?)').run(1);
      out.rows = d.prepare('SELECT COUNT(*) AS n FROM t').get().n;
      break;
    }
    case 'sqlitefile': {
      const { DatabaseSync } = require('node:sqlite');
      const dir = path.join(os.tmpdir(), 'gbsa-boot'); fs.mkdirSync(dir, { recursive: true });
      const d = new DatabaseSync(path.join(dir, 'boot.db'));
      out.journal = d.prepare('PRAGMA journal_mode = WAL').get();
      d.exec('CREATE TABLE IF NOT EXISTS t(a)'); d.prepare('INSERT INTO t VALUES (?)').run(1);
      out.rows = d.prepare('SELECT COUNT(*) AS n FROM t').get().n;
      d.close();
      break;
    }
    case 'xlsx': {
      const { getEmployees, employeesPath } = require('../lib/excelDb');
      out.file = employeesPath(); out.exists = fs.existsSync(out.file);
      out.count = getEmployees().length;
      break;
    }
    case 'app': {
      loadApp();
      out.loaded = !!app; out.loadMs = loadMs; if (loadError) out.error = loadError.message;
      break;
    }
    default:
      out.error = '알 수 없는 step. info | sqlite | sqlitefile | xlsx | app';
  }
  out.ms = Date.now() - t;
  return out;
}

function handler(req, res) {
  try {
    if (req.url && req.url.startsWith('/api/_boot')) {
      const pass = process.env.BASIC_AUTH_PASS;
      if (pass && !isAuthorized(req.headers.authorization, process.env.BASIC_AUTH_USER || 'gbsa', pass)) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="GBSA Reminder (team test)", charset="UTF-8"');
        return res.end('Authentication required');
      }
      const step = new URL(req.url, 'http://x').searchParams.get('step') || 'info';
      try { return sendJson(res, 200, boot(step)); }
      catch (e) { return sendJson(res, 500, { step, error: e.message, stack: String(e.stack).split('\n').slice(0, 4) }); }
    }
    loadApp();
    if (loadError) return sendJson(res, 500, { error: `서버 시작 실패: ${loadError.message}` });
    return app(req, res);
  } catch (e) {
    console.error('❌ 요청 처리 중 예외:', e);
    return sendJson(res, 500, { error: `요청 처리 실패: ${e.message}` });
  }
}

// Vercel 은 export 된 함수에 `listen` 이 없으면 req/res 에 자체 헬퍼(res.json/send/redirect, req.query/body)를 덧씌운다.
// Express 는 자체 구현을 쓰므로 충돌하지 않게, Express 앱과 동일하게 `listen` 을 노출해 헬퍼 적용 대상에서 제외시킨다.
handler.listen = () => { throw new Error('서버리스 환경에서는 listen 하지 않습니다.'); };

module.exports = handler;
