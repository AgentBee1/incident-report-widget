export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { description, category, severity, reportType } = await req.json();

    if (!description) {
      return new Response(JSON.stringify({ error: 'Missing description' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const prompt = `You are writing a de-identified incident summary for AgentBee, an education agent due diligence platform. This summary will be sent to universities and institutions that are not yet clients (warm and cold leads) as part of a weekly digest email.

The summary must:
- Be 2–4 sentences
- NOT identify the agent, agency name, or any specific individuals by name
- NOT include specific locations, FIR numbers, case numbers, police station names, or other identifying details
- NOT mention specific countries or cities
- Describe the nature and seriousness of the incident in general terms
- Be written in plain, professional English suitable for a university risk team
- Convey the category and severity of the incident without revealing source details

Incident details:
- Category: ${category || 'Not specified'}
- Report type: ${reportType || 'Not specified'}
- Severity: ${severity || 'Not specified'} / 100
- Description: ${description}

Write only the de-identified summary — no preamble, no labels, no explanation.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || response.statusText);
    }

    const result = await response.json();
    const summary = result.content?.[0]?.text?.trim() || '';

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
