import { createHmac } from 'crypto';

// Signed session token: "<expiry ms>.<signature>". Server functions that do something
// sensitive (e.g. api/circle-post.js) check it, so only someone who logged in with the
// passphrase can use them. Signed with ADMIN_PASSPHRASE, valid for 12 hours.
export function signSession(secret, ttlMs = 12 * 60 * 60 * 1000) {
  const exp = String(Date.now() + ttlMs);
  const sig = createHmac('sha256', secret).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

export function verifySession(token, secret) {
  if (!token || !secret) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = createHmac('sha256', secret).update(exp).digest('hex');
  return sig.length === expected.length && sig === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { passphrase } = req.body;
  const correct = process.env.ADMIN_PASSPHRASE;

  if (!correct) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (passphrase === correct) {
    return res.status(200).json({
      ok: true,
      token: 'ab-admin-' + Date.now(),
      sessionToken: signSession(correct),
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }

  return res.status(401).json({ ok: false, error: 'Incorrect passphrase' });
}
