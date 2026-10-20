// BACKUP of the award-notification Edge Function (version 4) as it was before the
// Kudos integration (21 Oct 2026). To restore: deploy this file as the
// `award-notification` function (Supabase dashboard → Edge Functions, or `supabase functions deploy`).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const POSTMARK_API_TOKEN = Deno.env.get('POSTMARK_API_TOKEN')!;
const POSTMARK_TEMPLATE_ID = 46464153;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BCC_ADDRESS = 'notifications@agentbee.net';

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, record } = payload;

    if (type !== 'INSERT') {
      return new Response('Ignored: not an INSERT', { status: 200 });
    }

    if (record.report_type !== 'Awards & Recognition') {
      return new Response('Ignored: not an award', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, agency_name, email, canonical_agent_id')
      .eq('id', record.agent_id)
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
    if (record.issuing_institution_id) {
      const { data: inst } = await supabase
        .from('institutions')
        .select('name')
        .eq('id', record.issuing_institution_id)
        .single();
      issuingInstitution = inst?.name ?? null;
    }

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
          award_title: record.award_title ?? 'Award & Recognition',
          issuing_institution: issuingInstitution ?? 'AgentBee',
          awards_url: 'https://agentbee.net/kudos/',
        },
        MessageStream: 'kudos-notifications-agents',
      }),
    });

    if (!postmarkRes.ok) {
      const err = await postmarkRes.text();
      console.error('Postmark error:', err);
      return new Response('Postmark send failed', { status: 500 });
    }

    console.log(`Award notification sent to ${emailTarget} (bcc: ${BCC_ADDRESS}) for agent ${agentName}`);
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
