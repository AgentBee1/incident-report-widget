export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { description, category, severity, reportType } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role:    'user',
          content: `You are helping prepare a de-identified incident summary for a weekly email digest sent to non-client educational institutions. The email informs them about incidents in the international education agent sector that may be relevant to their risk management.

Please rewrite the following incident description in a de-identified way:
- Remove all agent names, company names, and any identifying details
- Preserve the nature, category, and severity of the incident
- Write in plain, professional language suitable for a compliance/risk email
- Keep it to 2-3 sentences maximum
- Do not use phrases like "an agent" — instead use the sector context e.g. "an education agent operating in [region if mentioned]"

Incident details:
- Category: ${category || 'Not specified'}
- Report type: ${reportType || 'Not specified'}
- Severity: ${severity || 'Not specified'}/100
- Description: ${description}

Respond with only the de-identified summary text, no preamble or explanation.`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await response.json();
    const summary = data.content?.[0]?.text || '';
    return res.status(200).json({ summary });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
