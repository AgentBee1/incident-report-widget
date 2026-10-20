import { createHmac } from 'crypto';

// Two passphrases:
//   ADMIN_PASSPHRASE  Geoff: submissions publish immediately; can review and approve.
//   STAFF_PASSPHRASE  staff: award submissions go to the review queue.
//
// Login returns a signed session token "<expiry>.<role>.<signature>" (12 hours). Server
// functions that do something sensitive (Circle posting, approvals) check it.

export function signSession(secret, role = 'admin', ttlMs = 12 * 60 * 60 * 1000) {
  const exp = String(Date.now() + ttlMs);
  const sig = createHmac('sha256', secret).update(`${exp}.${role}`).digest('hex');
  return `${exp}.${role}.${sig}`;
}

// Returns the role ('admin' | 'staff') for a valid token, otherwise null.
export function verifySession(token, secret) {
  if (!token || !secret) return null;
  const [exp, role, sig] = String(token).split('.');
  if (!exp || !role || !sig || Number(exp) < Date.now()) return null;
  if (role !== 'admin' && role !== 'staff') return null;
  const expected = createHmac('sha256', secret).update(`${exp}.${role}`).digest('hex');
  return sig.length === expected.length && sig === expected ? role : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { passphrase } = req.body || {};
  const admin = process.env.ADMIN_PASSPHRASE;
  const staff = process.env.STAFF_PASSPHRASE;

  if (!admin) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let role = null;
  if (passphrase && passphrase === admin) role = 'admin';
  else if (passphrase && staff && passphrase === staff) role = 'staff';

  if (!role) return res.status(401).json({ ok: false, error: 'Incorrect passphrase' });

  return res.status(200).json({
    ok: true,
    role,
    token: 'ab-admin-' + Date.now(),
    sessionToken: signSession(admin, role),
    supabaseKey: process.env.SUPABASE_ANON_KEY,
  });
}
