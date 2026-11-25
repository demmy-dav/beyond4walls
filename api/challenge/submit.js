// POST /api/challenge/submit: the applicant's final challenge submission (text
// and/or an uploaded file). The 72-hour deadline is checked here against the
// server clock and again by a database trigger, so a wrong browser clock or a
// hand-made request can't get a late submission in.
const { send, fail, clean, postJson } = require('../_lib/http');
const { db, downloadObject, deleteObject } = require('../_lib/supabase');
const { currentApplicant } = require('../_lib/applicant');
const { TYPES, MAX_FILE_BYTES, extOf, safeName } = require('../_lib/files');
const { trySend } = require('../_lib/email');

const MAX_TEXT = 10000;
const DEADLINE_MSG = 'The 72-hour deadline has passed, so submissions are closed.';

module.exports = async function handler(req, res) {
  const raw = await postJson(req, res, { limit: { name: 'submit', max: 10, windowMs: 10 * 60 * 1000 } });
  if (!raw) return;

  const text = clean(raw.text, { multiline: true });
  const filePath = clean(raw.filePath);
  if (!text && !filePath) return fail(res, 422, 'Please write your answer or upload a file.');
  if (text.length > MAX_TEXT) return fail(res, 422, `Please keep your written answer under ${MAX_TEXT.toLocaleString('en')} characters.`);

  try {
    const { user, app, release, submission } = await currentApplicant(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (!app || !release) return fail(res, 403, 'Your challenge hasn’t been released yet.');
    if (Date.now() >= Date.parse(release.due_at)) return fail(res, 403, DEADLINE_MSG, { code: 'deadline_passed' });
    if (submission) return fail(res, 409, 'You’ve already submitted your challenge.');

    let file = {};
    if (filePath) {
      // Only files uploaded into this application's own folder, named by upload-url
      const ext = extOf(filePath);
      const pattern = new RegExp(`^${app.id}/[0-9a-f-]{36}\\.(pdf|docx?|png|jpe?g|txt)$`);
      if (!pattern.test(filePath)) return fail(res, 422, 'Please upload your file again.');
      const object = await downloadObject(filePath);
      if (!object) return fail(res, 422, 'We couldn’t find your uploaded file. Please upload it again.');
      if (object.bytes.length > MAX_FILE_BYTES || !TYPES[ext].check(object.bytes)) {
        await deleteObject(filePath).catch(() => {});
        return fail(res, 422, 'That file doesn’t look like the type its name says. Please upload a PDF, Word document, PNG, JPG or text file.');
      }
      file = {
        file_path: filePath,
        file_name: safeName(raw.fileName || `submission.${ext}`),
        file_type: TYPES[ext].mime,
        file_size: object.bytes.length,
      };
    }

    let saved;
    try {
      [saved] = await db('submissions', 'select=submitted_at', {
        as: 'service', method: 'POST', prefer: 'return=representation',
        body: { application_id: app.id, text: text || null, ...file, locked: true },
      });
    } catch (err) {
      // The database trigger is the last word on the deadline
      if (err.info && err.info.code === 'P0001' && /deadline/i.test(err.info.message || '')) {
        return fail(res, 403, DEADLINE_MSG, { code: 'deadline_passed' });
      }
      if (err.info && err.info.code === '23505') return fail(res, 409, 'You’ve already submitted your challenge.');
      throw err;
    }

    const emailSent = await trySend('submission_received', app, { submittedAt: saved.submitted_at });
    return send(res, 200, { ok: true, submittedAt: saved.submitted_at, emailSent });
  } catch (err) {
    console.error('Challenge submission failed:', err.message);
    return fail(res, 502, 'We couldn’t save your submission just now. Please try again.');
  }
};
