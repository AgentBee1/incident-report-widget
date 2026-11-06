import { verifySession } from './auth.js';
import { sbService } from './_kudos.js';

// Saves a contact email for an institution that has none (admin or staff session).
// The database function is not callable with the public anon key, so the widgets
// call this endpoint instead of the RPC directly.
//
// Body: { institution_id, email }
// Env: ADMIN_PASSPHRASE, SUPABASE_SERVICE_ROLE_KEY.

const uuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ message: 'Your session has expired. Please reload and log in again.' });

  const { institution_id: id, email } = req.body || {};
  if (!uuid(id)) return res.status(400).json({ message: 'Invalid institution.' });
  if (!email || typeof email !== 'string') return res.status(400).json({ message: 'Enter a valid email address.' });

  try {
    await sbService('rpc/set_institution_contact_email', {
      method: 'POST',
      body: JSON.stringify({ p_institution_id: id, p_email: email }),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    // The database function raises readable messages (invalid email, already set, not found).
    const status = e.status && e.status < 500 ? 400 : 500;
    return res.status(status).json({ message: String(e.message || e) });
  }
}
