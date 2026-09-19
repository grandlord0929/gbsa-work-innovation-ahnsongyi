// 배포용 접근 제어/보안 헤더. 이 앱에는 사용자 로그인이 없으므로 공개 URL에서는 반드시 접근 암호를 건다.
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// BASIC_AUTH_PASS 가 설정되면 /api/health 를 제외한 모든 경로에 HTTP Basic 인증을 요구한다.
function basicAuth({ user, pass }) {
  return (req, res, next) => {
    if (req.path === '/api/health') return next(); // 호스팅 헬스체크용 (내부 정보 없음)
    const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="GBSA Reminder (team test)", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow', // 팀 테스트용 사이트가 검색에 노출되지 않도록
  });
  next();
}

// 운영(NODE_ENV=production)에서 접근 암호가 없으면 시작을 거부한다(fail closed).
// 의도적으로 공개하려면 ALLOW_PUBLIC=true.
// process.exit 대신 예외를 던져, 서버리스(Vercel)에서도 api/index.js 가 원인을 응답에 담을 수 있게 한다.
function assertProductionSafe(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.BASIC_AUTH_PASS && env.ALLOW_PUBLIC !== 'true') {
    throw new Error(
      '환경변수 BASIC_AUTH_PASS 가 설정되지 않아 서버를 시작하지 않았습니다(인증 없이 공개되는 것을 막기 위함). ' +
      'Vercel/Render 프로젝트 설정의 Environment Variables 에 BASIC_AUTH_PASS 를 추가한 뒤 재배포하세요. ' +
      '(의도적으로 공개하려면 ALLOW_PUBLIC=true)'
    );
  }
}

module.exports = { basicAuth, securityHeaders, assertProductionSafe };
