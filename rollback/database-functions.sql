-- BACKUP / UNDO SCRIPT for the Kudos integration (21 Oct 2026).
-- Run this in the Supabase SQL editor to restore the database functions exactly as they
-- were before the change. It does NOT drop the new notify_agent column (harmless if left;
-- the old widget simply ignores it). To remove it as well, uncomment the last line.

CREATE OR REPLACE FUNCTION public.notify_award_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.report_type = 'Awards & Recognition' THEN
    PERFORM net.http_post(
      url := 'https://mtatzzrbapftzwuxrcko.supabase.co/functions/v1/award-notification',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'incidents',
        'record', row_to_json(NEW)
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_incident_notification(p_incident_id uuid, p_institution_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inc        incidents%rowtype;
  v_agent_name text;
  v_prefix     text;
  v_icon       text;
  v_event_type text;
  v_severity   text;
  v_title      text;
begin
  select * into v_inc from public.incidents where id = p_incident_id;
  if v_inc.id is null or coalesce(v_inc.is_voided, false) then return false; end if;

  -- client institutions only
  if not exists (select 1 from public.institutions where id = p_institution_id and status = 'Client') then
    return false;
  end if;

  -- dedup: same report already notified to this institution
  if exists (
    select 1 from public.notification_events
    where institution_id = p_institution_id
      and action_url = v_inc.source_url
  ) then
    return false;
  end if;

  select agency_name into v_agent_name from public.agents where id = v_inc.agent_id;

  v_prefix := case v_inc.report_type
    when 'Awards & Recognition' then 'Awards & Recognition —'
    when 'Kudos'                then 'Kudos —'
    when 'Market Intelligence'  then 'Market intelligence —'
    when 'Data Analysis'        then 'Data analysis —'
    when 'Incentivisation'      then 'Incentivisation alert —'
    when 'Aggregator Report'    then 'Aggregator report —'
    when 'Individual Report'    then 'Individual report —'
    when 'Privacy Flag'         then 'Privacy flag —'
    else                             'New incident report —'
  end;

  v_icon := case v_inc.report_type
    when 'Awards & Recognition' then 'ti-trophy'
    when 'Kudos'                then 'ti-thumb-up'
    when 'Market Intelligence'  then 'ti-chart-bar'
    when 'Data Analysis'        then 'ti-chart-bar'
    when 'Privacy Flag'         then 'ti-lock'
    else                             'ti-alert-triangle'
  end;

  v_event_type := case v_inc.report_type when 'Awards & Recognition' then 'award' else 'incident' end;

  if v_inc.report_type = 'Awards & Recognition' and coalesce(v_inc.award_title, '') <> '' then
    v_title := v_prefix || ' ' || v_inc.award_title || ' — ' || coalesce(v_agent_name, 'Unknown agent');
  else
    v_title := v_prefix || ' ' || coalesce(v_agent_name, 'Unknown agent');
  end if;

  v_severity := case
    when v_inc.severity_weight >= 70 then 'high'
    when v_inc.severity_weight >= 40 then 'med'
    when v_inc.severity_weight >= 5  then 'low'
    else 'info'
  end;

  insert into public.notification_events
    (institution_id, event_type, title, action_label, action_url, severity, icon)
  values (p_institution_id, v_event_type, v_title, 'Read report', v_inc.source_url, v_severity, v_icon);

  return true;
end;
$function$;

-- alter table public.incidents drop column if exists notify_agent;
