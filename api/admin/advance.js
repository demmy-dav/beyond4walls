// POST /api/admin/advance: move an application to its next stage and email the
// applicant. Admins can act on any role, Leads on their own role, reviewers not at all.
//   { id, action: 'under_review' }
//   { id, action: 'release_challenge' }                 (72-hour clock starts now)
//   { id, action: 'schedule_interview', interviewAt }   (ISO date-time)
//   { id, action: 'decision', decision: 'offer' | 'not_selected' }
const { send, fail, clean, postJson } = require('../_lib/http');
const { db, rpc } = require('../_lib/supabase');
const { currentStaff } = require('../_lib/staff');
const { trySend } = require('../_lib/email');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which stages each action can start from
const FROM = {
  under_review: ['received'],
  release_challenge: ['received', 'under_review'],
  schedule_interview: ['under_review', 'challenge_released', 'interview_scheduled'],
  decision: ['received', 'under_review', 'challenge_released', 'interview_scheduled'],
};

module.exports = async function handler(req, res) {
  const raw = await postJson(req, res, { limit: { name: 'admin', max: 60, windowMs: 10 * 60 * 1000 } });
  if (!raw) return;

  const id = clean(raw.id);
  const action = clean(raw.action);
  if (!UUID.test(id) || !FROM[action]) return fail(res, 422, 'Unknown application or action.');

  try {
    const { user, profile } = await currentStaff(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (!profile || profile.role === 'reviewer') return fail(res, 403, 'Only admins and the role’s Lead can move applications forward.');

    const [app] = await db('applications', `select=id,application_id,name,email,role_id,stage&id=eq.${id}`, { as: 'service' });
    if (!app) return fail(res, 404, 'Application not found.');
    if (profile.role === 'lead' && profile.lead_of_role_id !== app.role_id) {
      return fail(res, 403, 'Leads can only move applications for their own role.');
    }
    if (!FROM[action].includes(app.stage)) {
      return fail(res, 409, `This application is at “${app.stage.replace(/_/g, ' ')}”, so that step isn’t available.`);
    }

    const patch = { stage_updated_at: new Date().toISOString() };
    let email;

    if (action === 'under_review') {
      patch.stage = 'under_review';
      email = ['under_review', {}];
    } else if (action === 'release_challenge') {
      // Release + stage change happen together in one database transaction
      let result;
      try {
        result = await rpc('release_challenge', { p_application: app.id, p_released_by: user.id });
      } catch (err) {
        const msg = (err.info && err.info.message) || '';
        if (msg === 'no_active_challenge') return fail(res, 409, 'This role has no active challenge yet. Add one in the challenges table first.');
        if (msg === 'wrong_stage' || (err.info && err.info.code === '23505')) return fail(res, 409, 'The challenge was already released. Please refresh.');
        throw err;
      }
      const emailSent = await trySend('challenge_released', app, { challengeTitle: result.challenge_title, dueAt: result.due_at });
      return send(res, 200, { ok: true, stage: 'challenge_released', dueAt: result.due_at, emailSent });
    } else if (action === 'schedule_interview') {
      const at = Date.parse(clean(raw.interviewAt));
      if (!Number.isFinite(at) || at < Date.now() || at > Date.now() + 365 * 864e5) {
        return fail(res, 422, 'Please choose an interview date and time in the future.');
      }
      patch.stage = 'interview_scheduled';
      patch.interview_at = new Date(at).toISOString();
      email = ['interview_scheduled', { interviewAt: patch.interview_at }];
    } else {
      const decision = clean(raw.decision);
      if (!['offer', 'not_selected'].includes(decision)) return fail(res, 422, 'Please choose a decision.');
      patch.stage = 'decision_made';
      patch.decision = decision;
      email = ['decision', { decision }];
    }

    // Only update if nobody else moved it in the meantime
    const updated = await db('applications', `id=eq.${id}&stage=eq.${app.stage}&select=stage`, {
      as: 'service', method: 'PATCH', body: patch, prefer: 'return=representation',
    });
    if (!updated.length) return fail(res, 409, 'Someone else just updated this application. Please refresh.');

    const emailSent = await trySend(email[0], app, email[1]);
    return send(res, 200, { ok: true, stage: patch.stage, emailSent });
  } catch (err) {
    console.error('Admin action failed:', err.message);
    return fail(res, 502, 'That didn’t work just now. Please try again.');
  }
};
