// employees.xlsx 는 Git에 올리지 않는다(.gitignore). 클라우드 배포처럼 파일이 없는 환경에서는
// 가상(허구) 사원 200명 샘플을 자동 생성한다. 이미 파일이 있으면 아무것도 하지 않는다.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const target = process.env.EMPLOYEES_XLSX || path.join(__dirname, '..', 'employees.xlsx');
if (fs.existsSync(target)) {
  console.log(`[employees] 기존 사원 DB 사용: ${target}`);
  process.exit(0);
}

// 시드 고정 난수 → 언제 생성해도 같은 명단
let seed = 20260919;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const family = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const given = ['서윤', '하준', '지유', '도윤', '서연', '시우', '민서', '예준', '하윤', '주원', '지호', '수아', '지안', '건우', '유나', '현우', '채원', '준서', '다은', '은우', '소율', '태민', '나윤', '승현', '아린'];
const depts = [['정책기획팀', 35], ['HRD기획팀', 36], ['감사담당관실', 31], ['바이오센터', 30], ['ICT융합팀', 27], ['경영지원팀', 22], ['총무인사팀', 19]];

const list = depts.flatMap(([d, n]) => Array.from({ length: n }, () => d));
for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }

const rows = list.map((dept, i) => ({
  사번: `GBSA2026${String(i + 1).padStart(3, '0')}`,
  사원명: i === 0 ? '홍길동' : pick(family) + pick(given),
  부서명: i === 0 ? '바이오센터' : dept,
}));
// 홍길동 1명이 바이오센터로 고정되므로 부서 인원수를 원래 분포(바이오센터 30명)에 맞춘다
if (list[0] !== '바이오센터') { const k = list.indexOf('바이오센터', 1); rows[k].부서명 = list[0]; }

const ws = XLSX.utils.json_to_sheet(rows, { header: ['사번', '사원명', '부서명'] });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
fs.mkdirSync(path.dirname(target), { recursive: true });
XLSX.writeFile(wb, target);
console.log(`[employees] employees.xlsx 가 없어 가상 사원 ${rows.length}명 샘플을 생성했습니다: ${target}`);
