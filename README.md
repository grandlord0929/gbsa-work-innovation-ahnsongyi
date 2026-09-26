# GBSA 지능형 통합 업무 리마인더 시스템

Express 백엔드 + 정적 프론트(`public/index.html`) + **Supabase(PostgreSQL)**. 직원 모드 ↔ 관리자 모드가 같은 DB를 통해 양방향으로 연동됩니다.

> 데이터 저장소는 로컬 파일(엑셀/SQLite)에서 **Supabase 클라우드 DB로 완전히 전환**되었습니다. 재시작·재배포·서버리스 콜드 스타트와 무관하게 데이터가 유지되고, 여러 사람이 같은 데이터를 봅니다.

## 빠른 시작

### 1. Supabase 준비 (최초 1회)
1. https://supabase.com 에서 프로젝트 생성
2. 대시보드 → **SQL Editor** → New query → [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여 넣고 **Run** (테이블 5개 생성 + RLS 활성화)
3. 대시보드 → **Project Settings → API**에서 `Project URL` 과 **`service_role` 키**를 확인

### 2. 환경변수 설정
```bash
cp .env.example .env     # 그리고 SUPABASE_URL / SUPABASE_KEY 채우기
```
| 이름 | 설명 |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_KEY` | **service_role 키** (서버 전용 비밀키, anon 키 아님) |
| `SESSION_SECRET` | (선택) 로그인 세션 서명 키. 비우면 `SUPABASE_KEY` 에서 자동 파생 |
| `DEMO_USER_EMPNO` | 직원 모드 기본 로그인 사번 (기본: 홍길동) |

### 3. 초기 데이터 시드 + 실행
```bash
npm install
### 사번 로그인
- 앱 접속 시 로그인하지 않았으면 `/login` 으로 이동합니다. 아이디 = 사번(사원 DB `employees.emp_no`), 초기 비밀번호 = 사번.
- `POST /api/auth/login` → 서명된 HttpOnly 쿠키(`gbsa_session`, 8시간) 발급 / `POST /api/auth/logout` / `GET /api/auth/me`
- `/api/health`, `/api/auth/login|logout` 을 제외한 모든 `/api/*` 는 로그인이 필요합니다(401 `LOGIN_REQUIRED`). 사번을 생략한 `/api/tasks`, `/api/chat`, 수료증 업로드는 로그인 사원으로 자동 매핑됩니다.
- 관리자 모드는 소속 부서가 **기획조정실 또는 인사총무팀**인 사원만 사용할 수 있습니다(`ADMIN_DEPTS` 로 변경 가능). 그 외 부서는 관리자 탭이 숨겨지고, `#admin` 직접 접근은 안내 후 메인으로 이동하며, 관리자 API 는 403(`ADMIN_ONLY`)입니다. 일반 사원은 본인 업무만 조회/제출할 수 있습니다.

### 제출 요청 이메일 (관리자 모드)
- 관리자 현황판의 사원 행 [📧 제출 요청](또는 상세 모달의 업무별 [📧 요청])을 누르면 `POST /api/admin/send-reminder { empNo, taskId? }` 로 안내 메일이 발송됩니다. 성명·부서·업무명·마감일은 클라이언트 값이 아니라 DB 기준으로 채웁니다(관리자 확인 대기 중인 업무는 제외).
- Resend REST API(HTTPS 443)를 사용하며 환경변수 `RESEND_API_KEY`, `SENDER_EMAIL`, `REMINDER_TEST_RECIPIENTS`(시연용 1~3개, 이 주소로만 발송), 선택 `APP_URL` 이 필요합니다. 설정이 없으면 503 안내가 나오고 다른 기능은 영향이 없습니다.
- 관리자 화면의 **[제출요청 발송]**·**[선택 업무 제출요청 발송]** 도 업무를 만든 뒤 **요청 1건당 안내 메일 1통**(대상 부서·인원·마감일·제출 링크 포함)을 시연용 주소로 보냅니다(`POST /api/tasks/bulk` 응답의 `mail`). 메일이 실패하거나 설정이 없어도 업무 발송은 성공하며, 한 번에 최대 10통까지 발송합니다.
- 발송 이력은 응답의 `sentAt`과 `reminder_logs` 테이블에 남습니다(테이블은 `supabase/schema.sql` 을 다시 실행하면 생기며, 없어도 발송은 동작). 같은 사원에게는 60초 안에 다시 보낼 수 없습니다.

npm run seed             # seed-data/*.csv(백업 데이터)로 사원 19명·업무 106건·제출 이력 34건을 통째로 교체 (멱등)
npm run seed -- --synthetic   # 이전 방식: 가상 사원 200명 + 기본 업무 801건 (사원은 upsert)
npm run dev              # http://localhost:4000
```
- `npm run seed -- --synthetic --reset` : 업무/제출/요청/대화 이력을 모두 지우고 초기 상태로 다시 시드 (사원 유지)
- 화면의 「↺ 시연 데이터 초기화」 버튼도 같은 초기화를 수행합니다(`POST /api/demo/reset`).
- 테이블이 없거나 키가 잘못되면 시드 스크립트가 원인을 안내합니다.

## 구조

```
api/app.js            Vercel 함수 진입점 (Node http 서버 스타일)
lib/handler.js        요청 핸들러: Express 지연 로드, /api/_boot 진단, 오류를 JSON 으로 응답
server.js             Express 앱 (라우팅, 사번 로그인 세션 가드, 보안 헤더). `node server.js` 로도 직접 실행
lib/supabaseClient.js Supabase 클라이언트 (환경변수 → 클라이언트, 오류 변환, 1000행 페이지네이션)
lib/data.js           데이터 접근 계층 (사원/업무/제출/집계/채팅)
lib/assign.js         부서 단위 제출요청 발송
lib/seedData.js       가상 사원 200명 + 초기 업무 생성, 시드/초기화
lib/seedCsv.js        seed-data/*.csv → employees/requests/tasks/submissions 교체 시더
seed-data/            백업 데이터(processed_education_submissions / processed_attendance_anomalies / processed_audit_tasks / raw_education_results .csv)
routes/*.js           tasks, admin, stats, chat, demo, analyze
scripts/seedSupabase.js  시드 스크립트
supabase/schema.sql   테이블 정의 + RLS
test/                 API 테스트 (npm test)
```

## 데이터 모델
`employees(emp_no, name, dept)` · `requests`(제출요청 1건) 1 ─ N `tasks`(사원별 업무 1행) 1 ─ N `submissions`(제출 이력, 수료증 OCR 결과) · `chat_logs`

- 직원 화면은 로그인 사원의 `tasks` 행만, 관리자 화면은 전체 행을 서버에서 집계합니다(PostgREST 는 GROUP BY 미지원 → 필요한 컬럼만 1000행 단위로 읽어 집계).
- 시각은 KST(`YYYY-MM-DD HH:MM:SS`), 마감 상태(긴급/주의/기한초과)는 조회 시점에 KST 오늘 기준으로 계산합니다.
- **업로드한 수료증 파일 자체는 저장하지 않고**, 파일명과 OCR 추출값(교육명·발급기관·이수일자)만 제출 이력에 남깁니다. (원본 보관이 필요하면 Supabase Storage 연동을 추가하세요.)

## API

| 방향 | 동작 | API |
|---|---|---|
| 직원 → 관리자 | [제출완료] / 수료증 OCR 업로드 → 해당 사원 행이 `done` | `POST /api/tasks/:id/submit`, `POST /api/tasks/cert-upload` (`empNo`) |
| 관리자 → 직원 | 부서 선택 + 업무명 + 마감일 → 부서 사원 전원에게 업무 생성 | `POST /api/tasks/bulk` `{tasks:[{title,cat,due,targetDept('전체'\|부서명),dept?}]}` |
| 조회 | 사원/업무/집계 | `GET /api/employees`, `/api/employees/search?q=`, `/api/me`, `/api/tasks?empNo=`, `/api/admin/overview`, `/api/admin/employees`, `/api/admin/departments`, `/api/stats` |
| 기타 | 챗봇, 공문 분석, 시연 초기화 | `POST /api/chat`, `POST /api/analyze`, `POST /api/demo/reset`, `GET /api/health` |

`cert-upload` 응답: `200`(매칭 성공) · `422`(자동 특정 불가 → `candidates`) · `404`(대기 중인 교육 업무 없음) · `409`(이미 제출됨). 매칭 로직은 `lib/certMatch.js`.

## 테스트
```bash
npm test
```
- `test/api.test.js` : 인메모리 **가짜 Supabase**(`test/fakeSupabase.js`)로 전체 API 흐름 검증 (NOT NULL·CHECK·외래키·1000행 제한·필터 없는 update/delete 거부 재현)
- `test/postgrest-requests.test.js` : 실제 `@supabase/supabase-js` 가 만드는 HTTP 요청 형태 검증
- 두 테스트 모두 **실제 Supabase 에 접속하지 않습니다.** 실제 DB 와의 최종 확인은 `npm run seed` 성공 + 배포 후 `/api/_boot?step=supabase` 로 하세요.

## 수료증 OCR 검증 (본인 성명 확인)

`POST /api/tasks/cert-upload` 는 **수료증의 성명이 로그인 사원과 일치할 때만** 제출을 처리합니다. 프론트(`public/index.html`)와 서버(`routes/tasks.js`)가 같은 파서 `public/certExtract.js` 로 각각 검증합니다.

| 응답 | 의미 |
|---|---|
| `403 NAME_MISMATCH` | 수료증 성명 ≠ 제출자 성명 → 반려 (`isNameMatched:false`, `matchedName`=수료증 성명, `expectedName`) |
| `403 NAME_UNVERIFIED` | 수료증에서 성명을 읽지 못함 → `nameConfirmed=true` 로 본인 확인 후 재요청하면 제출(이력에 `+name-confirmed` 기록) |
| `400 NAME_TAMPERED` | 프론트가 보낸 `certName` 이 OCR 원문(`ocrText`)에서 서버가 추출한 성명과 다름 |
| `403 CERT_REQUIRED` | 교육 수료증(edu) 업무를 `/submit` 수동 제출로 처리하려는 시도 (수료증 업로드로만 제출 가능, 시연용 예외: `ALLOW_MANUAL_EDU_SUBMIT=true`) |

- **이름 찾기 방식**: 라벨(`성명`, `성      명`, `이름`, `수료자` …)을 찾는 대신, **제출자 이름이 수료증 안 어디에든 이름으로 적혀 있는지**를 봅니다(`CertExtract.findNameInText`). `홍 길 동` 처럼 띄어져도 인정하고, `이수하였으므로` 속 `이수` 처럼 다른 한글에 붙은 경우는 제외합니다(조사·호칭 은/는/이/가/님/씨/귀하 등은 허용). 찾으면 일치, 못 찾았는데 다른 이름(라벨 값 또는 이름만 홀로 적힌 줄)이 있으면 불일치, 아무 이름도 없으면 미확인입니다.
- 교육명은 **여러 줄로 줄바꿈된 값**(최대 4줄)을 다음 항목 라벨·빈 줄·"위 사람은…" 문장·날짜 줄·기관명 줄 직전까지 이어 붙이고 공백을 단일 공백으로 정규화합니다.
- OCR(브라우저 Tesseract.js): 실제 스캔 수료증 실험에서 **PSM 6(텍스트 블록)** 은 교육명·이수일자 등 줄 구조는 잘 읽지만 굵은 이름 값을 `BUS`·`MAE` 로 오인식했고, **PSM 11(흩어진 글자)** 은 이름을 정확히 읽었습니다. 그래서 `원본·PSM6` → `원본·PSM11(이름 찾기)` 순으로 읽고 모든 패스의 원문을 합쳐 파싱하며, 부족할 때만 콘트라스트 조정 → 2배 확대·PSM11 → 이진화 → 자동 분할 → 2배 확대 순으로 이어갑니다. 본인 이름을 찾고 교육명을 읽으면 즉시 중단합니다(예제 PDF 기준 2회·약 4초).
- 화면에는 `이름 일치 여부: ✅ 일치 ('신소율')` / `❌ 불일치 ('강하율')` / `⚠️ 성명 미확인` 뱃지가 표시되고, 불일치 시 제출 버튼이 비활성화됩니다. 파싱 결과 객체에는 `isNameMatched`, `matchedName` 이 담깁니다.
- 「🚫 타인 수료증으로 제출 시도」 시연 버튼으로 반려 흐름을 시연할 수 있고, `npm run dev:fake` 는 실제 DB 없이 화면을 시험하는 가짜 DB 서버입니다.

> **한계**: OCR 이 브라우저에서 실행되므로 서버는 클라이언트가 보낸 OCR 원문을 기준으로 검증합니다(원문 자체를 위조하면 우회 가능). 또한 이 앱에는 실제 로그인이 없어 `empNo` 도 클라이언트가 지정합니다. 위조를 막으려면 서버 측 OCR 과 SSO 로그인이 필요합니다.

### 본인 확인 제출 → 관리자 확인

성명을 자동으로 읽지 못했거나 한 글자만 다른 수료증(OCR 오인식 가능)은 직원이 `본인 수료증임을 확인하고 제출`을 눌러 제출할 수 있지만, **바로 제출 완료가 되지 않고 관리자 확인을 거칩니다.** (성명이 두 글자 이상 다르면 확정 반려)

| 단계 | 직원 화면 | 관리자 화면 |
|---|---|---|
| 본인 확인 제출 (`POST /api/tasks/cert-upload` + `nameConfirmed=true` → **202**) | 🕒 **관리자 확인 중** (업무 카드 · 업로드 패널) | 「수료증 확인 요청」 패널에 이미지 + 인식 결과 |
| 확인 (`POST /api/admin/reviews/:id/approve`) | ✓ **제출 완료** | 업무가 제출완료로 집계 |
| 재제출 요청 (`POST /api/admin/reviews/:id/reject` `{reason}`) | ↩ **수료증 재제출 요청** (사유 표시, 업로드 버튼) | 대기 목록에서 제거, 직원이 다시 올리면 다시 대기 |

- 관리자 확인용 수료증 원본은 Supabase **Storage 비공개 버킷 `cert-uploads`** 에 저장합니다(최초 요청 시 자동 생성, service_role 키 필요). 관리자만 `GET /api/admin/reviews/:id/file` 로 열람합니다. 자동 매칭으로 제출된 수료증은 종전처럼 파일을 저장하지 않습니다.
- 확인 상태는 스키마 변경 없이 `submissions.match_method` 의 태그(`review=pending|approved|rejected|superseded`, `name-confirmed`, `file=…`, `reason=…`)로 기록합니다(`lib/review.js`). 별도 SQL 실행이 필요 없습니다.
- 직원 화면은 10초마다 동기화하며, 확인 중 → 제출 완료 / 재제출 요청으로 바뀌면 토스트와 챗봇 메시지로 알려 줍니다.
- **파일 용량 제한 1MB**: 수료증 파일이 1MB를 넘으면 프론트가 OCR 전에 "파일 용량 초과" 메시지를 띄우고, 서버도 `413 FILE_TOO_LARGE` 로 거부합니다(`MAX_CERT_BYTES`, routes/tasks.js).
- **재제출 요청 표시**: 직원 대시보드 상단에 `↩ 재제출 요청 받음 N건` 배너(사유 포함, [지금 다시 제출])와 KPI 타일이 표시되고, 관리자 화면에는 `재제출 요청 중 N건 (직원 재업로드 대기)` 가 표시됩니다(`/api/admin/overview` 의 `resubmitRequested`).
- 접근 인증은 **사번 로그인 세션**으로 일원화되어 있습니다(HTTP Basic 인증과 브라우저 기본 로그인 팝업은 제거됨). `/api/admin/*` 는 관리자 부서(기획조정실·인사총무팀) 세션만 접근할 수 있습니다.

배포 방법은 [DEPLOY.md](DEPLOY.md), 시연 모드(수료증 OCR)는 화면의 「▶ 시연용 샘플 수료증 자동 입력」 버튼을 참고하세요.
