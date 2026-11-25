// GET /api/portal: the signed-in applicant's status, challenge (once released)
// and submission. Includes the server's clock so countdowns don't depend on the
// applicant's device time.
const { send, fail } = require('./_lib/http');
const { signedDownloadUrl } = require('./_lib/supabase');
const { currentApplicant } = require('./_lib/applicant');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Method not allowed.');
  }
  try {
    const { user, app, release, submission } = await currentApplicant(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (!app) return send(res, 200, { ok: true, application: null, serverNow: new Date().toISOString() });

    let file = null;
    if (submission && submission.file_path) {
      file = {
        name: submission.file_name,
        type: submission.file_type,
        size: submission.file_size,
        url: await signedDownloadUrl(submission.file_path, 600),
      };
    }

    return send(res, 200, {
      ok: true,
      serverNow: new Date().toISOString(),
      application: {
        applicationId: app.application_id,
        name: app.name,
        role: app.role && app.role.title,
        secondRole: app.second_role && app.second_role.title,
        stage: app.stage,
        interviewAt: app.interview_at,
        decision: app.stage === 'decision_made' ? app.decision : null,
        submittedAt: app.created_at,
      },
      challenge: release ? {
        title: release.challenge.title,
        brief: release.challenge.brief,
        resources: release.challenge.resources,
        releasedAt: release.released_at,
        dueAt: release.due_at,
      } : null,
      submission: submission ? {
        text: submission.text,
        submittedAt: submission.submitted_at,
        locked: submission.locked,
        file,
      } : null,
    });
  } catch (err) {
    console.error('Portal load failed:', err.message);
    return fail(res, 502, 'We couldn’t load your application just now. Please try again.');
  }
};
