# 배포 가이드 (GitHub Private + Vercel/Render + Supabase)

팀원 5~6명이 언제든 접속해 테스트하는 용도입니다. 데이터는 **Supabase(PostgreSQL)** 에 저장되므로 서버가 재시작/재배포/콜드 스타트되어도 유지되고, 인스턴스가 여러 개여도 모두 같은 데이터를 봅니다. (이전 SQLite/엑셀 방식의 "데이터가 휘발되고 인스턴스마다 갈라지는" 한계가 사라졌습니다.)

## 0. 보안 요약 (먼저 읽기)

| 위험 | 대응 |
|---|---|
| 저장소가 Private이어도 **배포된 URL은 공개**됨 | **사번 로그인 세션**으로 보호: `/api/health`·`/api/auth/login` 외 모든 `/api/*` 는 로그인 쿠키가 없으면 401. 관리자 기능은 기획조정실·인사총무팀 소속만. (HTTP Basic 인증/브라우저 팝업은 제거됨) |
| **`SUPABASE_KEY`(service_role) 유출** = DB 전체 읽기/쓰기/삭제 권한 유출 | 서버 환경변수로만 사용. 저장소·채팅·이슈·프론트·로그에 절대 넣지 말 것. `.env` 는 `.gitignore` 처리. 유출 의심 시 Supabase 대시보드에서 즉시 재발급(Rotate) |
| DB 직접 접근 | 모든 테이블에 RLS 를 켜고 정책을 만들지 않음 → anon 키로는 어떤 데이터도 접근 불가 (`supabase/schema.sql`) |
| 허구 데이터 | 시드 사원 200명은 가상 데이터입니다. **실제 직원 정보를 넣지 마세요.** |
| 검색엔진 노출 / CORS | `X-Robots-Tag: noindex`, CORS 기본 비활성 |

- 비밀값(`SUPABASE_KEY`, `RESEND_API_KEY`)은 팀원에게 **개별 메신저**로 전달하세요. 채팅방/이슈/커밋에 적지 마세요.
- 이미 커밋된 비밀은 파일 삭제만으로는 부족합니다(이력에 남음). 즉시 폐기·교체하세요.

## 1. Supabase 준비

1. https://supabase.com → New project (리전은 가까운 곳, 예: Northeast Asia (Seoul))
2. **SQL Editor** → New query → `supabase/schema.sql` 전체 붙여 넣고 **Run**
3. **Project Settings → API** 에서 확인
   - `Project URL` → `SUPABASE_URL`
   - `service_role` (secret) 키 → `SUPABASE_KEY` — **anon/public 키가 아님**
4. 로컬에서 초기 데이터 삽입 (한 번만):
   ```bash
   cp .env.example .env    # SUPABASE_URL, SUPABASE_KEY 입력
   npm install
   npm run seed
   ```
   - 시드가 `✓ Supabase 연결 및 테이블 확인 완료`를 출력하면 키/스키마가 정상입니다.
   - 서버 시작 후 사원이 비어 있으면 화면의 「시연 데이터 초기화」 버튼(`POST /api/demo/reset`)도 사원을 시드합니다.

## 2. GitHub Private 저장소

```bash
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```
- 팀원 초대: Settings → Collaborators
- 확인: 파일 목록에 `.env` 가 **없는지** 확인

## 3. Vercel 배포

`vercel.json` + `api/app.js` 로 **화면(`public/`)은 CDN, Express API는 서버리스 함수 1개**로 배포됩니다.

```
/        → public/index.html (CDN 정적)
/api/*   → vercel.json rewrites → api/app.js → lib/handler.js → server.js (Express)
```

**필수 환경변수** (Project → Settings → Environment Variables, Production·Preview 모두)

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_KEY` | Supabase **service_role** 키 |
| `SESSION_SECRET` | (선택) 로그인 세션 서명 키. 비우면 `SUPABASE_KEY` 에서 파생되어 별도 설정이 필요 없음 |
| `RESEND_API_KEY` / `SENDER_EMAIL` / `REMINDER_TEST_RECIPIENTS` | 제출 요청 이메일용(선택). 없으면 [제출 요청] 버튼이 안내 오류만 표시. 수신 주소는 시연용 1~3개(무료 플랜은 가입 이메일만 가능) |
| `APP_URL` | 메일 버튼이 여는 Vercel 배포 주소(선택, 비우면 자동) |

환경변수를 추가/변경한 뒤에는 **재배포(Redeploy)** 해야 반영됩니다. Framework Preset 은 **Other**, Node 버전은 `package.json` 의 `engines`(24.x)를 따릅니다.

**Vercel 특성 (이 저장소에서 확인된 사항)**
- Hobby 플랜은 배포당 **함수 12개 한도**입니다. `api/` 아래 파일 1개 = 함수 1개이므로 진단용 파일을 늘리지 마세요.
- 진입점은 **Node http 서버 스타일**(`http.createServer(handler).listen(0)`)입니다. 함수 export 에 `listen` 속성을 다는 방식은 응답 없이 멈추는 문제가 있었고, 일반 함수로 export 하면 Vercel 헬퍼가 요청 본문을 먼저 소비해 JSON/multipart 요청이 깨집니다.
- 요청 본문은 **4.5MB 제한**이 있습니다. 더 큰 파일은 413 이 납니다.
- 화면 HTML 은 CDN 이 직접 서빙하므로 로그인 없이 열립니다(데이터 없음). 로그인하지 않았으면 화면이 `/login` 으로 이동하고, **데이터는 `/api` 의 세션 검사(401)로 보호**됩니다. 브라우저 기본 로그인 팝업은 뜨지 않습니다.

**배포 후 확인**
1. `https://<사이트>/api/health` → `{"ok":true,...}` (암호 없이 열림)
2. 관리자(기획조정실/인사총무팀)로 로그인한 브라우저에서 `https://<사이트>/api/_boot?step=info` → `SESSION_KEY/SUPABASE_URL/SUPABASE_KEY` 가 모두 `true` 인지 (값은 표시되지 않음)
3. `https://<사이트>/api/_boot?step=supabase` → 테이블 5개가 모두 `ok` 인지
4. 화면 접속 → 직원 모드에 업무가 보이는지

오류별 원인
| 응답 | 원인 |
|---|---|
| 500 `세션 서명 키가 없어...` | `SUPABASE_KEY`(또는 `SESSION_SECRET`) 환경변수 누락 (설정 후 재배포) |
| 503 `SUPABASE_URL / SUPABASE_KEY 환경변수가 설정되지 않았습니다` | Supabase 환경변수 누락 |
| 503 `DB 테이블을 찾을 수 없습니다... schema.sql` | SQL Editor 에서 스키마 미실행 |
| 500 `DB 오류(...): Invalid API key` / `permission denied` | 키가 틀렸거나 anon 키를 넣음 → service_role 키 사용 |
| 404 `사원 DB가 비어 있습니다` | `npm run seed` 미실행 |

## 4. Render 배포 (대안)

1. https://render.com → **New → Blueprint** → 저장소 선택 → `render.yaml` 적용
2. Environment 탭에서 `SUPABASE_URL`, `SUPABASE_KEY` 를 직접 입력 (`SESSION_SECRET` 은 자동 생성됨)
3. Render 무료 플랜은 15분 유휴 후 잠들고 깨어나는 데 30~60초 걸립니다. 데이터는 Supabase 에 있어 유지됩니다.

## 5. 로컬 실행

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```
