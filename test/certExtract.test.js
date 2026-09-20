// 수료증 파서/성명 검증 단위 테스트 (브라우저와 서버가 공유하는 public/certExtract.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/certExtract');

const LONG = '2026년 하반기 개인정보보호 및 정보보안 교육';

test('줄바꿈된 긴 교육명 (2줄)을 하나로 합치고 공백을 정규화한다', () => {
  const f = C.extractCert(`수료증\n교육명 : 2026년 하반기 개인정보보호 및 정보\n보안 교육\n발급기관 : 경기도경제과학진흥원\n이수일자 : 2026년 9월 18일\n성명 : 강하율`);
  assert.equal(f.courseName, '2026년 하반기 개인정보보호 및 정보 보안 교육');
  assert.equal(f.issuer, '경기도경제과학진흥원');
  assert.equal(f.completedDate, '2026-09-18');
  assert.equal(f.certName, '강하율');
});

test('사용자 예시 교육명이 어느 지점에서 줄바꿈돼도 (공백 정규화 후) 원문과 같은 글자열로 복원된다', () => {
  const words = LONG.split(' ');
  for (let cut = 1; cut < words.length; cut++) {
    const l1 = words.slice(0, cut).join(' '); const l2 = words.slice(cut).join(' ');
    const got = C.extractCourseName(`교육명 : ${l1}\n${l2}\n발급기관 : 경기도경제과학진흥원`);
    assert.equal(got, LONG, `cut=${cut}`);
  }
  // 단어 중간에서 끊긴 경우: 공백이 하나 생기지만 글자는 그대로 (비교는 공백 무시)
  const mid = C.extractCourseName('교육명 : 2026년 하반기 개인정보보호 및 정보\n보안 교육\n성명 : 홍길동');
  assert.equal(mid.replace(/\s/g, ''), LONG.replace(/\s/g, ''));
});

test('3줄로 줄바꿈된 교육명, 종결어(교육/과정)에서 멈춘다', () => {
  const got = C.extractCourseName('교육과정 : 2026년 하반기 직무역량 강화를 위한\n개인정보보호 및 정보보안\n실무 교육\n경기도경제과학진흥원\n성명: 홍길동');
  assert.equal(got, '2026년 하반기 직무역량 강화를 위한 개인정보보호 및 정보보안 실무 교육');
});

test('값이 라벨 다음 줄에서 시작해도 읽는다 (연도로 시작하는 교육명 포함)', () => {
  assert.equal(C.extractCourseName(`교육과정 :\n${LONG}\n발급기관 : 경기도경제과학진흥원`), LONG);
  assert.equal(C.extractCourseName(`교육명\n${LONG}\n성명 : 홍길동`), LONG);
});

test('빈 줄, 다음 항목 라벨, "위 사람은…" 문장, 날짜 줄, 기관명 줄에서 교육명이 끝난다', () => {
  assert.equal(C.extractCourseName('교육명 : 2026년 정보보안 실무 과정\n\n이수일자 : 2026.09.18'), '2026년 정보보안 실무 과정');
  assert.equal(C.extractCourseName('교육명 : 2026년 정보보안 교육\n위 사람은 위 교육과정을 성실히 이수하였기에'), '2026년 정보보안 교육');
  assert.equal(C.extractCourseName('교육명 : 2026년 정보보안 실무\n2026년 9월 18일'), '2026년 정보보안 실무');
  assert.equal(C.extractCourseName('교육명 : 2026년 정보보안 실무\n경기도경제과학진흥원\n성명 : 홍길동'), '2026년 정보보안 실무'); // 종결어 없어도 기관명 줄은 제외
  assert.equal(C.extractCourseName('교육명 : 2026년 정보보안 교육\n경기도경제과학진흥원'), '2026년 정보보안 교육');
});

test('"위 교육과정을" 같은 문장 속 단어를 라벨로 오인하지 않는다', () => {
  assert.equal(C.extractCourseName('위 사람은 위 교육과정을 성실히 이수하였기에 이 증서를 수여합니다.'), '');
});

test('띄어쓰기/콜론 변형, 라벨 없는 수료증 (기존 동작 유지)', () => {
  const spaced = C.extractCert('수 료 증\n교 육 명 : 2026년 하반기 정보 보안 교육\n발 급 기 관 : 경기도경제과학진흥원 ICT안전팀\n이 수 일 자 : 2026. 9. 18.\n성 명 : 홍길동');
  assert.deepEqual([spaced.courseName, spaced.issuer, spaced.completedDate, spaced.certName], ['2026년 하반기 정보 보안 교육', '경기도경제과학진흥원 ICT안전팀', '2026-09-18', '홍길동']);
  const nocolon = C.extractCert('수료증\n교육명 2026년 법정 필수 개인정보보호 교육\n발급기관 한국인터넷진흥원\n교육기간 2026.09.01 ~ 2026.09.05\n위 사람은 위 교육과정을 성실히 이수하였기에');
  assert.deepEqual([nocolon.courseName, nocolon.issuer, nocolon.completedDate], ['2026년 법정 필수 개인정보보호 교육', '한국인터넷진흥원', '2026-09-05']);
  const nolabel = C.extractCert('수료증\n2026년 청렴 교육 과정\n위 사람은 위 교육과정을 성실히 이수하였기에 수여합니다\n2026년 9월 10일\n경기도인재개발원 원장 김철수');
  assert.deepEqual([nolabel.courseName, nolabel.issuer, nolabel.completedDate], ['2026년 청렴 교육 과정', '경기도인재개발원', '2026-09-10']);
});

test('성명 추출: 성명/수료자/이름/위 사람 형태', () => {
  const n = (t) => C.extractName(t);
  assert.deepEqual(n('성명 : 강하율'), { name: '강하율', source: 'label' });
  assert.equal(n('성 명 : 신 소 율').name, '신소율');
  assert.equal(n('수료자: 홍길동 (洪吉童)').name, '홍길동');
  assert.equal(n('이름 김철수').name, '김철수');
  assert.equal(n('성명 : 강하율 소속 : 바이오센터').name, '강하율');
  assert.equal(n('성명 : 강하율소속').name, '강하율');
  assert.equal(n('성명 :\n강하율\n소속 : 바이오센터').name, '강하율');
  assert.equal(n('성명：남궁민수').name, '남궁민수');
  assert.deepEqual(n('위 사람 강하율은 위 교육과정을 성실히 이수하였기에'), { name: '강하율', source: 'sentence' });
  assert.equal(n('위 사람 강하율 은 위 교육과정을').name, '강하율');
});

test('성명이 없거나 문장뿐이면 빈 값 (오인식 방지)', () => {
  assert.equal(C.extractName('수료증\n교육명 : 정보보안 교육\n위 사람은 위 교육과정을 성실히 이수하였기에').name, '');
  assert.equal(C.extractName('성명 :').name, '');
  assert.equal(C.extractName('성명 : 소속 바이오센터').name, '');
});

test('verifyName: 일치/불일치/미확인, 공백 무시, 한 글자 차이는 OCR 오인식 힌트', () => {
  const ok = C.verifyName('신소율', { text: '성명 : 신 소 율' });
  assert.deepEqual([ok.status, ok.isNameMatched, ok.matchedName], ['match', true, '신소율']);

  const bad = C.verifyName('신소율', { text: '성명 : 강하율' });
  assert.deepEqual([bad.status, bad.isNameMatched, bad.matchedName, bad.similar], ['mismatch', false, '강하율', false]);
  assert.equal(C.nameMessage(bad), "⚠️ 제출자 성명('신소율')과 수료증 상 성명('강하율')이 일치하지 않습니다.");

  const sim = C.verifyName('신소율', { text: '성명 : 신소울' });
  assert.equal(sim.status, 'mismatch'); assert.equal(sim.similar, true);
  assert.match(C.nameMessage(sim), /OCR 오인식/);

  const none = C.verifyName('신소율', { text: '교육명 : 정보보안 교육' });
  assert.deepEqual([none.status, none.isNameMatched, none.matchedName], ['unverified', false, '']);
  assert.match(C.nameMessage(none), /자동으로 확인하지 못했습니다/);
});

test('verifyName: 라벨 표기와 무관하게 제출자 이름이 원문에 있으면 본인 확인, 이름이 다르면 불일치', () => {
  // 라벨이 "성 명" 이든 "이름" 이든 없든, 본인 이름이 이름으로서 적혀 있으면 일치
  for (const t of ['성      명 : 신소율', '이름 : 신소율', '수료자 신소율', '수료증\n\n신소율\n\n교육과정:', '수료증\n신소율 귀하', '성 명 : 신 소 율']) {
    const v = C.verifyName('신소율', { text: t });
    assert.deepEqual([t, v.status, v.matchedName], [t, 'match', '신소율']);
  }
  // 여러 OCR 패스를 합친 원문에서 한 패스가 라벨 값을 오인식(신소울)해도 다른 패스에서 읽힌 본인 이름을 인정
  assert.equal(C.verifyName('신소율', { text: '성명 : 신소울\n\n신소율' }).status, 'match');
  // 다른 글자에 붙어 있는 경우(이수하였으므로 → 이수)는 이름으로 보지 않는다
  assert.notEqual(C.verifyName('이수', { text: '성실히 이수하였으므로 이수일자 2026년' }).status, 'match');
  assert.equal(C.verifyName('이수', { text: '성명 : 이 수' }).status, 'match');
  // 다른 사람 이름만 있으면 불일치(라벨 값 또는 이름만 홀로 적힌 줄), 이름이 전혀 없으면 미확인
  assert.equal(C.verifyName('신소율', { text: '성명 : 강하율' }).status, 'mismatch');
  assert.equal(C.verifyName('신소율', { text: '수료증\n\n강하율\n\n교육과정:' }).status, 'mismatch');
  assert.equal(C.verifyName('신소율', { text: '수료증\n정보보안 교육' }).status, 'unverified');
  // 호출자가 미리 추출한 성명(certName)을 넘겨도 동일하게 비교
  assert.equal(C.verifyName('신소율', { certName: '강하율', text: '' }).status, 'mismatch');
  assert.equal(C.verifyName('신소율', { certName: '신소율', text: '' }).status, 'match');
});

test('normalizeValue: 개행/연속 공백/OCR 잡음을 단일 공백으로', () => {
  assert.equal(C.normalizeValue('  2026년\n하반기 |  정보보안\r\n교육 : '), '2026년 하반기 정보보안 교육');
});

test('라벨 경로 회귀: 주제어가 없는 교육명도 라벨 다음 줄/날짜·기관명 줄 경계로 정확히 읽는다 (fallback 에 의존하지 않음)', () => {
  assert.equal(C.extractCourseName('교육명 :\n2026년 하반기 직무역량 강화 교육\n성명 : 홍길동'), '2026년 하반기 직무역량 강화 교육');
  assert.equal(C.extractCourseName('교육과정\n2026년 신입직원 온보딩 과정\n발급기관 : 경기도경제과학진흥원'), '2026년 신입직원 온보딩 과정');
  assert.equal(C.extractCourseName('교육명 : 2026년 직무역량 강화\n2026년 9월 18일\n성명 : 홍길동'), '2026년 직무역량 강화');
  assert.equal(C.extractCourseName('교육명 : 2026년 직무역량 강화\n경기도경제과학진흥원 원장\n성명 : 홍길동'), '2026년 직무역량 강화');
});

test('extractCert(text, {expectedName}) 결과 객체에 isNameMatched / matchedName / nameStatus 가 담긴다', () => {
  const ok = C.extractCert('교육명 : 정보보안 교육\n성명 : 신소율', { expectedName: '신소율' });
  assert.deepEqual([ok.isNameMatched, ok.matchedName, ok.nameStatus], [true, '신소율', 'match']);
  const bad = C.extractCert('교육명 : 정보보안 교육\n성명 : 강하율', { expectedName: '신소율' });
  assert.deepEqual([bad.isNameMatched, bad.matchedName, bad.nameStatus], [false, '강하율', 'mismatch']);
  const none = C.extractCert('교육명 : 정보보안 교육', { expectedName: '신소율' });
  assert.deepEqual([none.isNameMatched, none.matchedName, none.nameStatus], [false, '', 'unverified']);
  assert.equal('isNameMatched' in C.extractCert('성명 : 신소율'), false); // expectedName 을 안 주면 검증 필드 없음
});

// 실제 스캔 PDF(2026년 하반기 정보보안 교육 수료증)를 브라우저 OCR 로 읽은 원문: PSM 6 은 굵은 이름 값을 오인식(BUS)하고, PSM 11 이 읽어 낸다
const PSM6 = '제 2026-560-0920호\n수 료 승\n성      명 ： BUS\n교 육 과 정： 2026년 하반기 정보보안 교\n으\n=\n수 료 YX: 20269 09월 20일\n위 사람은 개인정보 보호 및 기업 정보 자산 안전\n관리를 위하여\n실시한 「2026년 하반기 정보보안 교육」과정을\n성실히 이수하였으므로 본 수료증을 수여합니다.\n2026년 09월 20일\n승    흐으\n경기도경제과학진흥원장';
const PSM11 = (n) => `H| 2026-SEC-0920%\n\n수료 증\n\nAM\n\n며\n\n${n}\n\n교육과정:\n\n2026년 하반기 정보보안 교\n\n수료일자:\n\n2026년 09월 20일\n\n위 사람은 개인정보 보호 및 기업 정보 자산 안전`;

test('실제 스캔 수료증: PSM6 만으로는 미확인, PSM11 결과를 합치면 본인 확인 + 잘린 교육명은 본문 인용 문장으로 복원', () => {
  const only6 = C.extractCert(PSM6, { expectedName: '홍길동' });
  assert.equal(only6.nameStatus, 'unverified');
  assert.equal(only6.courseName, '2026년 하반기 정보보안 교육'); // "…정보보안 교" + "으" 가 아니라 「…교육」 문장에서 복원
  assert.equal(only6.issuer, '경기도경제과학진흥원');            // "…진흥원장" 의 직함만 제거
  assert.equal(only6.completedDate, '2026-09-20');
  const both = C.extractCert(PSM6 + '\n\n' + PSM11('홍길동'), { expectedName: '홍길동' });
  assert.deepEqual([both.nameStatus, both.isNameMatched, both.matchedName, both.certName], ['match', true, '홍길동', '홍길동']);
});

test('실제 스캔 수료증: 다른 사람(강하율) 수료증을 신소율이 제출하면 불일치, 같은 사람이면 일치', () => {
  const other = C.extractCert(PSM6 + '\n\n' + PSM11('강하율'), { expectedName: '신소율' });
  assert.deepEqual([other.nameStatus, other.isNameMatched, other.matchedName], ['mismatch', false, '강하율']);
  assert.equal(C.extractCert(PSM11('신소율'), { expectedName: '신소율' }).nameStatus, 'match');
});

test('교육명이 단어 중간(교/육)에서 줄바꿈된 경우 공백 없이 붙이고, 일반 줄바꿈은 공백으로 잇는다', () => {
  assert.equal(C.extractCourseName('교육과정: 2026년 하반기 정보보안 교\n육\n수료일자: 2026년 09월 20일'), '2026년 하반기 정보보안 교육');
  assert.equal(C.extractCourseName('교육명 : 2026년 하반기 정보보안 강화 및 사이버 위협\n대응 실무 교육\n발급기관 : 경기도경제과학진흥원'), '2026년 하반기 정보보안 강화 및 사이버 위협 대응 실무 교육');
});

test('여러 OCR 패스를 합친 원문에서 발급기관은 글자가 덜 빠진(긴) 후보를 고른다', () => {
  const t = '경기도경제과학진흥원장\n\n기도경제과학진흥원장';
  assert.equal(C.extractIssuer(t), '경기도경제과학진흥원');
});
