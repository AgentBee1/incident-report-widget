import { verifySession } from './auth.js';
import { uploadToCircle } from './_kudos.js';

// Uploads an award image from the admin/staff widget to Circle file storage. The widget then
// saves the returned url + signedId on the award (evidence_image_url / evidence_image_signed_id),
// so the image shows on the Kudos award page and in the award's Circle post.
//
// Body: the raw image bytes, with the image's Content-Type. Optional ?name=<filename>.
// Env: CIRCLE_API_TOKEN, ADMIN_PASSPHRASE.

const MAX_FILE = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return res.status(401).json({ error: 'Your session has expired. Please reload the widget and log in again.' });

  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Please use a JPG, PNG, WEBP or GIF image.' });

  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_FILE) return res.status(413).json({ error: 'That image is too large. Please keep it under 4 MB.' });
    chunks.push(c);
  }
  if (!size) return res.status(400).json({ error: 'No image received.' });

  try {
    const name = String(req.query?.name || 'award-image').slice(0, 120);
    const { url, signedId } = await uploadToCircle(Buffer.concat(chunks), type, name);
    return res.status(200).json({ ok: true, url, signedId });
  } catch (e) {
    console.error('upload-evidence failed:', e);
    return res.status(502).json({ error: String(e.message || e) });
  }
}
