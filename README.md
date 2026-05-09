# Incident Report Widget — Deployment Guide

## Setup

1. Open `index.html` and find this line near the top of the `<script>` block:
   ```js
   const SUPABASE_KEY = window.SUPABASE_ANON_KEY || '';
   ```
   Replace `''` with your Supabase anon key directly, **or** use Vercel env vars (see below).

## Deploy to Vercel (recommended)

1. Push this folder to a GitHub repo
2. Connect the repo to Vercel
3. In Vercel → Settings → Environment Variables, add:
   - `SUPABASE_ANON_KEY` = `eyJ...your_anon_key...`
4. Add a `vercel.json` if needed (for rewrites), otherwise Vercel serves `index.html` automatically

## Alternative: Direct key injection

Edit `index.html`, find:
```js
const SUPABASE_KEY = window.SUPABASE_ANON_KEY || '';
```
Replace with:
```js
const SUPABASE_KEY = 'eyJ...your_anon_key_here...';
```

## What the widget does

- **Agent search**: Live search against `agents` table with autocomplete
- **Agent lookup**: Fuzzy match and resolve canonical agent record
- **Dropdowns**: report_type, category (enum), source_type (enum), severity_weight (0–100 constrained)
- **Institution analysis**: Pastes a list of institutions, resolves them in Supabase, checks `agent_institution_links` to determine authorised vs risk-radar status
- **Submit**: Inserts into `incidents` table + `incident_institution_links` for all matched institutions
- **Send Comms**: Button placeholder for future notification protocol trigger
