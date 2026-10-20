import { verifySession } from './auth.js';
import { createCirclePost } from './_kudos.js';

// Creates the Circle cross-reference post for an award the admin has just saved
// (also used by the widget's "Retry Circle post" button). Admin only: staff submissions
// get their Circle post when they're approved in the review queue (api/review.js).
//
// Environment variables: CIRCLE_API_TOKEN, ADMIN_PASSPHRASE, SUPABASE_ANON_KEY.
// Optional: CIRCLE_SPACE_ID, CIRCLE_AWARD_TOPIC_ID, CIRCLE_API_BASE_URL, CIRCLE_AUTHOR_EMAIL.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please reload the widget and log in again.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Only the admin can publish awards.' });

  const { incident_id: incidentId, draft } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(incidentId || '')) return res.status(400).json({ error: 'Invalid incident_id' });

  try {
    const result = await createCirclePost(incidentId, { draft: Boolean(draft) });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('circle-post failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
