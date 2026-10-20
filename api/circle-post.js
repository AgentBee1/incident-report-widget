import { verifySession } from './auth.js';

// Creates the Circle cross-reference post for an award: titled with the agent's name,
// in the Latest Reports space with the Awards topic, showing the Kudos preview card
// and a "View Award" link. All award details live on kudos.agentbee.net.
//
// Environment variables (Vercel → this project → Settings → Environment Variables):
//   CIRCLE_API_TOKEN   Circle Admin API v2 token (same one the Kudos submission widget uses)
//   ADMIN_PASSPHRASE   already set; used to check the caller is logged in to the widget
//   SUPABASE_ANON_KEY  already set
// Optional: CIRCLE_SPACE_ID (default 134965 "Latest Reports"), CIRCLE_AWARD_TOPIC_ID
//   (default 99686), CIRCLE_API_BASE_URL, CIRCLE_AUTHOR_EMAIL.

const SUPABASE_URL = 'https://mtatzzrbapftzwuxrcko.supabase.co';
const CIRCLE_API = (process.env.CIRCLE_API_BASE_URL || 'https://app.circle.so/api/admin/v2').replace(/\/+$/, '');
const SPACE_ID = Number(process.env.CIRCLE_SPACE_ID || 134965);
const TOPIC_ID = Number(process.env.CIRCLE_AWARD_TOPIC_ID || 99686);

async function circle(path, body) {
  const res = await fetch(`${CIRCLE_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.CIRCLE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Circle ${path} responded ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE)) {
    return res.status(401).json({ error: 'Your session has expired. Please reload the widget and log in again.' });
  }
  if (!process.env.CIRCLE_API_TOKEN) {
    return res.status(500).json({ error: 'CIRCLE_API_TOKEN is not set in this Vercel project.' });
  }

  const { incident_id: incidentId, draft } = req.body || {};
  if (!/^[0-9a-f-]{36}$/i.test(incidentId || '')) return res.status(400).json({ error: 'Invalid incident_id' });

  try {
    // Award details come from the public Kudos view, the same source the Kudos site uses.
    const key = process.env.SUPABASE_ANON_KEY;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kudos_awards_public?award_id=eq.${incidentId}&select=award_slug,agent_name`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const [award] = r.ok ? await r.json() : [];
    if (!award) return res.status(404).json({ error: 'Award not found in Kudos (is it saved as Awards & Recognition?)' });

    const kudosUrl = `https://kudos.agentbee.net/award/${award.award_slug}`;
    const clientUrl = `${kudosUrl}?ref=client`;

    // Make sure the Kudos page is live before Circle fetches it for the preview card.
    await fetch('https://kudos.agentbee.net/api/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ award_id: incidentId }),
    }).catch(() => {});

    const embed = await circle('/embeds', { url: clientUrl });

    const content = [];
    if (embed?.sgid) content.push({ type: 'embed', attrs: { sgid: embed.sgid } });
    content.push({
      type: 'paragraph',
      content: [{
        type: 'text', text: 'View Award →',
        marks: [{ type: 'bold' }, { type: 'link', attrs: { href: clientUrl, target: '_blank' } }],
      }],
    });

    const payload = {
      space_id: SPACE_ID,
      name: award.agent_name,
      status: draft ? 'draft' : 'published',
      topics: TOPIC_ID ? [TOPIC_ID] : undefined,
      tiptap_body: { body: { type: 'doc', content } },
    };
    if (process.env.CIRCLE_AUTHOR_EMAIL) payload.user_email = process.env.CIRCLE_AUTHOR_EMAIL;

    // Circle replies with { success, message, post: {...} }.
    const created = await circle('/posts', payload);
    const post = created.post || created;
    return res.status(200).json({ ok: true, circleUrl: post.url || null, circlePostId: post.id || null, kudosUrl });
  } catch (e) {
    console.error('circle-post failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
