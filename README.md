# GBSA 지능형 통합 업무 리마인더 — 백엔드 + 2단계 OCR 연동 가이드

## 3단계: 직원 ↔ 관리자 양방향 연동 (employees.xlsx 기반)

**데이터 모델**: `requests`(제출요청 1건) 1 ── N `tasks`(사원별 업무 1행, `emp_no`/`emp_dept` 포함). 사원·부서 목록은 `employees.xlsx`(사번·사원명·부서명)에서 읽고, 파일을 고치면 서버 재시작 없이 반영됩니다.
직원 화면은 로그인 사원의 행만, 관리자 화면은 전체 행을 집계합니다.

| 방향 | 동작 | API |
|---|---|---|
| 직원 → 관리자 | [제출완료] / 수료증 OCR 업로드 → 해당 사원 행이 `done` → 관리자 부서별 제출률·사원별 표에 즉시 반영 | `POST /api/tasks/:id/submit`, `POST /api/tasks/cert-upload` (`empNo`) |
| 관리자 → 직원 | 부서 선택 + 업무명 + 마감일 → 해당 부서 사원 전원에게 업무 행 생성 → 직원 목록에 NEW 표시 | `POST /api/tasks/bulk` `{tasks:[{title,cat,due,targetDept('전체'\|부서명),dept?}]}` |
| 조회 | 사원 체크리스트 / 관리자 집계 / 사원별 현황 | `GET /api/tasks?empNo=`, `GET /api/admin/overview`, `GET /api/admin/employees?dept=&status=&q=&requestId=&page=`, `GET /api/admin/departments` |
| 기타 | 로그인 사원, 시연 초기화 | `GET /api/me`, `POST /api/demo/reset` |

- **로그인 사원**: 엑셀에 `홍길동`이 있으면 홍길동, 없으면 바이오센터 첫 사원. `DEMO_USER_EMPNO=GBSA2026001 node server.js` 로 지정 가능. 화면 우측 상단 드롭다운으로 사원을 바꿔 볼 수 있습니다.
- **초기 시드**: 4건의 전 직원 대상 요청 + 로그인 사원 개별 소명서 1건. 마감일은 실행일 기준 상대값이라 언제든 긴급/주의/기한초과가 보입니다. **로그인 사원 외 사원의 초기 제출 이력은 시연용 시뮬레이션 데이터**입니다.
- 이전 구조(사원 구분 없는 공용 업무)의 DB가 있으면 시작 시 `data/gbsa.legacy-*.db`로 백업 후 새 구조로 초기화됩니다.
- 관리자 집계 기준: 미제출 사원 = 미제출 업무가 1건 이상인 사원 수 / 기한 초과 = 마감이 지난 미제출 (사원×업무) 건수.

## 실행

```bash
npm install
node server.js        # http://localhost:4000  (프론트 + API 한 서버)
```

- Node.js 22.5+ 필요 (내장 `node:sqlite` 사용, 네이티브 빌드 없음). DB 파일: `data/gbsa.db` (첫 실행 시 자동 생성·시드)
- **OCR(Tesseract.js)과 PDF 변환(pdf.js)은 CDN에서 로드**하므로 시연 PC가 인터넷에 연결되어 있어야 합니다.
  한국어 언어 데이터(약 10MB+)는 첫 OCR 때 한 번 내려받고 이후 브라우저에 캐시됩니다 → **시연 전에 샘플 버튼을 한 번 눌러 미리 워밍업**하세요.

## 2단계 파이프라인 (수료증 업로드 → 자동 제출)

```
[브라우저]                                              [서버]
 파일(이미지/PDF) ─▶ ① 파일 읽기
   PDF: pdf.js로 텍스트 레이어 추출(있으면 OCR 생략) / 스캔본이면 캔버스 렌더
 ─▶ ② Tesseract.js OCR (kor+eng)
 ─▶ ③ 정규식/키워드 추출: 교육명 · 발급기관 · 이수일자(YYYY-MM-DD)
 ─▶ ④ POST /api/tasks/cert-upload (multipart) ───────▶ 미제출 교육 업무와 매칭
                                                       → tasks.status='done'
                                                       → submissions 에 OCR 결과 저장
 ◀── 제출 완료된 업무 + 매칭 방식 ◀────────────────────
 ─▶ 카드/통계/AI 매니저 메시지 갱신
```

### `POST /api/tasks/cert-upload` (multipart/form-data)

| 필드 | 설명 |
|---|---|
| `file` | 수료증 원본 (선택) |
| `courseName` / `issuer` / `completedDate` | 프론트가 추출한 값 (선택, 날짜는 `YYYY-MM-DD`) |
| `ocrText` | OCR 원문 (매칭 정확도용, 선택) |
| `fileName` | 파일이 없을 때 파일명 (선택) |
| `taskId` | 수동 지정 시 해당 업무로 강제 매칭 (선택) |

`file`, `courseName`, `ocrText` 중 하나는 필요합니다.

**응답**
- `200` `{ matchedTask, matchedBy, score, cert, fileName }` — `matchedBy`: `keyword`(키워드 매칭) · `only-pending`(대기 교육 업무가 1건뿐) · `manual-select`(taskId 지정)
- `422` `{ error, candidates:[{id,title,due}], cert }` — 자동으로 특정 불가. 프론트가 후보 버튼을 보여주고 선택한 `taskId`로 재호출
- `404` — 제출 대기 중인 교육 업무 없음 / `400` — 입력 없음

**매칭 로직** (`lib/certMatch.js`): 교육명+OCR 원문+파일명을 공백 제거 후, 업무 제목의 주제어(정보보안·개인정보·청렴·성희롱 등)가 겹치는 개수로 점수화. 최고점이 유일하면 자동 매칭.
잘못된 업무를 조용히 완료 처리하지 않도록, 점수가 없고 대기 업무가 여러 건이면 자동 처리하지 않고 사용자에게 선택을 요청합니다.

### 그 외 API 변경
- `POST /api/tasks/:id/submit` — 동일한 수료증 필드(`courseName`, `issuer`, `completedDate`, `ocrText`)를 선택적으로 함께 저장
- `GET /api/tasks` — 제출 완료 업무에 `cert`(교육명·발급기관·이수일자·매칭방식) 포함 → 카드에 표시
- `POST /api/demo/reset` — 업무·제출 이력을 초기 시드로 되돌림 (화면의 "시연 데이터 초기화" 버튼)
- DB: `submissions`에 `course_name, issuer, completed_date, ocr_text, match_method` 컬럼 추가 (기존 DB는 자동 마이그레이션)

## 시연 모드 (「▶ 시연용 샘플 수료증 자동 입력」)

AI 매니저 영역과 수료증 패널 두 곳에 버튼이 있습니다. 클릭하면:
1. 샘플 수료증 이미지를 캔버스로 생성해 미리보기에 표시
2. **실제 Tesseract.js OCR 실행** (스캔 애니메이션 + 진행률)
3. 교육명 → 발급기관 → 이수일자가 하나씩 채워짐
4. 서버 매칭 → 「2026년 하반기 정보보안 교육 이수증 제출」 카드가 제출완료로 바뀌며 강조, AI 매니저가 결과 안내

인터넷/OCR 엔진을 쓸 수 없거나 35초 안에 끝나지 않으면 **내장 샘플 텍스트로 자동 폴백**하며, 화면과 채팅에 "내장 샘플 텍스트로 시연 중"이라고 명시합니다(실제 OCR인 것처럼 보이지 않음).
이미 제출된 뒤에는 「↺ 시연 데이터 초기화」로 처음 상태로 되돌린 뒤 다시 시연하세요.

## 알려진 한계
- OCR 정확도는 이미지 품질에 좌우됩니다 (테스트에서 영문+한글 혼합 "ICT안전팀"이 "ICT El"로 오인식된 적 있음). 필드가 일부 비어도 키워드/원문으로 매칭을 시도하며, 모호하면 후보 선택으로 넘어갑니다.
- 라벨(`교육명:` 등)이 있는 수료증에 가장 잘 동작하고, 라벨이 없는 서식은 보조 규칙(주제어·기관명 접미사)으로 추정합니다.
- 관리자 화면의 공문 업로드도 이미지/PDF는 같은 브라우저 OCR을 사용합니다.
