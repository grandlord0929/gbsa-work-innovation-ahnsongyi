// 날짜/시각 계산은 lib/time.js 가 Asia/Seoul 을 명시해 처리하므로 서버 OS 시간대(Vercel 은 UTC)에 의존하지 않는다.
// 로그 등 Date 기본 동작도 한국 기준이 되도록 프로세스 시간대도 맞춰 둔다.
process.env.TZ = process.env.APP_TZ || 'Asia/Seoul';

const path = require('path');
const express = require('express');
const cors = require('cors');
const { basicAuth, securityHeaders, assertProductionSafe } = require('./lib/security');
const { listEmployees, getEmployee } = require('./lib/data');
const { wrap } = require('./lib/http');
const { sessionGuard, adminOnly } = require('./lib/session');

// 운영 환경에서 접근 암호 없이 공개되는 것을 차단. 직접 실행(로컬/Render)이면 메시지만 출력하고 종료,
// Vercel 에서는 예외가 진입점(lib/handler.js)으로 전달되어 오류 응답으로 노출된다.
try {
  assertProductionSafe();
} catch (e) {
  if (require.main === module) { console.error('❌ ' + e.message); process.exit(1); }
  throw e;
}

const tasksRouter = require('./routes/tasks');
const analyzeRouter = require('./routes/analyze');
const statsRouter = require('./routes/stats');
const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 4000; // Render/Railway 등은 PORT 를 주입한다

app.disable('x-powered-by');
app.use(securityHeaders);
// 프론트와 API가 같은 출처이므로 CORS 는 기본 비활성. 다른 도메인에서 호출해야 할 때만 CORS_ORIGIN(쉼표 구분) 지정.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) }));
if (process.env.BASIC_AUTH_PASS) {
  app.use(basicAuth({ user: process.env.BASIC_AUTH_USER || 'gbsa', pass: process.env.BASIC_AUTH_PASS }));
}
app.use(express.json({ limit: '5mb' }));
// 사번 로그인 세션: 공개 경로(/api/health, /api/auth/login 등)를 뺀 모든 /api/* 는 로그인(쿠키)이 필요하다.
app.use(sessionGuard);
app.use('/api/auth', require('./routes/auth'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'gbsa-reminder-backend' }));

// 접근 암호 로그인 진입점: 브라우저 주소창 이동(top-level)으로 접근하면 인증 창이 확실히 뜨고,
// 인증에 성공하면 화면으로 돌려보낸다. (Vercel 은 화면이 CDN 정적이라 API 호출로만 인증이 걸리기 때문)
app.get('/api/login', (req, res) => res.redirect('/'));

// ---- 사원 DB (Supabase employees 테이블) ----
const toKorean = (e) => ({ 사번: e.empNo, 사원명: e.name, 부서명: e.dept }); // 프론트 호환 형태

// 1. 전체 사원 목록
app.get('/api/employees', wrap(async (req, res) => {
  const data = (await listEmployees()).map(toKorean);
  res.json({ success: true, count: data.length, employees: data });
}));

// 2. 사원 이름/사번/부서 검색 (예: /api/employees/search?q=홍길동)
app.get('/api/employees/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const data = (await listEmployees())
    .filter((e) => !q || e.name.includes(q) || e.empNo.includes(q) || e.dept.includes(q))
    .map(toKorean);
  res.json({ success: true, count: data.length, employees: data });
}));

// 3. 직원 모드 로그인 사원 = 사번 로그인한 사원(세션). 세션 사원이 DB 에 없으면(재시드 등) 기본 사원으로 대체하지 않고 401.
app.get('/api/me', wrap(async (req, res) => {
  const me = await getEmployee(req.session.empNo);
  if (!me) return res.status(401).json({ error: '로그인이 필요합니다.', code: 'LOGIN_REQUIRED' });
  res.json(me);
}));

app.use('/api/admin', adminOnly, require('./routes/admin'));
app.use('/api/tasks', tasksRouter);
app.use('/api/analyze', adminOnly, analyzeRouter);
app.use('/api/stats', adminOnly, statsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/demo', adminOnly, require('./routes/demo'));

// 프론트엔드(public/index.html)를 같은 서버에서 정적으로 서빙 (Vercel 에서는 CDN 이 직접 서빙)
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] })); // /login → login.html

app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.code === 'LIMIT_FILE_SIZE') { // multer: 업로드 파일 용량 초과
    return res.status(413).json({ error: '파일 용량 초과: 수료증 파일은 1MB 이하만 제출할 수 있습니다.', code: 'FILE_TOO_LARGE' });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// `node server.js` 로 직접 실행(로컬/Render)할 때만 포트를 연다. Vercel 은 api/app.js 가 이 앱을 사용한다.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GBSA 리마인더 백엔드 서버 실행 중: 포트 ${PORT} (http://localhost:${PORT})`);
    console.log(`접근 암호(Basic Auth): ${process.env.BASIC_AUTH_PASS ? '사용' : '미사용 (로컬 개발용)'}`);
    console.log(`Supabase: ${process.env.SUPABASE_URL && process.env.SUPABASE_KEY ? '설정됨' : '❌ SUPABASE_URL / SUPABASE_KEY 미설정'}`);
  });
}

module.exports = app;
