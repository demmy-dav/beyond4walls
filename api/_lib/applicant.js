// Loads the signed-in applicant's latest application with their challenge
// release and submission. Every query runs with the applicant's own access
// token, so row level security decides what they can see.
const { bearerToken } = require('./http');
const { db, userFromToken } = require('./supabase');

async function currentApplicant(req) {
  const token = bearerToken(req);
  const user = await userFromToken(token);
  if (!user) return { user: null };

  const [app] = await db('applications',
    'select=id,application_id,name,email,role_id,stage,interview_at,decision,created_at,stage_updated_at,' +
    'role:roles!applications_role_id_fkey(title,slug),second_role:roles!applications_second_role_id_fkey(title)' +
    '&order=created_at.desc&limit=1', { as: token });
  if (!app) return { user, token, app: null };

  const id = encodeURIComponent(app.id);
  const [[release], [submission]] = await Promise.all([
    db('challenge_releases', `select=released_at,due_at,challenge:challenges(title,brief,resources)&application_id=eq.${id}`, { as: token }),
    db('submissions', `select=text,file_path,file_name,file_type,file_size,submitted_at,locked&application_id=eq.${id}`, { as: token }),
  ]);
  return { user, token, app, release: release || null, submission: submission || null };
}

module.exports = { currentApplicant };
