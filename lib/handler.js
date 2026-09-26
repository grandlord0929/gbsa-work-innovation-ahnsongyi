// Vercel 서버리스 함수의 공통 요청 핸들러 (api/app.js 가 사용).
//
// - Express 앱(server.js)은 첫 요청 때 지연 로드한다. 로드 실패(환경변수 누락, 모듈 오류 등)는 JSON 으로 사유를 응답하고,
//   처리되지 않은 예외/거부는 Vercel 런타임 로그에 남긴다. (프로세스 자체가 죽는 경우는 응답할 수 없음)
// - GET /api/_boot?step=info|supabase|app : 배포 환경 진단용 엔드포인트. 키/암호 값은 절대 출력하지 않고 설정 여부만 보여준다.
//   사번 로그인한 관리자(기획조정실/인사총무팀) 세션 쿠키가 필요하다.
const { verifySession, readCookie, isAdmin } = require('./session');

// 처리되지 않은 예외/거부를 런타임 로그(Vercel Logs)에 남긴다. (프로세스 동작은 바꾸지 않는 monitor / 로그 전용 리스너)
process.on('uncaughtExceptionMonitor', (e, origin) => console.error(`❌ [uncaughtException:${origin}]`, e));
process.on('unhandledRejection', (reason) => console.error('❌ [unhandledRejection]', reason));

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

async function boot(step) {
  const out = { step, node: process.version, platform: `${process.platform}/${process.arch}` };
  const t = Date.now();
  switch (step) {
    case 'info':
      out.env = {
        VERCEL: !!process.env.VERCEL,
        NODE_ENV: process.env.NODE_ENV || null,
        SESSION_KEY: !!(process.env.SESSION_SECRET || process.env.SUPABASE_KEY),
      };
      out.supabase = require('./supabaseClient').describeSupabaseEnv(); // 설정 여부/URL 형태만 (값은 출력 안 함)
      break;
    case 'supabase': { // 환경변수 + 연결 + 테이블 존재 확인 (각 테이블에서 1행만 조회)
      const { getSupabase } = require('./supabaseClient');
      const sb = getSupabase();
      out.tables = {};
      for (const table of ['employees', 'requests', 'tasks', 'submissions', 'chat_logs']) {
        const r = await sb.from(table).select('*').limit(1);
        out.tables[table] = r.error ? `ERR: ${r.error.message}` : 'ok';
      }
      break;
    }
    case 'app':
      loadApp();
      out.loaded = !!app; out.loadMs = loadMs; if (loadError) out.error = loadError.message;
      break;
    default:
      out.error = '알 수 없는 step. info | supabase | app';
  }
  out.ms = Date.now() - t;
  return out;
}

function handler(req, res) {
  try {
    if (req.url && req.url.startsWith('/api/_boot')) {
      const who = verifySession(readCookie(req));
      if (!who) return sendJson(res, 401, { error: '로그인이 필요합니다.', code: 'LOGIN_REQUIRED' });
      if (!isAdmin(who)) return sendJson(res, 403, { error: '관리자 부서 사원만 진단 정보를 볼 수 있습니다.', code: 'ADMIN_ONLY' });
      const step = new URL(req.url, 'http://x').searchParams.get('step') || 'info';
      return boot(step).then(
        (out) => sendJson(res, 200, out),
        (e) => sendJson(res, 500, { step, error: e.message })
      );
    }
    loadApp();
    if (loadError) return sendJson(res, 500, { error: `서버 시작 실패: ${loadError.message}` });
    return app(req, res);
  } catch (e) {
    console.error('❌ 요청 처리 중 예외:', e);
    return sendJson(res, 500, { error: `요청 처리 실패: ${e.message}` });
  }
}

module.exports = handler;
