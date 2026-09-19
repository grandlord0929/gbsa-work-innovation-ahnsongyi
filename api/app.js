// Vercel 함수 진입점 (vercel.json 의 rewrite: /api/* → /api/app).
// Node http 서버 스타일: 서버를 만들어 listen 하면 Vercel 런타임이 그 서버로 요청을 프록시한다.
// - 요청 본문(req)을 Vercel 헬퍼가 미리 소비하지 않아 express.json / multer 가 정상 동작한다.
// - 함수 export 에 `listen` 속성을 다는 방식은 배포 환경에서 응답 없이 멈추는 문제가 확인되어 사용하지 않는다.
const http = require('http');
const handler = require('../lib/handler');

http.createServer(handler).listen(0);
