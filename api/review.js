import { verifySession } from './auth.js';
import { sb, createCirclePost } from './_kudos.js';

// Review queue actions (admin only).
//   { action: 'approve', incident_id, agent_id?, new_agent?: { agency_name, website, country },
//     edits?: { award_title, incident_date, original_source_url, notify_agent, notify_institution } }
//   { action: 'reject',  incident_id, reason }
//
// Approve: sets the agent (picked or newly created) if needed, saves edits, marks the award
// approved (makes it public on Kudos and triggers the agent email if notify_agent is on),
// links the issuing institution, sends the held-back client ticker entries, then creates the
// Circle cross-reference post.

const EDITABLE = ['award_title', 'incident_date', 'original_source_url', 'notify_agent', 'notify_institution', 'issuing_institution_id'];
const uuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please reload and log in again.' });
  if (role !== 'admin') return res.status(403).json({ error: 'Only the admin can review awards.' });

  const { action, incident_id: id, edits = {}, reason, reviewer = 'Admin', agent_id: pickedAgent, new_agent: newAgent } = req.body || {};
  if (!uuid(id)) return res.status(400).json({ error: 'Invalid incident_id' });

  try {
    const [award] = await sb(`incidents?id=eq.${id}&select=id,review_status,agent_id,issuing_institution_id`);
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
    if (changes.award_title !== undefined && !String(changes.award_title || '').trim()) {
      return res.status(400).json({ error: 'Award title cannot be empty.' });
    }
    if (changes.issuing_institution_id !== undefined && !uuid(changes.issuing_institution_id)) delete changes.issuing_institution_id;
    // Picking an institution at review replaces an aggregator issuer (only one issuer allowed).
    if (changes.issuing_institution_id) changes.issuing_agent_id = null;

    // Agent: an existing record picked at review, or a new one created now.
    let agentId = award.agent_id;
    if (newAgent && String(newAgent.agency_name || '').trim()) {
      const name = String(newAgent.agency_name).trim();
      const existing = await sb(`agents?agency_name=ilike.${encodeURIComponent(name)}&select=id&limit=1`);
      if (existing.length) {
        return res.status(409).json({ error: `An agent called "${name}" already exists. Pick it from the list instead.` });
      }
      const [created] = await sb('agents?select=id', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          agency_name: name,
          website: String(newAgent.website || '').trim() || null,
          country: String(newAgent.country || '').trim() || null,
        }),
      });
      agentId = created.id;
    } else if (uuid(pickedAgent)) {
      // Always file awards against the main brand record.
      const [a] = await sb(`agents?id=eq.${pickedAgent}&select=id,canonical_agent_id`);
      if (!a) return res.status(400).json({ error: 'That agent no longer exists.' });
      agentId = a.canonical_agent_id || a.id;
    }
    if (!agentId) return res.status(400).json({ error: 'Choose the agent (or create it) before approving.' });
    if (agentId !== award.agent_id) changes.agent_id = agentId;

    // Edits first, then the status change (which fires the agent email trigger).
    if (Object.keys(changes).length) {
      await sb(`incidents?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(changes) });
    }
    await sb(`incidents?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ review_status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewer }),
    });

    // Link the issuing institution, as the admin form does on submit.
    const instId = changes.issuing_institution_id || award.issuing_institution_id;
    if (instId) {
      const linked = await sb(`incident_institution_links?incident_id=eq.${id}&institution_id=eq.${instId}&select=incident_id`);
      if (!linked.length) {
        await sb('incident_institution_links', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify([{ incident_id: id, institution_id: instId }]),
        });
      }
    }
    const tickers = await sb('rpc/kudos_publish_award', { method: 'POST', body: JSON.stringify({ p_incident_id: id }) });

    let circle = null, circleError = null;
    try { circle = await createCirclePost(id); } catch (e) { circleError = String(e.message || e); }

    return res.status(200).json({ ok: true, status: 'approved', tickerEntries: tickers, ...(circle || {}), circleError });
  } catch (e) {
    console.error('review failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
