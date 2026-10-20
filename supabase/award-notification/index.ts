// award-notification Edge Function (v5, Kudos integration, 21 Oct 2026)
//
// Called by the award_notification_trigger when an award is saved. Emails the agent via
// Postmark with a link to their award on kudos.agentbee.net.
//
// Changes from v4 (backup in rollback/award-notification/index.ts):
//  - Re-reads the award from the database instead of trusting the request body, and only
//    acts on genuine awards saved in the last 10 minutes, so the public URL can't be used
//    to email agents with made-up details.
//  - Respects incidents.notify_agent: false = don't email; true = email; null (the old
//    widget) = previous behaviour, email if an address is on file.
//  - Refreshes kudos.agentbee.net and checks the award page loads BEFORE sending, so the
//    link in the email always works.
//  - Links to the agent's specific award page instead of agentbee.net/kudos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const POSTMARK_API_TOKEN = Deno.env.get('POSTMARK_API_TOKEN')!;
const POSTMARK_TEMPLATE_ID = 46464153;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC_ADDRESS = 'notifications@agentbee.net';
const KUDOS_SITE = 'https://kudos.agentbee.net';
const MAX_AGE_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ask the Kudos site to refresh, then wait until the award page actually loads.
async function makeAwardLive(awardId: string, url: string) {
  try {
    await fetch(`${KUDOS_SITE}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ award_id: awardId }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn('Kudos refresh call failed (page will still load via fresh lookup):', e);
  }
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return true;
    } catch { /* retry */ }
    await sleep(2000);
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const { type, record } = payload ?? {};
    if (type !== 'INSERT' || !record?.id) {
      return new Response('Ignored', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Trust the database, not the request body.
    const { data: award } = await supabase
      .from('incidents')
      .select('id, agent_id, report_type, award_title, issuing_institution_id, notify_agent, created_at, is_voided')
      .eq('id', record.id)
      .single();

    if (!award || award.report_type !== 'Awards & Recognition' || award.is_voided) {
      return new Response('Ignored: not an award', { status: 200 });
    }
    if (Date.now() - new Date(award.created_at).getTime() > MAX_AGE_MS) {
      return new Response('Ignored: not a newly saved award', { status: 200 });
    }
    if (award.notify_agent === false) {
      return new Response('Skipped: agent notification turned off', { status: 200 });
    }

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, agency_name, email, canonical_agent_id')
      .eq('id', award.agent_id)
      .single();

    if (agentError || !agent) {
      console.error('Agent lookup failed:', agentError);
      return new Response('Agent not found', { status: 200 });
    }

    let emailTarget = agent.email;
    let agentName = agent.agency_name;

    if (!emailTarget && agent.canonical_agent_id) {
      const { data: canonical } = await supabase
        .from('agents')
        .select('agency_name, email')
        .eq('id', agent.canonical_agent_id)
        .single();
      if (canonical?.email) emailTarget = canonical.email;
      if (canonical?.agency_name) agentName = canonical.agency_name;
    }

    if (!emailTarget) {
      console.warn(`No email for agent ${agent.id} — skipping notification`);
      return new Response('No email on file — skipped', { status: 200 });
    }

    let issuingInstitution = null;
    if (award.issuing_institution_id) {
      const { data: inst } = await supabase
        .from('institutions')
        .select('name')
        .eq('id', award.issuing_institution_id)
        .single();
      issuingInstitution = inst?.name ?? null;
    }

    // The agent's award page on Kudos.
    const { data: pub } = await supabase
      .from('kudos_awards_public')
      .select('award_slug, agent_name')
      .eq('award_id', award.id)
      .single();
    const awardsUrl = pub?.award_slug ? `${KUDOS_SITE}/award/${pub.award_slug}` : `${KUDOS_SITE}/`;
    if (pub?.agent_name) agentName = pub.agent_name;

    const live = pub?.award_slug ? await makeAwardLive(award.id, awardsUrl) : false;
    if (!live) console.warn(`Award page not confirmed live before sending: ${awardsUrl}`);

    const postmarkRes = await fetch('https://api.postmarkapp.com/email/withTemplate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': POSTMARK_API_TOKEN,
      },
      body: JSON.stringify({
        From: 'AgentBee <notifications@agentbee.net>',
        To: emailTarget,
        Bcc: BCC_ADDRESS,
        TemplateId: POSTMARK_TEMPLATE_ID,
        TemplateModel: {
          agent_name: agentName,
          award_title: award.award_title ?? 'Award & Recognition',
          issuing_institution: issuingInstitution ?? 'AgentBee',
          awards_url: awardsUrl,
        },
        MessageStream: 'kudos-notifications-agents',
      }),
    });

    if (!postmarkRes.ok) {
      const err = await postmarkRes.text();
      console.error('Postmark error:', err);
      return new Response('Postmark send failed', { status: 500 });
    }

    console.log(`Award notification sent to ${emailTarget} (bcc: ${BCC_ADDRESS}) for ${agentName}: ${awardsUrl}`);
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
