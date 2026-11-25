// GET /api/admin/applications?role=<slug>&stage=<stage>: applications for staff,
// read with the staff member's own token (row level security allows staff only).
const { send, fail } = require('../_lib/http');
const { db, signedDownloadUrl } = require('../_lib/supabase');
const { currentStaff } = require('../_lib/staff');

const STAGES = ['received', 'under_review', 'challenge_released', 'interview_scheduled', 'decision_made'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Method not allowed.');
  }
  try {
    const { user, token, profile } = await currentStaff(req);
    if (!user) return fail(res, 401, 'Please sign in again.');
    if (!profile) return fail(res, 403, 'This page is for the Beyond4walls team only.');

    const url = new URL(req.url, 'http://x');
    const roleSlug = url.searchParams.get('role') || '';
    const stage = url.searchParams.get('stage') || '';

    const roles = await db('roles', 'select=id,slug,title,status&order=sort_order.asc', { as: token });
    const filters = [];
    const role = roles.find((r) => r.slug === roleSlug);
    if (role) filters.push(`role_id=eq.${role.id}`);
    if (STAGES.includes(stage)) filters.push(`stage=eq.${stage}`);

    const rows = await db('applications',
      'select=id,application_id,name,email,phone,role_id,stage,interview_at,decision,hours_per_week,start_date,answers,created_at,stage_updated_at,' +
      'role:roles!applications_role_id_fkey(title,slug),second_role:roles!applications_second_role_id_fkey(title),' +
      'release:challenge_releases(released_at,due_at,challenge:challenges(title)),' +
      'submission:submissions(text,file_path,file_name,file_size,submitted_at)' +
      `${filters.length ? `&${filters.join('&')}` : ''}&order=created_at.desc&limit=200`, { as: token });

    const applications = await Promise.all(rows.map(async (r) => {
      const sub = r.submission;
      return {
        ...r,
        submission: sub ? {
          text: sub.text,
          submittedAt: sub.submitted_at,
          file: sub.file_path ? { name: sub.file_name, size: sub.file_size, url: await signedDownloadUrl(sub.file_path, 600) } : null,
        } : null,
        // Leads act on their own role only; admins on every role; reviewers view only
        canAct: profile.role === 'admin' || (profile.role === 'lead' && profile.lead_of_role_id === r.role_id),
      };
    }));

    return send(res, 200, { ok: true, me: { role: profile.role, name: profile.full_name }, roles, applications });
  } catch (err) {
    console.error('Admin list failed:', err.message);
    return fail(res, 502, 'We couldn’t load applications just now.');
  }
};
