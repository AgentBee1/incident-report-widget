import { verifySession } from './auth.js';
import { sb, createCirclePost } from './_kudos.js';

// Review queue actions (admin only).
//   { action: 'approve', incident_id, edits?: { award_title, incident_date, original_source_url, notify_agent } }
//   { action: 'reject',  incident_id, reason }
//
// Approve: saves any edits, marks the award approved (which makes it public on Kudos and
// triggers the agent email if notify_agent is on), sends the held-back client ticker
// entries, then creates the Circle cross-reference post.

const EDITABLE = ['award_title', 'incident_date', 'original_source_url', 'notify_agent'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please reload and log in again.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Only the admin can review awards.' });

  const { action, incident_id: id, edits = {}, reason, reviewer = 'Admin' } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) return res.status(400).json({ error: 'Invalid incident_id' });

  try {
    const [award] = await sb(`incidents?id=eq.${id}&select=id,review_status,report_type`);
    if (!award) return res.status(404).json({ error: 'Award not found' });
    if (award.review_status !== 'pending') {
      return res.status(409).json({ error: `This award has already been ${award.review_status}.` });
    }

    if (action === 'reject') {
      await sb(`incidents?id=eq.${id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          review_status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewer,
          is_voided: true, voided_at: new Date().toISOString(),
          void_reason: `Kudos review: ${String(reason || 'rejected').slice(0, 200)}`,
        }),
      });
      return res.status(200).json({ ok: true, status: 'rejected' });
    }

    if (action !== 'approve') return res.status(400).json({ error: 'Unknown action' });

    const changes = {};
    for (const k of EDITABLE) if (k in edits) changes[k] = edits[k];
    if (changes.award_title !== undefined && !String(changes.award_title).trim()) {
      return res.status(400).json({ error: 'Award title cannot be empty.' });
    }

    // Edits first, then the status change (which fires the agent email trigger).
    if (Object.keys(changes).length) {
      await sb(`incidents?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(changes) });
    }
    await sb(`incidents?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ review_status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewer }),
    });
    const tickers = await sb('rpc/kudos_publish_award', { method: 'POST', body: JSON.stringify({ p_incident_id: id }) });

    let circle = null, circleError = null;
    try { circle = await createCirclePost(id); } catch (e) { circleError = String(e.message || e); }

    return res.status(200).json({ ok: true, status: 'approved', tickerEntries: tickers, ...(circle || {}), circleError });
  } catch (e) {
    console.error('review failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
