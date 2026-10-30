import { sb, uploadToCircle } from './_kudos.js';

// Public award submission (submit-award.html). No login: the Supabase key stays here, and
// every row is forced to review_status 'pending' so nothing goes live until the admin
// approves it in review.html.
//
// Evidence is a link, an image or a PDF (or a link plus a file). Uploads go to Circle file
// storage: images are saved as evidence_image_url (shown on Kudos and in the Circle post),
// PDFs as original_source_url when no link was given.
//
// Env: SUPABASE_ANON_KEY, CIRCLE_API_TOKEN (both already set for this project).

const MAX_FILE = 4 * 1024 * 1024;
const MAX_BODY = MAX_FILE + 64 * 1024;
const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const MIN_FILL_MS = 3000; // faster than this is a bot

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  let form;
  try {
    form = await readForm(req);
  } catch (e) {
    const big = e.code === 'TOO_LARGE';
    return res.status(big ? 413 : 400).json({ error: big ? 'That file is too large. Please keep it under 4 MB.' : 'Could not read the submitted form.' });
  }

  const text = (k, max = 200) => String(form.get(k) || '').trim().slice(0, max);
  const businessName = text('businessName');
  const awardTitle = text('awardTitle');
  const awardedBy = text('awardedBy');
  const awardDate = text('awardDate', 10);
  const awardLink = text('awardLink', 1000);
  const file = form.get('awardFile');
  const hasFile = file && typeof file === 'object' && file.size > 0;

  // Bots: honeypot filled, or submitted impossibly fast. Pretend it worked.
  if (text('website') || Number(form.get('elapsed') || 0) < MIN_FILL_MS) {
    console.warn('submit-award: bot check tripped, discarding');
    return res.status(200).json({ ok: true });
  }

  if (form.get('confirmNotRobot') !== 'yes') return res.status(400).json({ error: 'Please tick the box to confirm before submitting.' });
  if (!businessName) return res.status(400).json({ error: 'Please enter your business name.' });
  if (!awardTitle) return res.status(400).json({ error: 'Please enter the name of the award.' });
  if (!awardedBy) return res.status(400).json({ error: 'Please tell us who gave you the award.' });
  if (!hasFile && !isUrl(awardLink)) return res.status(400).json({ error: 'Please paste a full link to your award (starting with https://), or upload a file.' });
  if (hasFile && file.size > MAX_FILE) return res.status(413).json({ error: 'That file is too large. Please keep it under 4 MB.' });
  if (hasFile && !FILE_TYPES.includes(file.type)) return res.status(400).json({ error: 'Please upload a JPG, PNG, WEBP, GIF or PDF file.' });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // YYYY-MM-DD
  const date = /^\d{4}-\d{2}-\d{2}$/.test(awardDate) && awardDate <= today ? awardDate : today;

  try {
    const isImage = hasFile && file.type.startsWith('image/');
    const upload = hasFile ? await uploadToCircle(Buffer.from(await file.arrayBuffer()), file.type, file.name) : null;
    const linkOk = isUrl(awardLink);
    const sourceUrl = linkOk ? awardLink : (upload && !isImage ? upload.url : null);
    const agentId = await matchAgent(businessName);
    const instId = await matchInstitution(awardedBy);

    await sb('incidents', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agent_id: agentId,
        requested_agent_name: businessName,
        report_type: 'Awards & Recognition',
        category: 'Reputational',
        severity_weight: 0,
        source_type: 'agentbee_report',
        incident_date: date,
        award_title: awardTitle,
        issuing_institution_id: instId,
        original_source_url: sourceUrl,
        evidence_image_url: isImage ? upload.url : null,
        evidence_image_signed_id: isImage ? upload.signedId : null,
        description: `${businessName} received "${awardTitle}" from ${awardedBy}. Submitted via the public Kudos form${hasFile ? ` (uploaded ${file.type === 'application/pdf' ? 'PDF' : 'image'})` : ''}${awardDate ? '' : '; date not given'}.`,
        notify_agent: false,
        review_status: 'pending',
        submitted_by: 'Public Kudos form',
        submitted_role: null,
      }),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('submit-award failed:', e);
    return res.status(502).json({ error: 'Could not save your award right now. Please try again shortly, or let AgentBee know if this keeps happening.' });
  }
}

// Body is read by hand (no formidable in this project) and parsed with the built-in
// Request/FormData, which handles multipart and urlencoded.
async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) { const e = new Error('too large'); e.code = 'TOO_LARGE'; throw e; }
    chunks.push(c);
  }
  return new Request('http://local/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] || '' },
    body: Buffer.concat(chunks),
  }).formData();
}

function isUrl(v) {
  try { const u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.'); } catch { return false; }
}

// Exact (case-insensitive) name match only, filed under the main brand. Anything fuzzier
// is left for the admin to pick at review.
async function matchAgent(name) {
  if (/[*%_,()]/.test(name)) return null;
  const rows = await sb(`agents?agency_name=ilike.${encodeURIComponent(name)}&select=id,canonical_agent_id&limit=2`);
  if (rows.length !== 1) return null;
  return rows[0].canonical_agent_id || rows[0].id;
}

async function matchInstitution(name) {
  if (/[*%_,()]/.test(name)) return null;
  const rows = await sb(`institutions?name=ilike.${encodeURIComponent(name)}&select=id&limit=2`);
  return rows.length === 1 ? rows[0].id : null;
}
