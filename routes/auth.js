// 사번 로그인. ID = 사원 DB(employees.emp_no)의 사번, 초기 비밀번호 = 사번과 동일.
//   POST /api/auth/login   { id, password }  → 세션 쿠키 발급 + 사원 프로필
//   POST /api/auth/logout                    → 세션 쿠키 삭제
//   GET  /api/auth/me                        → 현재 로그인 사원 프로필 (없으면 401)
const express = require('express');
const { getEmployee } = require('../lib/data');
const { wrap } = require('../lib/http');
const { setSessionCookie, clearSessionCookie, isAdmin, eqSafe } = require('../lib/session');

const router = express.Router();

// 사원 DB 에는 직급 컬럼이 없어 position 은 빈 값으로 내려준다(컬럼이 생기면 여기서 매핑).
const profile = (e) => ({ empNo: e.empNo, name: e.name, dept: e.dept, position: e.position || '', isAdmin: isAdmin(e) }); // 관리자 여부는 DB 의 현재 소속 부서 기준

// 무차별 대입 완화: 같은 IP 에서 10분 내 실패 8회 → 잠시 차단. (서버리스 인스턴스별 메모리라 완전한 방어는 아님)
const fails = new Map();
const WINDOW_MS = 10 * 60 * 1000, MAX_FAILS = 8;
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
function blocked(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f) return false;
  if (now - f.first > WINDOW_MS) { fails.delete(ip); return false; }
  return f.n >= MAX_FAILS;
}
function noteFail(ip, now = Date.now()) {
  const f = fails.get(ip);
  if (!f || now - f.first > WINDOW_MS) fails.set(ip, { n: 1, first: now });
  else f.n += 1;
}

router.post('/login', wrap(async (req, res) => {
  const ip = ipOf(req);
  if (blocked(ip)) return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', code: 'TOO_MANY_ATTEMPTS' });

  const b = req.body || {};
  const id = String(b.id ?? b.empNo ?? '').trim().toUpperCase().slice(0, 40);
  const password = String(b.password ?? '').trim().toUpperCase().slice(0, 40);
  if (!id || !password) return res.status(400).json({ error: '사번(아이디)과 비밀번호를 입력해 주세요.', code: 'MISSING_FIELDS' });

  const emp = await getEmployee(id);
  // 사원 존재 여부와 비밀번호 불일치를 구분하지 않는다(사번 유추 방지). 초기 비밀번호 = 사번.
  if (!emp || !eqSafe(password, emp.empNo)) {
    noteFail(ip);
    return res.status(401).json({ error: '사번 또는 비밀번호가 올바르지 않습니다.', code: 'INVALID_CREDENTIALS' });
  }
  fails.delete(ip);
  setSessionCookie(req, res, emp);
  res.json({ ok: true, user: profile(emp), message: `${emp.name} 님 환영합니다` });
}));

router.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', wrap(async (req, res) => {
  const emp = req.session && (await getEmployee(req.session.empNo));
  if (!emp) { clearSessionCookie(req, res); return res.status(401).json({ error: '로그인이 필요합니다.', code: 'LOGIN_REQUIRED' }); }
  res.json({ user: profile(emp) });
}));

module.exports = router;
