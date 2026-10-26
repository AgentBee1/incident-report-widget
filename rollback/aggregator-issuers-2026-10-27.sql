-- Rollback for migration `kudos_aggregator_issuers` (27 Oct 2026).
-- Adds back the pre-aggregator view and drops the new columns/constraints.
-- Run only if no aggregator awards need keeping: awards with issuing_agent_id set
-- will lose their issuer.

create or replace view public.kudos_awards_public with (security_invoker = false) as
 SELECT i.id AS award_id,
    (kudos_slugify((ca.agency_name || ' '::text) || i.award_title) || '-'::text) || "left"(i.id::text, 6) AS award_slug,
    i.award_title,
    i.incident_date AS award_date,
    ca.id AS agent_id,
    ca.agency_name AS agent_name,
    kudos_slugify(ca.agency_name) AS agent_slug,
    ca.country AS agent_country,
    ca.website AS agent_website,
    ca.logo_url AS agent_logo_url,
    COALESCE(ca.is_kudos_client, false) AS is_kudos_client,
    inst.name AS issuer_name,
    inst.country AS issuer_country,
    i.original_source_url AS source_url,
    COALESCE(i.reviewed_at, i.created_at) AS created_at
   FROM incidents i
     JOIN agents a ON a.id = i.agent_id
     JOIN agents ca ON ca.id = COALESCE(a.canonical_agent_id, a.id)
     LEFT JOIN institutions inst ON inst.id = i.issuing_institution_id
  WHERE i.award_title IS NOT NULL AND i.award_title <> ''::text AND COALESCE(i.is_voided, false) = false AND i.review_status = 'approved'::text;
-- Note: CREATE OR REPLACE can't drop columns; if this errors, DROP VIEW first and re-grant:
--   drop view public.kudos_awards_public;  (then the create above)
--   grant select on public.kudos_awards_public to anon, authenticated;

alter table public.incidents drop constraint if exists incidents_issuer_not_recipient_chk;
alter table public.incidents drop constraint if exists incidents_single_issuer_chk;
drop index if exists public.incidents_issuing_agent_id_idx;
alter table public.incidents drop column if exists issuing_agent_id;
alter table public.agents drop column if exists is_aggregator;
notify pgrst, 'reload schema';
