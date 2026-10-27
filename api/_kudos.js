// Shared helpers for the award server functions. Files starting with "_" are not
// exposed as Vercel routes.

export const SUPABASE_URL = 'https://mtatzzrbapftzwuxrcko.supabase.co';
const CIRCLE_API = (process.env.CIRCLE_API_BASE_URL || 'https://app.circle.so/api/admin/v2').replace(/\/+$/, '');
const SPACE_ID = Number(process.env.CIRCLE_SPACE_ID || 134965);
const TOPIC_ID = Number(process.env.CIRCLE_AWARD_TOPIC_ID || 99686);

export async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} responded ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

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

// Creates the Circle cross-reference post for an approved award: titled with the agent's
// name, Kudos preview card + "View Award" link. Saves the Circle link on the award as
// source_url. Returns { kudosUrl, circleUrl }.
export async function createCirclePost(incidentId, { draft = false } = {}) {
  if (!process.env.CIRCLE_API_TOKEN) throw new Error('CIRCLE_API_TOKEN is not set in this Vercel project.');

  const [award] = await sb(`kudos_awards_public?award_id=eq.${incidentId}&select=award_slug,agent_name`);
  if (!award) throw new Error('Award not found in Kudos (is it approved and saved as Awards & Recognition?)');

  const kudosUrl = `https://kudos.agentbee.net/award/${award.award_slug}`;
  const clientUrl = `${kudosUrl}?ref=client`;

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
    // Circle leaves these null (shown as off) unless set explicitly.
    is_comments_enabled: true,
    is_liking_enabled: true,
  };
  if (process.env.CIRCLE_AUTHOR_EMAIL) payload.user_email = process.env.CIRCLE_AUTHOR_EMAIL;

  const created = await circle('/posts', payload); // { success, message, post }
  const post = created.post || created;
  const circleUrl = post.url || null;

  if (circleUrl && !draft) {
    await sb(`incidents?id=eq.${incidentId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ source_url: circleUrl }),
    });
  }
  return { kudosUrl, circleUrl, circlePostId: post.id || null };
}
