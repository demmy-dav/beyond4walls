// POST /api/challenge/upload-url: a short-lived signed URL to upload one file
// for the applicant's challenge. Refused before release and after the deadline.
const crypto = require('crypto');
const { send, fail, postJson } = require('../_lib/http');
const { signedUploadUrl } = require('../_lib/supabase');
const { currentApplicant } = require('../_lib/applicant');
const { TYPES, MAX_FILE_BYTES, extOf } = require('../_lib/files');

module.exports = async function handler(req, res) {
  const raw = await postJson(req, res, { limit: { name: 'upload', max: 20, windowMs: 10 * 60 * 1000 } });
  if (!raw) return;

  const ext = extOf(raw.fileName);
  const type = TYPES[ext];
  const size = Number(raw.fileSize);
  if (!type) return fail(res, 422, 'Please upload a PDF, Word document (.doc or .docx), PNG, JPG or text file.');
  if (raw.fileType && raw.fileType !== type.mime) return fail(res, 422, 'That file’s type doesn’t match its name. Please check the file and try again.');
  if (!Number.isInteger(size) || size < 1) return fail(res, 422, 'That file looks empty.');
  if (size > MAX_FILE_BYTES) return fail(res, 422, 'Files can be up to 5 MB. Please make it smaller and try again.');

  try {
    const { user, app, release, submission } = await currentApplicant(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (!app || !release) return fail(res, 403, 'Your challenge hasn’t been released yet.');
    if (Date.now() >= Date.parse(release.due_at)) return fail(res, 403, 'The 72-hour deadline has passed, so submissions are closed.');
    if (submission) return fail(res, 409, 'You’ve already submitted your challenge.');

    const path = `${app.id}/${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await signedUploadUrl(path);
    return send(res, 200, { ok: true, uploadUrl, path, contentType: type.mime });
  } catch (err) {
    console.error('Upload URL failed:', err.message);
    return fail(res, 502, 'We couldn’t prepare your upload just now. Please try again.');
  }
};
