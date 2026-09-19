# 배포 가이드 (GitHub Private + Render 무료)

팀원 5~6명이 언제든 접속해 테스트하는 용도입니다. **권장 구성: Render 1개 서비스** (Express가 API와 화면을 함께 서빙).
Vercel은 선택 사항이며, 아래 [Vercel을 꼭 써야 할 때](#vercel을-꼭-써야-할-때)를 먼저 읽으세요.

## 0. 보안 요약 (먼저 읽기)

| 위험 | 대응 |
|---|---|
| 저장소가 Private이어도 **배포된 URL은 공개**됨 (이 앱엔 로그인이 없음) | `BASIC_AUTH_PASS` 접근 암호 필수. 운영(`NODE_ENV=production`)에서 암호가 없으면 서버가 **시작을 거부**함 |
| 사원 명부/DB/업로드/비밀번호 유출 | `.gitignore`로 `employees.xlsx`, `*.db*`, `.env`, `uploads/` 제외 (검증 완료) |
| 클라우드에 사원 명부가 없음 | 가상 사원 200명(홍길동 포함)을 첫 실행 시 자동 생성. **실제 사원 데이터는 올리지 마세요** |
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
4. 확인: 저장소 페이지에 **Private** 배지가 보이는지, 파일 목록에 `employees.xlsx`·`.env`·`data/`가 **없는지** 확인

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

## Vercel을 꼭 써야 할 때

Vercel은 서버리스라 **파일 시스템이 읽기 전용/휘발성**이어서 이 앱의 SQLite·업로드 저장 백엔드를 그대로 올릴 수 없습니다. 그래서 `vercel.json`은 **정적 화면(`public/`)만 서빙하고 `/api/*`를 Render로 프록시**하도록 만들었습니다. (Vercel에서는 직접 검증하지 못했습니다.)

1. 위 Render 배포를 먼저 끝내고 주소를 확인
2. `vercel.json`의 `REPLACE-WITH-YOUR-SERVICE.onrender.com`을 실제 Render 주소로 교체 → 커밋/푸시
3. Vercel → Add New Project → 저장소 Import → Framework Preset **Other**, 빌드 설정은 비워둠 → Deploy
4. 화면 HTML은 Vercel 주소에서 누구나 열 수 있지만(데이터 없음), 데이터를 부르는 `/api` 호출은 Render의 암호 인증을 거칩니다. 첫 API 호출 때 브라우저가 암호를 물을 수 있습니다.

팀 테스트만 목적이면 **Render 주소 하나만 쓰는 것을 권장**합니다(구성 단순, 암호 프롬프트 1회).

## 3. 로컬 실행

```bash
npm install
cp .env.example .env      # 필요 시 BASIC_AUTH_PASS 등 입력
npm run dev               # .env 자동 로드, employees.xlsx 없으면 가상 명부 자동 생성
```

환경변수는 `.env.example` 참고. `PORT`는 `process.env.PORT || 4000`로 호스팅이 주입하는 값을 그대로 씁니다.
