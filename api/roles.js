// GET /api/roles: the role cards for Stage 1 (open and closed), in display order.
const { send, fail } = require('./_lib/http');
const { db } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Method not allowed.');
  }
  try {
    const roles = await db('roles', 'select=slug,title,description,hours,skills,lead_question,status&order=sort_order.asc');
    send(res, 200, { ok: true, roles });
  } catch (err) {
    console.error('Loading roles failed:', err.message);
    fail(res, 502, 'We couldn’t load the roles just now.');
  }
};
