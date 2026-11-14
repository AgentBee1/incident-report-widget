import { verifySession } from './auth.js';

// Login-checked proxy to Supabase for the admin and staff pages (15 Nov 2026).
//
// The pages used to call Supabase directly with the public anon key, which meant anyone with
// that key could also write to these tables. Now every request comes here with the x-session
// token from /api/auth; it is checked and forwarded with the service key. Only the tables and
// methods the pages actually use are allowed.
//
// Request:  /api/db?p=<encoded PostgREST path + query>, e.g. p=agents%3Fid%3Deq.<uuid>
// Rollback: revert the PR that added this file (pages go back to direct anon-key calls).
//
// Env: SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSPHRASE.

const SUPABASE_URL = 'https://mtatzzrbapftzwuxrcko.supabase.co';

const READ_TABLES = new Set([
  'accreditations', 'agents', 'incidents', 'incident_institution_links', 'incident_accreditation_links',
  'institution_agent_links', 'institutions', 'kudos_awards_public',
]);
const WRITE_TABLES = new Set([
  'agents', 'incidents', 'incident_institution_links', 'incident_accreditation_links',
  'institution_agent_links', 'institutions',
]);
const METHODS = new Set(['GET', 'POST', 'PATCH']);
const PASS_HEADERS = ['prefer', 'range', 'range-unit', 'accept'];

const fail = (res, status, message) => res.status(status).json({ message, error: message });

export default async function handler(req, res) {
  const method = req.method;
  if (!METHODS.has(method)) return fail(res, 405, 'Method not allowed');

  const role = verifySession(req.headers['x-session'], process.env.ADMIN_PASSPHRASE);
  if (!role) return fail(res, 401, 'Your session has expired. Please reload and log in again.');

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return fail(res, 500, 'SUPABASE_SERVICE_ROLE_KEY is not set in this Vercel project.');

  const p = typeof req.query.p === 'string' ? req.query.p : '';
  const [table, query = ''] = p.split(/\?(.*)/s);
  if (!/^[a-z_]+$/.test(table)) return fail(res, 400, 'Invalid table');

  const allowed = method === 'GET' ? READ_TABLES : WRITE_TABLES;
  if (!allowed.has(table)) return fail(res, 403, `${method} on ${table} is not allowed`);

  // An unfiltered PATCH would update every row; the pages always filter by id.
  if (method === 'PATCH' && !/(^|&)[a-z_]+=[a-z]+\./.test(query)) {
    return fail(res, 400, 'PATCH requires a filter');
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  for (const h of PASS_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];

  const init = { method, headers };
  if (method !== 'GET' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, init);
    const text = await upstream.text();
    for (const h of ['content-type', 'content-range']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    return res.status(upstream.status).send(text);
  } catch (e) {
    return fail(res, 502, `Supabase request failed: ${e.message || e}`);
  }
}
