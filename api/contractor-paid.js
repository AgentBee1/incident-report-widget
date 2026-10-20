import { verifySession } from './auth.js';
import { sb } from './_kudos.js';

// Admin only: record whether the contractor has been paid for a staff-submitted award.
//   { incident_id, paid: true | false, by }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Only the admin can record payments.' });

  const { incident_id: id, paid, by = 'Admin' } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || typeof paid !== 'boolean') {
    return res.status(400).json({ error: 'Expected incident_id and paid (true/false).' });
  }

  try {
    const [award] = await sb(`incidents?id=eq.${id}&select=id,submitted_role`);
    if (!award) return res.status(404).json({ error: 'Award not found' });
    if (award.submitted_role !== 'staff') return res.status(400).json({ error: 'Only staff submissions are paid per report.' });
    await sb(`incidents?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        contractor_paid: paid,
        contractor_paid_at: paid ? new Date().toISOString() : null,
        contractor_paid_by: paid ? String(by).slice(0, 80) : null,
      }),
    });
    return res.status(200).json({ ok: true, paid });
  } catch (e) {
    console.error('contractor-paid failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
