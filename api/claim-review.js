import crypto from 'node:crypto';
import { verifySession } from './auth.js';
import { sbService } from './_kudos.js';

// Review pending Kudos agency claims (kudos.agentbee.net/account).
//
// Two ways in:
//  * the Approve / Reject buttons in the "claim waiting for approval" email: a one-off token
//    (?t=..., 7 days, single use; only its SHA-256 hash is stored in kudos_claim_tokens)
//  * the review queue (review.html), with the admin session (x-session header)
//
//   GET  ?t=TOKEN                 claim details for the confirmation page (claim.html)
//   GET  ?list=1                  pending claims (admin session)
//   GET  ?search=TEXT&t=TOKEN     agent search, to link a "new agency" claim (token or session)
//   POST {t | account_id, action: 'approve'|'reject', agent_id?}
//
// Env: ADMIN_PASSPHRASE, SUPABASE_SERVICE_ROLE_KEY.

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');
const KUDOS = 'https://kudos.agentbee.net';

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function tokenRow(t) {
  if (!/^[0-9a-f]{48}$/.test(t || '')) return null;
  const rows = await sbService(`kudos_claim_tokens?token_hash=eq.${hash(t)}&select=id,account_id,expires_at,used_at`);
  return rows?.[0] || null;
}

async function details(accountId) {
  const [acc] = await sbService(
    `kudos_accounts?id=eq.${accountId}&select=id,email,agent_id,claim_status,claim_note,role,created_at`
  );
  if (!acc) return null;
  let agent = null;
  if (acc.agent_id) {
    const [a] = await sbService(`agents?id=eq.${acc.agent_id}&select=id,agency_name,website,country,email`);
    if (a) {
      const awards = await sbService(`kudos_awards_public?agent_id=eq.${a.id}&select=agent_slug`).catch(() => []);
      const slug = awards[0]?.agent_slug || slugify(a.agency_name);
      agent = { id: a.id, name: a.agency_name, website: a.website, country: a.country, email: a.email, awards: awards.length, kudos_url: `${KUDOS}/agent/${slug}` };
    }
  }
  let requested = null;
  try {
    requested = JSON.parse(acc.claim_note || 'null');
  } catch {}
  return {
    account_id: acc.id,
    email: acc.email,
    status: acc.claim_status,
    role: acc.role,
    requested_at: acc.created_at,
    agent,
    new_agency: requested?.new_agency ? requested : null
  };
}

export default async function handler(req, res) {
  try {
    const isAdmin = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE) === 'admin';

    if (req.method === 'GET') {
      const { t, list, search } = req.query;
      const tok = t ? await tokenRow(String(t)) : null;
      const tokenOk = tok && !tok.used_at && new Date(tok.expires_at) > new Date();

      if (search !== undefined) {
        if (!isAdmin && !tokenOk) return res.status(401).json({ message: 'Not allowed.' });
        const q = String(search).trim().replace(/[*,()]/g, ' ').slice(0, 80);
        if (q.length < 2) return res.status(200).json([]);
        const rows = await sbService(
          `agents?canonical_agent_id=is.null&agency_name=ilike.*${encodeURIComponent(q)}*&select=id,agency_name,website,country&order=agency_name&limit=12`
        );
        return res.status(200).json(rows.map((r) => ({ id: r.id, name: r.agency_name, website: r.website, country: r.country })));
      }

      if (list) {
        if (!isAdmin) return res.status(401).json({ message: 'Please log in as admin.' });
        const pending = await sbService('kudos_accounts?claim_status=eq.pending&select=id&order=created_at.asc');
        return res.status(200).json(await Promise.all(pending.map((p) => details(p.id))));
      }

      if (!tok) return res.status(404).json({ message: 'This review link is not valid.' });
      const d = await details(tok.account_id);
      if (!d) return res.status(404).json({ message: 'This claim no longer exists.' });
      return res.status(200).json({
        ...d,
        link: tok.used_at ? 'used' : new Date(tok.expires_at) <= new Date() ? 'expired' : 'ok'
      });
    }

    if (req.method === 'POST') {
      const { t, account_id, action, agent_id } = req.body || {};
      if (!['approve', 'reject'].includes(action)) return res.status(400).json({ message: 'Unknown action.' });
      if (agent_id && !isUuid(agent_id)) return res.status(400).json({ message: 'Invalid agent.' });

      let accountId = null;
      if (t) {
        const tok = await tokenRow(String(t));
        if (!tok) return res.status(404).json({ message: 'This review link is not valid.' });
        if (tok.used_at) return res.status(409).json({ message: 'This link has already been used.' });
        if (new Date(tok.expires_at) <= new Date())
          return res.status(410).json({ message: 'This link has expired. Use the review queue instead.' });
        accountId = tok.account_id;
      } else if (isAdmin && isUuid(account_id)) {
        accountId = account_id;
      } else {
        return res.status(401).json({ message: 'Your session has expired. Please log in again.' });
      }

      const before = await details(accountId);
      if (!before) return res.status(404).json({ message: 'This claim no longer exists.' });
      if (before.status !== 'pending') {
        return res.status(409).json({ message: `This claim has already been ${before.status === 'approved' ? 'approved' : before.status}.`, ...before });
      }
      if (action === 'approve' && !before.agent && !agent_id) {
        return res.status(400).json({ message: 'Choose the agent record to link this new agency to.' });
      }

      await sbService('rpc/kudos_review_claim', {
        method: 'POST',
        body: JSON.stringify({ p_account_id: accountId, p_approve: action === 'approve', p_agent_id: agent_id || null })
      });
      await sbService(`kudos_claim_tokens?account_id=eq.${accountId}&used_at=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ used_at: new Date().toISOString() })
      });
      return res.status(200).json({ ok: true, ...(await details(accountId)) });
    }

    return res.status(405).json({ message: 'Method not allowed.' });
  } catch (e) {
    console.error('claim-review', e);
    return res.status(500).json({ message: String(e.message || e) });
  }
}
