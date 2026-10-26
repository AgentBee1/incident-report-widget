-- ROLLBACK: legacy agent_institution_links retirement (27 Oct 2026)
-- Run top to bottom. Restores the table name, the original 3 views and the original auto-link trigger function.

-- 1) Restore table name
alter table public.agent_institution_links_legacy rename to agent_institution_links;

-- 2) Restore original views (drop first: the new versions have an extra link_type column)
drop view if exists public.agent_dashboard;
drop view if exists public.agent_incidents;
drop view if exists public.agents_to_scan;

create view public.agent_dashboard as
 SELECT a.id,
    a.id AS agent_id,
    a.agency_name,
    a.jurisdiction,
    a.country,
    a.website,
    a.risk_score,
    a.risk_tier,
    a.trajectory,
    a.last_reviewed_at,
    ail.institution_id,
    i.name AS institution_name,
    ail.authorised_date,
    ail.is_active,
    count(inc.id) AS incident_count
   FROM (((agents a
     JOIN agent_institution_links ail ON ((ail.agent_id = a.id)))
     JOIN institutions i ON ((i.id = ail.institution_id)))
     LEFT JOIN incidents inc ON ((inc.agent_id = a.id)))
  GROUP BY a.id, a.agency_name, a.jurisdiction, a.country, a.website, a.risk_score, a.risk_tier, a.trajectory, a.last_reviewed_at, ail.institution_id, i.name, ail.authorised_date, ail.is_active;

create view public.agent_incidents as
 SELECT inc.id AS incident_id,
    inc.agent_id,
    a.agency_name,
    inc.incident_date,
    inc.category,
    inc.report_type,
    inc.severity_weight,
    inc.description,
    inc.source_url,
    inc.privacy_risk,
    inc.privacy_type,
    inc.source_type,
    inc.created_at,
    ail.institution_id
   FROM ((incidents inc
     JOIN agents a ON ((a.id = inc.agent_id)))
     JOIN agent_institution_links ail ON ((ail.agent_id = inc.agent_id)));

create view public.agents_to_scan as
 SELECT DISTINCT a.id,
    a.agency_name,
    a.risk_tier,
    a.last_reviewed_at,
    a.risk_score
   FROM (agents a
     JOIN agent_institution_links ail ON ((ail.agent_id = a.id)))
  WHERE (ail.is_active = true)
  ORDER BY a.last_reviewed_at NULLS FIRST;

grant all on public.agent_dashboard, public.agent_incidents, public.agents_to_scan to anon, authenticated;

-- 3) Restore original auto-link trigger function
CREATE OR REPLACE FUNCTION public.auto_link_agent_on_incident_institution_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_incident  incidents%rowtype;
  v_canonical uuid;
begin
  select * into v_incident from public.incidents where id = NEW.incident_id;
  if v_incident.id is null then return NEW; end if;

  select coalesce(canonical_agent_id, id) into v_canonical
  from public.agents where id = v_incident.agent_id;
  if v_canonical is null then return NEW; end if;

  if not exists (
    select 1 from public.institution_agent_links
    where institution_id = NEW.institution_id and agent_id = v_canonical and link_type = 'authorised'
  ) then
    insert into public.institution_agent_links (id, institution_id, agent_id, link_type)
    values (gen_random_uuid(), NEW.institution_id, v_canonical, 'linked')
    on conflict (institution_id, agent_id, link_type) do nothing;
  end if;

  insert into public.agent_institution_links (agent_id, institution_id)
  values (v_canonical, NEW.institution_id)
  on conflict (agent_id, institution_id) do nothing;

  perform public.insert_incident_notification(NEW.incident_id, NEW.institution_id);

  return NEW;
end;
$function$;

-- 4) Backfill links created while the table was renamed
insert into public.agent_institution_links (agent_id, institution_id)
select distinct coalesce(a.canonical_agent_id, a.id), l.institution_id
from public.incident_institution_links l
join public.incidents i on i.id = l.incident_id
join public.agents a on a.id = i.agent_id
where l.created_at >= '2026-10-27'
on conflict (agent_id, institution_id) do nothing;

-- 5) Widget: git revert the widget commit in AgentBee1/incident-report-widget
