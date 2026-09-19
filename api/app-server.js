// 변형 C: Node http 서버 스타일. 서버를 만들어 listen 하면 Vercel 런타임이 그 서버로 요청을 프록시한다. GET /api/app-server
const http = require('http');
const handler = require('../lib/handler');
http.createServer(handler).listen(0);
