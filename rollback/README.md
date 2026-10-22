# Rolling back the Kudos integration (21 Oct 2026)

Everything changed in the Kudos integration can be put back.

**If you roll back the widget, also roll back the award email function** (row 3). The old
widget stops emails by briefly removing the agent's address; the new email function waits a
few seconds before sending, so with the old widget an unticked box could still send.
Everything else can be rolled back on its own.

| Part | How to roll back |
|---|---|
| **Widget** | Vercel → widget project → Deployments → last deployment before the change → ⋯ → **Instant Rollback**. The code as it was is kept on the `before-kudos-integration` branch. |
| **Kudos site** (kudos.agentbee.net) | Vercel → `kudos-site` project → Deployments → previous deployment → ⋯ → **Instant Rollback**. |
| **Award email function** | Deploy `rollback/award-notification/index.ts` as the `award-notification` Edge Function. |
| **Database functions** | Run `rollback/database-functions.sql` in the Supabase SQL editor. |
| **Postmark email template** | Paste the bodies from `rollback/postmark-template-46464153.md` back into the template. |
| **Circle posting, review queue, all-awards page** | Part of the widget (`api/`, `review.html`, `awards.html`), so they go with the widget rollback. |
| **Daily review summary** | Covered by `rollback/database-functions.sql` (unschedules the job). The `kudos-review-digest` Edge Function can then be deleted in Supabase. |
| **Risk Radar fix + junk-record cleanup** | Run `rollback/risk-radar-fix-2026-10-21.sql`. |
| **Agent-group risk scoring + one alert per group (22 Oct)** | Run `rollback/risk-score-group-fix-2026-10-22.sql`. |

Note: after a widget rollback, any awards still **pending** stay hidden from Kudos. Approve or
reject them first, or set `review_status = 'approved'` on them in Supabase.
