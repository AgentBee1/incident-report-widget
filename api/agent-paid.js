import { verifySession } from './auth.js';
import { sb } from './_kudos.js';

// Admin only: mark an agent as a paying Kudos client (or not). Always set on the agent's
// main brand record, which is what the Kudos site reads.
//   { agent_id, paid: true | false }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Only the admin can change paid status.' });

  const { agent_id: agentId, paid } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(agentId || '') || typeof paid !== 'boolean') {
    return res.status(400).json({ error: 'Expected agent_id and paid (true/false).' });
  }

  try {
    const [a] = await sb(`agents?id=eq.${agentId}&select=id,canonical_agent_id`);
    if (!a) return res.status(404).json({ error: 'Agent not found' });
    const mainId = a.canonical_agent_id || a.id;
    await sb(`agents?id=eq.${mainId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ is_kudos_client: paid }),
    });
    return res.status(200).json({ ok: true, agent_id: mainId, paid });
  } catch (e) {
    console.error('agent-paid failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
