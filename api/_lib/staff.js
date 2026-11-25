// Identifies signed-in staff (admin / lead / reviewer) from their access token.
const { bearerToken } = require('./http');
const { db, userFromToken } = require('./supabase');

async function currentStaff(req) {
  const token = bearerToken(req);
  const user = await userFromToken(token);
  if (!user) return { user: null };
  const [profile] = await db('profiles', `select=role,full_name,lead_of_role_id&id=eq.${encodeURIComponent(user.id)}`, { as: token });
  return { user, token, profile: profile || null };
}

module.exports = { currentStaff };
