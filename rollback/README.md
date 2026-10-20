# Rolling back the Kudos integration (21 Oct 2026)

Everything changed in the Kudos integration can be put back. Each part can be rolled back
on its own. **Rolling back the widget alone is always safe**: the new email function still
works with the old widget.

| Part | How to roll back |
|---|---|
| **Widget** | Vercel → widget project → Deployments → last deployment before the change → ⋯ → **Instant Rollback**. The code as it was is kept on the `before-kudos-integration` branch. |
| **Kudos site** (kudos.agentbee.net) | Vercel → `kudos-site` project → Deployments → previous deployment → ⋯ → **Instant Rollback**. |
| **Award email function** | Deploy `rollback/award-notification/index.ts` as the `award-notification` Edge Function. |
| **Database functions** | Run `rollback/database-functions.sql` in the Supabase SQL editor. |
| **Postmark email template** | Paste the bodies from `rollback/postmark-template-46464153.md` back into the template. |
| **Circle posting function** | Delete the `kudos-circle-post` Edge Function in Supabase (the old widget never calls it). |
