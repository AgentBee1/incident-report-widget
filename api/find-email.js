import { verifySession } from './auth.js';
import { SUPABASE_URL } from './_kudos.js';

// Suggests a contact email for an institution with no contact_email on file.
// Uses Claude + web search, restricted to what the institution publishes itself.
// Never writes anything: the widget fills the field and the user saves as normal.
//
// Environment variables: ANTHROPIC_API_KEY, ADMIN_PASSPHRASE, SUPABASE_SERVICE_ROLE_KEY.

export const config = { maxDuration: 60 };

const EMAIL_RE = /^[^\s@<>()",;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function domainOf(s) {
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch { return ''; }
}

async function loadInstitution(id) {
  // Service key (15 Nov 2026): contact_email is no longer readable with the anon key.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !/^[0-9a-f-]{36}$/i.test(id || '')) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/institutions?id=eq.${id}&select=id,name,country,website,contact_email&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please reload the widget and log in again.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Server misconfigured (no ANTHROPIC_API_KEY)' });

  const { institution_id: institutionId, name: nameIn } = req.body || {};
  const inst = (await loadInstitution(institutionId)) || {};
  const name = String(inst.name || nameIn || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing institution name' });
  const country = inst.country || '';
  const website = inst.website || '';

  const prompt = `Find the best contact email address for the international office / international student recruitment team (the team that manages education agents) at this institution:

Institution: ${name}
${country ? `Country: ${country}\n` : ''}${website ? `Website: ${website}\n` : ''}
Rules:
- Only use email addresses the institution itself publishes (its own website or official pages). Never guess or construct an address from a name pattern.
- Order of preference: agent / partner relations team inbox > international office / admissions inbox > general enquiries inbox. Prefer a team inbox over a named individual.
- If the institution has rebranded, merged or closed, say so in "note".
- If you cannot find a published address, return "email": null.

Reply with ONLY a JSON object, no other text:
{"email": string|null, "source_url": string|null, "confidence": "high"|"medium"|"low", "note": string, "alternates": [{"email": string, "source_url": string|null, "label": string}]}
"note" is one short sentence on what the address is (e.g. "International partnerships team inbox"). Max 3 alternates.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || r.statusText);

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No result returned');
    let out;
    try { out = JSON.parse(m[0]); } catch { throw new Error('Could not read result'); }

    const clean = e => (typeof e === 'string' && EMAIL_RE.test(e.trim())) ? e.trim().toLowerCase() : null;
    const email = clean(out.email);
    const alternates = (Array.isArray(out.alternates) ? out.alternates : [])
      .map(a => ({ email: clean(a?.email), source_url: a?.source_url || null, label: String(a?.label || '') }))
      .filter(a => a.email && a.email !== email)
      .slice(0, 3);

    // Flag addresses that don't sit on the institution's own domain.
    const siteDomain = domainOf(website);
    const emailDomain = email ? email.split('@')[1] : '';
    const offDomain = !!(email && siteDomain && !(emailDomain === siteDomain
      || emailDomain.endsWith('.' + siteDomain) || siteDomain.endsWith('.' + emailDomain)));

    return res.status(200).json({
      email,
      source_url: out.source_url || null,
      confidence: ['high', 'medium', 'low'].includes(out.confidence) ? out.confidence : 'low',
      note: String(out.note || ''),
      alternates,
      off_domain: offDomain,
      website: website || null,
    });
  } catch (e) {
    console.error('find-email failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
