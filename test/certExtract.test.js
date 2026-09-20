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

test('verifyName: 성명 라벨이 있으면 그 값이 절대적이고, 없을 때만 원문 속 본인 이름으로 보완한다', () => {
  // 라벨상 성명이 타인이면 원문 다른 곳에 본인 이름이 있어도 불일치
  assert.equal(C.verifyName('신소율', { text: '성명 : 강하율\n담당자 : 신소율' }).status, 'mismatch');
  // 라벨 없이 본인 이름이 원문에 있으면 확인(라벨 OCR 실패 대비), 다른 사람 이름만 있으면 미확인
  const viaText = C.verifyName('신소율', { text: '수료증\n2026년 정보보안 교육\n신소율 귀하' });
  assert.deepEqual([viaText.status, viaText.source], ['match', 'text']);
  assert.equal(C.verifyName('신소율', { text: '수료증\n강하율 귀하' }).status, 'unverified');
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
