// 배포용 보안 헤더 및 운영 환경 점검. 접근 인증은 사번 로그인 세션(lib/session.js, /api/auth/login)으로 일원화했다.
// (HTTP Basic 인증은 제거됨 — 브라우저 기본 로그인 팝업이 더 이상 뜨지 않는다)

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow', // 팀 테스트용 사이트가 검색에 노출되지 않도록
  });
  next();
}

// 운영(NODE_ENV=production)에서는 세션 서명 키가 있어야 한다(SESSION_SECRET 또는 SUPABASE_KEY 에서 파생).
// 없으면 인스턴스마다 임시 키가 생겨 로그인 세션이 서버리스 인스턴스 사이에서 깨지므로 시작을 거부한다(fail closed).
// process.exit 대신 예외를 던져, 서버리스(Vercel)에서도 lib/handler.js 가 원인을 응답에 담을 수 있게 한다.
function assertProductionSafe(env = process.env) {
  if (env.NODE_ENV === 'production' && !String(env.SESSION_SECRET || '').trim() && !String(env.SUPABASE_KEY || '').trim()) {
    throw new Error(
      '세션 서명 키가 없어 서버를 시작하지 않았습니다. Vercel/Render 프로젝트 설정의 Environment Variables 에 ' +
      'SUPABASE_KEY(또는 SESSION_SECRET)를 추가한 뒤 재배포하세요.'
    );
  }
}

module.exports = { securityHeaders, assertProductionSafe };
