// D-day/마감 판정은 한국 기준. Vercel 등 UTC 서버에서는 한국 시간 0~9시에 날짜가 하루 어긋나므로
// 어떤 Date 계산보다 먼저 시간대를 고정한다. (SQLite 쪽은 '+9 hours' 고정 오프셋 사용)
process.env.TZ = process.env.APP_TZ || 'Asia/Seoul';

const path = require('path');
const express = require('express');
const cors = require('cors');
const { basicAuth, securityHeaders, assertProductionSafe } = require('./lib/security');

// 운영 환경에서 접근 암호 없이 공개되는 것을 차단. 직접 실행(로컬/Render)이면 메시지만 출력하고 종료,
// Vercel 에서는 예외가 api/index.js 로 전달되어 오류 응답으로 노출된다.
try {
  assertProductionSafe();
} catch (e) {
  if (require.main === module) { console.error('❌ ' + e.message); process.exit(1); }
  throw e;
}

// 사원명부(employees.xlsx)는 Git에 없으므로 없으면 가상 사원 200명을 생성 (Vercel 은 /tmp 에 생성)
require('./scripts/ensure-employees').ensureEmployees();

require('./db'); // 스키마 생성/마이그레이션
const { seedIfEmpty } = require('./lib/assign');

// 최초 실행 시 사원 DB(엑셀) 기준으로 초기 업무를 배포한다. 엑셀이 없어도 서버는 뜨고, 오류 원인만 로그로 남긴다.
try {
  if (seedIfEmpty()) console.log('초기 시드 데이터를 생성했습니다.');
} catch (error) {
  console.error('❌ 초기 시드 실패 (employees.xlsx 확인):', error.message);
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

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'gbsa-reminder-backend' }));

// 접근 암호 로그인 진입점: 브라우저 주소창 이동(top-level)으로 접근하면 인증 창이 확실히 뜨고,
// 인증에 성공하면 화면으로 돌려보낸다. (Vercel 은 화면이 CDN 정적이라 API 호출로만 인증이 걸리기 때문)
app.get('/api/login', (req, res) => res.redirect('/'));
// ==========================================
// [추가] 엑셀 사원 DB 조회를 위한 API 엔드포인트
// ==========================================
const { getEmployees, findEmployee } = require('./lib/excelDb');

// 1. 전체 사원 목록 조회 API
app.get('/api/employees', (req, res) => {
  try {
    const data = getEmployees();
    res.json({ success: true, count: data.length, employees: data });
  } catch (error) {
    console.error('❌ /api/employees 에러:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. 사원 이름/사번/부서 검색 API (예: /api/employees/search?q=홍길동)
app.get('/api/employees/search', (req, res) => {
  try {
    const data = findEmployee(String(req.query.q || '').trim());
    res.json({ success: true, count: data.length, employees: data });
  } catch (error) {
    console.error('❌ /api/employees/search 에러:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. 직원 모드 로그인 사원 (홍길동이 사원 DB에 있으면 홍길동, 없으면 바이오센터 첫 사원)
app.get('/api/me', (req, res) => {
  try {
    const me = require('./lib/excelDb').getDefaultUser();
    if (!me) return res.status(404).json({ error: '사원 DB에 사원이 없습니다.' });
    res.json(me);
  } catch (error) {
    console.error('❌ /api/me 에러:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/tasks', tasksRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/stats', statsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/demo', require('./routes/demo'));

// 프론트엔드(public/index.html)를 같은 서버에서 정적으로 서빙
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Vercel 은 app 을 함수 핸들러로 직접 호출하므로 listen 하지 않는다 (api/index.js 가 이 앱을 export).
// `node server.js` 로 직접 실행(로컬/Render)할 때만 포트를 연다.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GBSA 리마인더 백엔드 서버 실행 중: 포트 ${PORT} (http://localhost:${PORT})`);
    console.log(`접근 암호(Basic Auth): ${process.env.BASIC_AUTH_PASS ? '사용' : '미사용 (로컬 개발용)'}`);
    console.log(`헬스체크: /api/health`);
  });
}

module.exports = app;
