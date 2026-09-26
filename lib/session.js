// 사번 로그인 세션. 서버리스(Vercel)는 인스턴스 간 메모리를 공유하지 않으므로 서버에 세션을 저장하지 않고,
// HMAC 으로 서명한 토큰을 HttpOnly 쿠키에 담는다. (HTTP Basic 접근 암호가 Authorization 헤더를 쓰므로 쿠키를 사용한다)
//   서명 키: SESSION_SECRET > SUPABASE_KEY 에서 파생(서버 전용 비밀이라 별도 설정 없이도 모든 인스턴스가 같은 키를 갖는다) > 프로세스 임시 키(로컬/테스트)
//   초기 비밀번호 = 사번. ADMIN_EMP_NOS(쉼표 구분)를 지정하면 그 사번만 관리자 기능/타인 데이터에 접근할 수 있다(미지정: 로그인한 모든 사원).
const crypto = require('crypto');

const COOKIE = 'gbsa_session';
const MAX_AGE_SEC = 8 * 60 * 60; // 8시간

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const eqSafe = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const ephemeral = crypto.randomBytes(32).toString('hex');
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const key = String(process.env.SUPABASE_KEY || '').trim();
  return key ? `gbsa-session:${crypto.createHash('sha256').update(key).digest('hex')}` : ephemeral;
}
const mac = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function signSession(user, now = Date.now()) {
  const payload = b64(JSON.stringify({ e: user.empNo, n: user.name, d: user.dept, x: Math.floor(now / 1000) + MAX_AGE_SEC }));
  return `${payload}.${mac(payload)}`;
}

// 유효하면 { empNo, name, dept }, 아니면 null (서명 불일치/만료/형식 오류)
function verifySession(token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !eqSafe(sig, mac(payload))) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!j.e || !(j.x > now / 1000)) return null;
    return { empNo: String(j.e), name: String(j.n || ''), dept: String(j.d || '') };
  } catch { return null; }
}

function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; } }
  }
  return '';
}

const isHttps = (req) => req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function setSessionCookie(req, res, user) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(signSession(user))}; Path=/; Max-Age=${MAX_AGE_SEC}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}
function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}

// 관리자 판정: ADMIN_EMP_NOS 미지정이면 로그인한 모든 사원이 관리자 화면을 쓸 수 있다(사원 DB 에 직급/권한 컬럼이 없음)
function isAdmin(session, env = process.env) {
  const list = String(env.ADMIN_EMP_NOS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !!session && (list.length === 0 || list.includes(session.empNo));
}

// 로그인 없이 접근 가능한 API: 헬스체크, 로그인/로그아웃, Basic 인증 진입 리다이렉트
const PUBLIC_API = new Set(['/api/health', '/api/login', '/api/auth/login', '/api/auth/logout']);

// req.session 을 채우고, 공개 경로가 아닌 /api/* 는 로그인을 요구한다(401 code=LOGIN_REQUIRED)
function sessionGuard(req, res, next) {
  req.session = verifySession(readCookie(req));
  if (req.session || PUBLIC_API.has(req.path) || !req.path.startsWith('/api')) return next();
  res.status(401).json({ error: '로그인이 필요합니다.', code: 'LOGIN_REQUIRED' });
}

// 관리자 전용 라우트 가드
const adminOnly = (req, res, next) => (isAdmin(req.session) ? next() : res.status(403).json({ error: '관리자 권한이 필요합니다.', code: 'FORBIDDEN' }));

// 대상 사번이 본인이거나 관리자면 허용. 미지정이면 로그인 사원으로 매핑한다.
function scopedEmpNo(req, requested) {
  const want = String(requested || '').trim();
  if (!want || want === req.session.empNo) return req.session.empNo;
  if (isAdmin(req.session)) return want;
  const e = new Error('본인의 업무만 조회/제출할 수 있습니다.'); e.status = 403; throw e;
}

module.exports = { COOKIE, signSession, verifySession, readCookie, setSessionCookie, clearSessionCookie, isAdmin, sessionGuard, adminOnly, scopedEmpNo, eqSafe };
