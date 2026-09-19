# 배포 가이드 (GitHub Private + Render 무료)

팀원 5~6명이 언제든 접속해 테스트하는 용도입니다. **권장 구성: Render 1개 서비스** (Express가 API와 화면을 함께 서빙).
Vercel에도 배포할 수 있지만 서버리스 특성상 **데이터가 휘발되고 인스턴스마다 갈라질 수 있어** 공유 시연에는 Render를 권장합니다 (아래 Vercel 배포 섹션 참고).

## 0. 보안 요약 (먼저 읽기)

| 위험 | 대응 |
|---|---|
| 저장소가 Private이어도 **배포된 URL은 공개**됨 (이 앱엔 로그인이 없음) | `BASIC_AUTH_PASS` 접근 암호 필수. 운영(`NODE_ENV=production`)에서 암호가 없으면 서버가 **시작을 거부**함 |
| DB/업로드/비밀번호 유출 | `.gitignore`로 `*.db*`, `.env`, `uploads/` 제외 (검증 완료) |
| 사원 명부(`employees.xlsx`)는 **Git에 포함**됨 (Vercel 배포 번들에 필요) | 가상(허구) 명단만 사용하세요. **실제 직원 정보가 들어가면 안 됩니다.** 한 번 커밋되면 이력에 남으므로, 실제 데이터를 넣었다면 파일 삭제만으로는 부족합니다 |
| 명부 파일이 배포에 없을 때 | 가상 사원 200명(홍길동 포함)을 자동 생성해 서비스는 유지 |
| 검색엔진 노출 / CORS | `X-Robots-Tag: noindex`, CORS 기본 비활성 |

- 암호는 **저장소·채팅·이슈에 적지 말고** 팀원에게 개별 메신저로 전달하세요. 유출 시 Render 대시보드에서 값을 바꾸면 즉시 무효화됩니다.
- 이미 커밋된 뒤에 비밀이 발견되면 파일 삭제만으로는 부족합니다(이력에 남음). 즉시 해당 비밀을 폐기·교체하세요.
- 알려진 위험(수용): `xlsx@0.18.5`에 공개된 취약점(Prototype Pollution/ReDoS)이 있고 npm에는 수정본이 없습니다. 서버가 **직접 관리하는 명부 파일만** 읽고 사용자 업로드 엑셀은 파싱하지 않으므로 현재 구조에서는 악용 경로가 없습니다. 사용자 업로드 엑셀을 받게 되면 교체가 필요합니다.

## 1. GitHub Private 저장소에 올리기

로컬에는 이미 커밋이 만들어져 있습니다(저장소 루트 = `gbsa-backend`). 원격만 연결하면 됩니다.

**방법 A — 웹에서 만들고 연결**
1. GitHub → New repository → 이름 `gbsa-reminder`, **Private** 선택, README/.gitignore 추가 **체크 해제** → Create
2. 터미널에서:
```bash
cd gbsa-backend
git remote add origin https://github.com/<계정또는조직>/gbsa-reminder.git
git push -u origin main
```
처음 푸시할 때 Windows 자격 증명 창이 뜨면 브라우저로 GitHub 로그인하면 됩니다. (비밀번호/토큰을 명령어나 파일에 직접 적지 마세요.)

**방법 B — GitHub CLI**
```bash
gh auth login
cd gbsa-backend
gh repo create gbsa-reminder --private --source . --remote origin --push
```

3. 팀원 초대: 저장소 → Settings → Collaborators → Add people
4. 확인: 저장소 페이지에 **Private** 배지가 보이는지, 파일 목록에 `.env`·`data/`가 **없는지** 확인 (`employees.xlsx`는 있어야 정상)

## 2. Render 배포 (무료)

1. https://render.com 가입 → Dashboard → **New → Blueprint**
2. GitHub 연결 시 Private 저장소 접근을 허용하고 `gbsa-reminder` 선택 → `render.yaml`이 자동 인식됨 → **Apply**
3. 배포가 끝나면 `https://gbsa-reminder-xxxx.onrender.com` 주소가 생깁니다.
4. 접근 암호 확인: 서비스 → **Environment** → `BASIC_AUTH_PASS` (Render가 랜덤 생성). 아이디는 `gbsa`. 팀원에게 개별 전달.
5. 접속 시 브라우저가 아이디/암호를 물어봅니다.

무료 플랜 특성 (팀에 미리 공유):
- **15분간 접속이 없으면 잠들고**, 다음 접속 때 깨어나는 데 약 30~60초 걸립니다.
- 디스크가 **임시**라서 재시작/재배포/잠들었다 깨어날 때 **DB와 업로드가 초기화**되고 초기 시드가 다시 생성됩니다. (제출 이력이 사라질 수 있음 → 시연 전에 화면의 「시연 데이터 초기화」를 쓰는 용도로 생각하세요.) 영구 보관이 필요하면 유료 플랜의 Disk를 붙이고 `DATA_DIR`을 그 경로로 지정하세요.
- 5~6명이 동시에 제출/발송을 눌러도 동작하지만, 모두 **같은 데이터**를 봅니다. 관리자 화면에서 시연 초기화를 누르면 모두의 데이터가 초기화됩니다.

## Vercel 배포 (Express API + 화면 통합)

`vercel.json` + `api/index.js`로 **화면(`public/`)은 CDN, Express API는 서버리스 함수 1개**로 배포됩니다.

```
/        → public/index.html (CDN 정적)
/api/*   → vercel.json rewrites → api/index.js → server.js (Express 앱을 export)
```

**필수 환경변수** (Project → Settings → Environment Variables, Production·Preview 모두)

| 이름 | 값 | 비고 |
|---|---|---|
| `BASIC_AUTH_PASS` | 긴 랜덤 문자열 | **없으면 함수가 기동을 거부**해 `/api`가 500 (Vercel은 `NODE_ENV=production`) |
| `BASIC_AUTH_USER` | `gbsa` | 선택 (기본값 gbsa) |

Framework Preset은 **Other**, Build/Output 설정은 `vercel.json`이 지정하므로 건드리지 않습니다. Node 버전은 `package.json`의 `engines`(24.x)를 따르며 Project Settings의 Node.js Version도 24.x여야 합니다(`node:sqlite` 사용).

**Vercel(서버리스)의 구조적 한계 — 팀에 미리 공유**
- **DB·업로드는 `/tmp`(휘발성)**: 함수 인스턴스가 새로 뜰 때마다(콜드 스타트, 유휴 후, 재배포) 초기 시드가 **다시 생성되어 제출 이력이 사라집니다.** 사원명부(`employees.xlsx`)는 읽기 전용으로 배포 번들(`vercel.json`의 `includeFiles`)에서 `process.cwd()` 기준으로 읽습니다.
- **인스턴스별로 DB가 따로**일 수 있음: 요청이 서로 다른 인스턴스로 가면 "직원 화면에서 제출했는데 관리자 화면에 안 보임"이 생길 수 있습니다. 5~6명이 **같은 데이터를 봐야 하는 시연이면 Render를 쓰세요.** (근본 해결은 Turso/Vercel Postgres 같은 외부 DB로 교체)
- **요청 본문 4.5MB 제한**: 이보다 큰 수료증 파일은 업로드 시 413 오류가 납니다.
- 화면 HTML은 CDN이 직접 서빙하므로 암호 없이 열립니다(데이터 없음). **암호는 `/api`에만** 걸리며, 처음 API를 호출할 때 브라우저가 아이디/암호를 묻습니다.
- 시간대는 서버에서 `Asia/Seoul`로 고정합니다(Vercel은 UTC라 한국 새벽에 D-day가 하루 어긋나는 것을 방지).

**배포 후 확인**: `https://<프로젝트>.vercel.app/api/health` → `{"ok":true,...}` (암호 없이 열림), `/api/employees` → 암호창 → 200명. 500이면 Vercel → Deployments → Functions 로그를 확인하세요(대부분 `BASIC_AUTH_PASS` 누락).

## 3. 로컬 실행

```bash
npm install
cp .env.example .env      # 필요 시 BASIC_AUTH_PASS 등 입력
npm run dev               # .env 자동 로드, employees.xlsx 없으면 가상 명부 자동 생성
```

환경변수는 `.env.example` 참고. `PORT`는 `process.env.PORT || 4000`로 호스팅이 주입하는 값을 그대로 씁니다.
