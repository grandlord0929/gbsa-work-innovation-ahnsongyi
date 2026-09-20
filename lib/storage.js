// 수료증 원본 이미지 보관 (Supabase Storage, 비공개 버킷). 관리자 확인 화면에서만 서버를 통해 열람한다.
const { getSupabase, httpError } = require('./supabaseClient');

const BUCKET = 'cert-uploads';
let ready = false;

async function ensureBucket() {
  if (ready) return;
  const { error } = await getSupabase().storage.createBucket(BUCKET, { public: false, fileSizeLimit: 15 * 1024 * 1024 });
  // 이미 있으면 정상(409 / "already exists")
  if (error && !/already exists|duplicate|409/i.test(`${error.message} ${error.statusCode || ''} ${error.status || ''}`)) {
    throw httpError(500, `수료증 이미지 저장소(Storage) 준비 실패: ${error.message}`);
  }
  ready = true;
}

async function saveCertFile(path, buffer, contentType) {
  await ensureBucket();
  let { error } = await getSupabase().storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
  if (error && /bucket not found/i.test(error.message)) { // 버킷이 삭제된 경우 다시 만들고 한 번 재시도
    ready = false; await ensureBucket();
    ({ error } = await getSupabase().storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false }));
  }
  if (error) throw httpError(500, `수료증 이미지 저장 실패: ${error.message}`);
  return path;
}

async function readCertFile(path) {
  const { data, error } = await getSupabase().storage.from(BUCKET).download(path);
  if (error || !data) throw httpError(404, '수료증 이미지를 찾을 수 없습니다.');
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { saveCertFile, readCertFile, BUCKET };
