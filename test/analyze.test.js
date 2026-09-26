// 공문(OCR) 파서: 업무명/마감일/분류 추출 (DB 불필요)
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, extractTitle, extractDue, classify } = require('../lib/analyze');

test('업무명: 요구자료명 뒤 콜론 다음 내용 (문서 제목/첫 줄은 사용 안 함)', () => {
  const doc = '기획조정실\n수신 각 부서장\n제목 2026년도 행정사무감사 자료 요구 알림\n1. 요구내용\n가. 요구자료명 : 2026년도 행정사무감사 사전 제출 요구자료\n* 나. 제출기한 : 2026년 9월 27일(일) 18:00까지';
  assert.equal(extractTitle(doc), '2026년도 행정사무감사 사전 제출 요구자료');
  assert.equal(analyze(doc).title, '2026년도 행정사무감사 사전 제출 요구자료');
});

test('업무명: 과정명/교육명/요구사항/요청사항 및 콜론 없이 공백만 있는 경우, 우선순위는 구체 명칭 순', () => {
  assert.equal(extractTitle('과정명: 2026 청렴교육'), '2026 청렴교육');
  assert.equal(extractTitle('교육명 2026 직무역량 강화 과정'), '2026 직무역량 강화 과정');
  assert.equal(extractTitle('요구사항 : 통계 자료 제출'), '통계 자료 제출');
  assert.equal(extractTitle('요청사항：예산 집행 실적'), '예산 집행 실적');
  assert.equal(extractTitle('요구사항: 별지 참조\n요구자료명: 성과지표 실적'), '성과지표 실적');            // 요구자료명이 우선
  assert.equal(extractTitle('※ 교육명 : “정보보안 교육”'), '정보보안 교육');                             // 따옴표 제거
});

test('업무명: 키워드가 없으면 빈 값(제목/첫 줄 폴백 폐지), 다른 낱말 속 키워드는 무시, OCR 공백/오인식 허용', () => {
  assert.equal(extractTitle('제목: 옛 방식 제목\n업무명: 옛 업무명\n첫 줄 문서'), '');
  assert.equal(extractTitle('수료교육명: 무시됨'), '');
  assert.equal(extractTitle('요 구 자 료 명 ; 2026년 성과지표'), '2026년 성과지표');
});

test('마감일: 제출기한/제출 기한/마감일/마감 일자/기한 뒤 날짜만, YYYY-MM-DD 로 변환', () => {
  assert.equal(extractDue('* 나. 제출기한 : 2026년 9월 27일(일) 18:00까지'), '2026-09-27');
  assert.equal(extractDue('제출 기한: 2026-10-05'), '2026-10-05');
  assert.equal(extractDue('마감일 : 2026. 10. 2.'), '2026-10-02');
  assert.equal(extractDue('마감 일자: 2026년 11월 3일'), '2026-11-03');
  assert.equal(extractDue('기한 2026/12/31 까지'), '2026-12-31');
});

test('마감일: 시행일자/작성일자 등 키워드 없는 날짜는 무시, 잘못된 날짜는 건너뜀', () => {
  assert.equal(extractDue('시행일자 2026. 9. 1.\n작성일자 2026-08-30\n문서 2026년 9월 2일'), '');
  assert.equal(extractDue('시행일자 2026. 9. 1.\n제출기한 : 2026년 9월 27일'), '2026-09-27');
  assert.equal(extractDue('마감일: 2026년 2월 31일\n기한 2026.11.3'), '2026-11-03');   // 2/31 은 무효 → 다음 키워드
  assert.equal(extractDue('기한 내 제출'), '');
});

test('분류: 교육/수료증/이수 포함이면 교육 수료증 제출(edu), 그 외 요구자료 제출(doc)', () => {
  assert.equal(classify('2026 정보보안 교육 수료증 제출'), 'edu');
  assert.equal(classify('법정의무교육 이수 현황'), 'edu');
  assert.equal(classify('행정사무감사 사전 제출 요구자료'), 'doc');
  assert.equal(classify('출퇴근 복무 소명'), 'doc');    // 복무 누락 소명은 사용자가 직접 선택
});

test('analyze: 요청부서는 본문이 아니라 전달받은 로그인 관리자 부서', () => {
  const r = analyze('요청부서: ICT안전팀\n요구자료명: 성과지표\n제출기한: 2026-09-30', { dept: '기획조정실' });
  assert.deepEqual([r.title, r.due, r.dept, r.cat], ['성과지표', '2026-09-30', '기획조정실', 'doc']);
  assert.equal(analyze('아무 내용').dept, '');
});
