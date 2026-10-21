-- UNDO SCRIPT for the Risk Radar fix and junk-record cleanup (21 Oct 2026).
-- Run in the Supabase SQL editor to put everything back exactly as it was.

-- 1) Restore the auto-link rule (adds 'linked' even when the agent is already authorised).
CREATE OR REPLACE FUNCTION public.auto_link_agent_on_incident_institution_link()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  -- 1) institution_agent_links (drives Risk Radar via link_type='linked')
  insert into public.institution_agent_links (id, institution_id, agent_id, link_type)
  values (gen_random_uuid(), NEW.institution_id, v_canonical, 'linked')
  on conflict (institution_id, agent_id, link_type) do nothing;

  -- 2) agent_institution_links (legacy/write-side table)
  insert into public.agent_institution_links (agent_id, institution_id)
  values (v_canonical, NEW.institution_id)
  on conflict (agent_id, institution_id) do nothing;

  -- 3) notification (client institutions only; deduped on institution + source_url)
  perform public.insert_incident_notification(NEW.incident_id, NEW.institution_id);

  return NEW;
end;
$function$;

-- 2) Restore the "Agent removed" notice (fires on any removal, including Risk Radar rows).
CREATE OR REPLACE FUNCTION public.notify_agent_removed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $function$
declare
  v_agent  agents%rowtype;
  v_title  text;
begin
  select * into v_agent from public.agents where id = OLD.agent_id;

  v_title := 'Agent removed from your network'
    || case when v_agent.agency_name is not null
            then ' — ' || v_agent.agency_name
            else '' end
    || case when v_agent.country is not null
            then ' (' || v_agent.country || ')'
            else '' end;

  insert into public.notification_events
    (institution_id, event_type, title, action_label, action_url, severity, icon)
  values (
    OLD.institution_id,
    'agent',
    v_title,
    'View agent',
    null,
    null,
    'ti-user-minus'
  );

  return OLD;
end;
$function$;

-- 2b) Remove the new rule that clears Risk Radar when an agent becomes authorised.
drop trigger if exists trg_clear_risk_radar_on_authorise on public.institution_agent_links;
drop function if exists public.clear_risk_radar_on_authorise();

-- 3) Put back the 38 Risk Radar rows that were removed.
insert into public.institution_agent_links (id, institution_id, agent_id, link_type, created_at) values
('94094bb1-447b-47f1-a4c3-ada5fac14c26','b77d59f8-46d4-49a3-8793-3bbf4e9c4c37','43310c79-5337-4dd9-8d4a-a6f4fb6c1d36','linked','2026-04-22 19:12:30.146402+00'),
('10f4bb47-423d-48f9-8a79-761f1a54f054','b77d59f8-46d4-49a3-8793-3bbf4e9c4c37','44de4edb-f13f-4e72-b4f5-43ebe229c4cd','linked','2026-04-22 19:12:30.146402+00'),
('033e2b4d-5143-4cbb-bdbc-0dfc9398bf8b','011109d2-5efb-456d-bc6f-549150cb7aaf','a5d93e8b-7912-4beb-9b68-d0a66afd0b31','linked','2026-04-24 23:20:56.477287+00'),
('83092757-9429-44ae-a9a5-d9fb79e97d34','475fbff8-b6e4-4e27-9aa1-224d6a11bd65','9e88bad0-15c7-4070-ad51-3117d2987f10','linked','2026-05-13 20:18:49.372201+00'),
('1ff95ce7-cb0d-46e1-904a-b8e82573d2de','475fbff8-b6e4-4e27-9aa1-224d6a11bd65','43310c79-5337-4dd9-8d4a-a6f4fb6c1d36','linked','2026-05-13 20:18:49.372201+00'),
('47e65f26-c18f-4483-8d9d-a13f11de7d09','4f69c0af-91f9-46be-8688-962ff7c2d111','a5d93e8b-7912-4beb-9b68-d0a66afd0b31','linked','2026-07-17 22:17:56.538884+00'),
('72e98f88-ff0b-432e-b18a-9b298fbad631','b216d1c9-57ea-450f-8939-ec9e8660e5df','d934bd00-2cd7-40c8-b338-f1f2a662cb9f','linked','2026-07-20 21:44:46.559244+00'),
('37f29a3d-7ba7-4f05-9362-c87661907610','7ee71803-4f8f-474a-8c7c-a727266c9586','f3b1941a-8f3c-4d83-948a-bf497ee20677','linked','2026-07-20 21:47:30.732951+00'),
('8fb9f934-329b-47f5-90bd-4a3788f4d1fc','b77d59f8-46d4-49a3-8793-3bbf4e9c4c37','3d4cf16c-4b77-4e0d-bdb7-99b6f6fbf0c6','linked','2026-07-28 20:29:39.223593+00'),
('06ebb1a8-e178-4077-93e0-c227db247ba1','37dab7bb-8b27-4a60-928a-d353a7b3fadb','c35ca46f-9f4f-47ee-8d01-ba464c3bd6d3','linked','2026-07-28 21:25:16.736058+00'),
('e86a4bc8-b270-4e9e-8827-69c55cc7b6e8','ee4ae007-4774-46a2-a38a-1d687c93bae6','8b200dcc-2d16-4547-b868-47849e0b3a91','linked','2026-08-17 19:45:44.088797+00'),
('01d84c4f-e94d-43a6-bf9d-6cb821a38082','37dab7bb-8b27-4a60-928a-d353a7b3fadb','8b200dcc-2d16-4547-b868-47849e0b3a91','linked','2026-08-17 19:45:44.088797+00'),
('c4885364-12dd-4ec1-a5f4-e67aacbe8edf','ee4ae007-4774-46a2-a38a-1d687c93bae6','d26229a5-6e41-4d01-9f8a-b928c9802787','linked','2026-08-22 08:56:57.599464+00'),
('697391fa-a2d6-4a7d-9cfb-11e493d8ba3b','37dab7bb-8b27-4a60-928a-d353a7b3fadb','d26229a5-6e41-4d01-9f8a-b928c9802787','linked','2026-08-22 08:56:57.599464+00'),
('9c09f857-18ed-4690-b660-29431f34c4cb','37dab7bb-8b27-4a60-928a-d353a7b3fadb','84f0a983-963a-4ec5-b7fa-801877519f0b','linked','2026-08-22 23:13:46.126884+00'),
('7ab4f266-5f0e-4e32-b23a-50461fafda37','37dab7bb-8b27-4a60-928a-d353a7b3fadb','7ee3cbc5-3b79-4006-b154-c1dd706e661c','linked','2026-08-28 22:04:56.709829+00'),
('9cf792dd-cc29-4987-974d-dd0e4219da95','ee4ae007-4774-46a2-a38a-1d687c93bae6','cf3ff969-4d5a-48f5-884d-013e2f71a869','linked','2026-08-28 22:15:12.178875+00'),
('22e636e7-ed50-4451-adaf-98eb3df927d8','ee4ae007-4774-46a2-a38a-1d687c93bae6','c06d713a-47d5-44a2-9a1e-4c35403685a2','linked','2026-08-29 20:41:13.055636+00'),
('a5a2e945-1a62-4d47-ba6c-719bbc14fe7a','37dab7bb-8b27-4a60-928a-d353a7b3fadb','c06d713a-47d5-44a2-9a1e-4c35403685a2','linked','2026-08-29 20:41:13.055636+00'),
('fa1865dd-21c3-4726-b237-043f8cea81cf','37dab7bb-8b27-4a60-928a-d353a7b3fadb','3f5d4378-9096-4073-a827-2c25c45e86f0','linked','2026-09-02 21:41:43.690008+00'),
('e343884a-3ab2-4f8d-b61d-157e9e91d263','37dab7bb-8b27-4a60-928a-d353a7b3fadb','98bf9199-e552-493e-bb1d-0a22d54f41fb','linked','2026-09-03 19:25:14.625442+00'),
('5b012ff6-df43-498e-a4eb-2eaf725c4ba1','8f7666a8-f03d-47ca-bce9-dda8e432cee3','af4376f8-e593-4e90-a0aa-7d3c3a808ea1','linked','2026-09-05 19:54:23.363066+00'),
('706df5b6-1a77-4403-a174-90a79473d34d','37dab7bb-8b27-4a60-928a-d353a7b3fadb','af4376f8-e593-4e90-a0aa-7d3c3a808ea1','linked','2026-09-05 19:54:23.363066+00'),
('9168bac2-00d4-42cf-8290-68d895b77c5e','37dab7bb-8b27-4a60-928a-d353a7b3fadb','222c6e40-e9c2-4293-85bb-80089e77c9fc','linked','2026-09-06 21:41:17.414434+00'),
('82f136c9-ab13-4978-b42a-77c9b1d4a7f6','ee4ae007-4774-46a2-a38a-1d687c93bae6','222c6e40-e9c2-4293-85bb-80089e77c9fc','linked','2026-09-06 21:41:17.414434+00'),
('8c06950a-8c07-42ad-92c1-344bf8190afc','ee4ae007-4774-46a2-a38a-1d687c93bae6','86b85420-7c0c-4bcf-87df-38efaf717bf0','linked','2026-09-09 21:42:52.157573+00'),
('9d264a41-e993-4671-86d5-7efb662730c4','37dab7bb-8b27-4a60-928a-d353a7b3fadb','86b85420-7c0c-4bcf-87df-38efaf717bf0','linked','2026-09-09 21:42:52.157573+00'),
('957ccf06-c4ea-43c4-8c66-52115ee5e73b','ee4ae007-4774-46a2-a38a-1d687c93bae6','ff65c4ae-c4ea-4aa8-b9ab-f53ad02e0f22','linked','2026-09-11 19:03:47.090946+00'),
('31b0c98d-d431-47f7-8a3e-35dd27c41f9f','8f7666a8-f03d-47ca-bce9-dda8e432cee3','d934bd00-2cd7-40c8-b338-f1f2a662cb9f','linked','2026-09-12 05:25:16.617463+00'),
('cc444274-cb2c-4319-94c7-94514b1d3765','011109d2-5efb-456d-bc6f-549150cb7aaf','b1c6fd09-f91f-404c-b1e0-f9821d456507','linked','2026-09-12 08:03:24.04551+00'),
('49dc5848-c514-43a4-9bf3-7b6aa6d09197','8f7666a8-f03d-47ca-bce9-dda8e432cee3','f2413bbd-4cad-40a6-aba3-6d6a57b99703','linked','2026-09-12 22:29:36.67758+00'),
('3cc64e17-93af-437b-b39d-bcb85990009c','011109d2-5efb-456d-bc6f-549150cb7aaf','f2413bbd-4cad-40a6-aba3-6d6a57b99703','linked','2026-09-12 22:29:36.67758+00'),
('2a2307b2-211e-46db-b8a8-08389723941d','37dab7bb-8b27-4a60-928a-d353a7b3fadb','4e3069eb-fdab-41cf-9d8e-72cc33fc6bf7','linked','2026-09-22 20:48:55.814839+00'),
('4bb64356-78e3-49af-b10f-4f5116a45227','b77d59f8-46d4-49a3-8793-3bbf4e9c4c37','3ef5257c-6589-420e-8ced-db44c2332621','linked','2026-09-23 20:44:51.864434+00'),
('f6f98dab-b9a4-4f49-b0d6-90846169e712','37dab7bb-8b27-4a60-928a-d353a7b3fadb','3ef5257c-6589-420e-8ced-db44c2332621','linked','2026-09-23 20:44:51.864434+00'),
('c4a80b00-5e6e-4bfc-9917-31f78f77f238','8f7666a8-f03d-47ca-bce9-dda8e432cee3','3ef5257c-6589-420e-8ced-db44c2332621','linked','2026-09-23 20:44:51.864434+00'),
('9a567725-5677-44a5-b74a-3a99b9d0109b','011109d2-5efb-456d-bc6f-549150cb7aaf','468c3902-5fbf-4f39-9815-8225087e086a','linked','2026-09-28 00:24:10.595723+00'),
('85ca801c-c51d-478e-9184-0202344a1119','37dab7bb-8b27-4a60-928a-d353a7b3fadb','0131bd6d-7254-4d1e-9ec5-a46185eb3aa5','linked','2026-10-16 18:35:32.898036+00')
on conflict do nothing;

-- 4) Un-void the four junk records.
update public.incidents
set is_voided = false, voided_at = null, void_reason = null
where id in ('978e7e4c-1c0d-4cb2-9297-346f509a19a9','6e706fda-80a7-440f-ba7f-50754b8dfbf6',
             '0b8118fc-ea3f-4313-9c18-7a0abb848b9b','68685758-0748-4a92-af3a-1009d79bca82');
