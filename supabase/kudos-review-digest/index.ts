// kudos-review-digest: daily email to admin@agentbee.net listing staff-submitted awards
// waiting for review. Run by the pg_cron job `kudos-review-digest` (8am Sydney, summer time).
// Sends nothing when the queue is empty. The recipient is fixed, so calling it can only
// ever email AgentBee's own inbox.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const POSTMARK_TOKEN = Deno.env.get('POSTMARK_API_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TO = 'admin@agentbee.net';
const REVIEW_URL = 'https://incident-report-widget.vercel.app/review.html';

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Only one email per day, however often this is called.
  const { data: last } = await supabase.rpc('kudos_review_digest_claim');
  if (last === false) return new Response('Already sent today', { status: 200 });

  const { data: pending, error } = await supabase
    .from('incidents')
    .select('id, agent_id, award_title, incident_date, issuing_institution_id, submitted_by, created_at')
    .eq('review_status', 'pending')
    .order('created_at', { ascending: true });
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });
  if (!pending?.length) return new Response('Nothing pending', { status: 200 });

  const agentIds = [...new Set(pending.map((p) => p.agent_id))];
  const instIds = [...new Set(pending.map((p) => p.issuing_institution_id).filter(Boolean))];
  const { data: agents } = await supabase.from('agents').select('id, agency_name').in('id', agentIds);
  const { data: insts } = instIds.length ? await supabase.from('institutions').select('id, name').in('id', instIds) : { data: [] };
  const agentName = Object.fromEntries((agents ?? []).map((a) => [a.id, a.agency_name]));
  const instName = Object.fromEntries((insts ?? []).map((i) => [i.id, i.name]));

  const n = pending.length;
  const rows = pending.map((p) => ({
    agent: agentName[p.agent_id] ?? 'Unknown agent',
    title: p.award_title,
    issuer: instName[p.issuing_institution_id] ?? '',
    by: p.submitted_by ?? 'unknown',
    when: new Date(p.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' }),
  }));

  const html = `<p>${n} award${n === 1 ? ' is' : 's are'} waiting for review.</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
<tr style="text-align:left;color:#6b7280;"><th>Agent</th><th>Award</th><th>Issuer</th><th>Submitted</th></tr>
${rows.map((r) => `<tr style="border-top:1px solid #eee;"><td>${esc(r.agent)}</td><td>${esc(r.title)}</td><td>${esc(r.issuer)}</td><td>${esc(r.by)}, ${esc(r.when)}</td></tr>`).join('\n')}
</table>
<p style="margin:24px 0;"><a href="${REVIEW_URL}" style="background:#fed04b;color:#000;padding:10px 20px;text-decoration:none;border-radius:4px;font-weight:bold;">Open the review queue</a></p>`;
  const text = `${n} award${n === 1 ? ' is' : 's are'} waiting for review.\n\n${rows.map((r) => `- ${r.agent}: ${r.title} (${r.issuer}) - ${r.by}, ${r.when}`).join('\n')}\n\nReview queue: ${REVIEW_URL}`;

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': POSTMARK_TOKEN },
    body: JSON.stringify({
      From: 'AgentBee <notifications@agentbee.net>',
      To: TO,
      Subject: `Kudos: ${n} award${n === 1 ? '' : 's'} waiting for review`,
      HtmlBody: html,
      TextBody: text,
      MessageStream: 'outbound',
    }),
  });
  if (!res.ok) return new Response(`Postmark error: ${await res.text()}`, { status: 500 });
  return new Response(`Sent (${n} pending)`, { status: 200 });
});
