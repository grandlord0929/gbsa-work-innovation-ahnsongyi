// Vercel 서버리스 함수 진입점. vercel.json 의 rewrites 가 /api/* 요청을 이 함수로 보낸다.
// Express 앱은 함수형 핸들러(req, res)이므로 그대로 export 하면 된다.
//
// 앱 로드(환경변수 누락, 모듈 오류 등)에 실패하면 함수가 죽어 원인을 알 수 없는 500 이 되므로,
// 실패 사유를 JSON 으로 응답해 화면(빨간 배너)과 Vercel 로그에 그대로 보이게 한다. (스택은 로그에만 남김)
let handler;
try {
  handler = require('../server');
} catch (error) {
  console.error('❌ 서버 시작 실패:', error);
  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: `서버 시작 실패: ${error.message}` }));
  };
}
module.exports = handler;
