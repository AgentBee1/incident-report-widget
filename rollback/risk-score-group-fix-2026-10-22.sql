-- UNDO SCRIPT for the agent-group risk scoring fix (22 Oct 2026).
-- Restores the previous scorer, which scored only the incidents filed directly against
-- the record being recalculated. Note: scores already recalculated stay as they are
-- until the next recalculation (the nightly safety net at 01:30 UTC re-scores everything).

CREATE OR REPLACE FUNCTION public.recalculate_agent_risk_for_agent(p_agent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_raw_score NUMERIC := 0;
  v_final_score INTEGER;
  v_tier TEXT;
  v_color TEXT;
  v_cap NUMERIC := 220;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      severity_weight,
      incident_date,
      category
    FROM incidents
    WHERE agent_id = p_agent_id
      AND is_voided = false
  LOOP
    DECLARE
      v_recency_mult NUMERIC;
      v_category_mult NUMERIC;
      v_months_ago NUMERIC;
    BEGIN
      v_months_ago := EXTRACT(EPOCH FROM (NOW() - rec.incident_date)) / 2592000.0;

      IF v_months_ago < 12 THEN
        v_recency_mult := 2.0;
      ELSIF v_months_ago < 36 THEN
        v_recency_mult := 1.5;
      ELSE
        v_recency_mult := 1.0;
      END IF;

      IF rec.category ILIKE '%regulatory%' THEN
        v_category_mult := 1.5;
      ELSIF rec.category ILIKE '%conduct%' OR rec.category ILIKE '%ethics%' THEN
        v_category_mult := 1.3;
      ELSIF rec.category ILIKE '%reputational%' THEN
        v_category_mult := 1.1;
      ELSE
        v_category_mult := 1.0;
      END IF;

      v_raw_score := v_raw_score + (rec.severity_weight * v_recency_mult * v_category_mult);
    END;
  END LOOP;

  v_final_score := LEAST(100, ROUND((v_raw_score / v_cap) * 100));

  IF v_final_score >= 60 THEN
    v_tier := '🔴 Red';
    v_color := '#DC2626';
  ELSIF v_final_score >= 25 THEN
    v_tier := '🟠 Amber';
    v_color := '#D97706';
  ELSE
    v_tier := '🟢 Green';
    v_color := '#16A34A';
  END IF;

  UPDATE agents
  SET risk_score = v_final_score,
      risk_tier  = v_tier,
      risk_tier_color = v_color
  WHERE id = p_agent_id;

  -- Propagate to variant agents that point at this one as their canonical record,
  -- so branch/regional agents stay in sync with their parent's score.
  -- (Propagation added 2026-08-21; risk_tier_color added to both updates 2026-08-21
  -- to fix drift against the value the agent-monitoring cron job cohorts on.)
  UPDATE agents
  SET risk_score = v_final_score,
      risk_tier  = v_tier,
      risk_tier_color = v_color
  WHERE canonical_agent_id = p_agent_id;

END;
$function$;

-- Restore the previous risk alert rule (one alert per changed record, including each
-- branch record, so an institution could get several alerts for the same agent group).
CREATE OR REPLACE FUNCTION public.notify_agent_risk_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
declare
  v_link      record;
  v_direction text;
  v_severity  text;
  v_title     text;
begin
  if NEW.risk_tier = OLD.risk_tier then return NEW; end if;
  if NEW.risk_score > OLD.risk_score then
    v_direction := 'risk-up';
  else
    v_direction := 'risk-down';
  end if;
  v_title := 'Risk classification changed for ' || NEW.agency_name
    || ' — ' || coalesce(OLD.risk_tier, 'Unknown')
    || ' to ' || coalesce(NEW.risk_tier, 'Unknown');
  for v_link in
    select institution_id from public.institution_agent_links where agent_id = NEW.id
  loop
    insert into public.notification_events
      (institution_id, event_type, title, action_label, action_url, severity, icon)
    values (v_link.institution_id, 'risk', v_title, 'View risk profile', null, v_direction,
      case when v_direction = 'risk-up' then 'ti-trending-up' else 'ti-trending-down' end);
  end loop;
  return NEW;
end;
$function$;

-- 18 duplicate risk alerts from 22 Oct were hidden, not deleted. To show them again:
-- update public.notification_events set is_visible = true
--   where event_type = 'risk' and is_visible = false and created_at::date = '2026-10-22';
