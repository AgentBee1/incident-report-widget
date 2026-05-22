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
      supabaseKey: process.env.SUPABASE_ANON_KEY,
    });
  }

  return res.status(401).json({ ok: false, error: 'Incorrect passphrase' });
}
