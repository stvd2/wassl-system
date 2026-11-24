-- 005_atomic_registration_and_conversations.sql
-- Transactional primitives used only by the trusted server API.
begin;

create table if not exists public.wasl_api_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  primary key (key_hash, window_start)
);
alter table public.wasl_api_rate_limits enable row level security;
revoke all on public.wasl_api_rate_limits from public, anon, authenticated;
grant all on public.wasl_api_rate_limits to service_role;

create or replace function public.wasl_consume_rate_limit(p_key_hash text, p_limit integer default 5, p_window_seconds integer default 900)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.wasl_api_rate_limits(key_hash, window_start, hit_count)
  values (p_key_hash, v_window, 1)
  on conflict (key_hash, window_start)
  do update set hit_count = public.wasl_api_rate_limits.hit_count + 1
  returning hit_count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function public.wasl_append_auth_notification(\n  p_request_id uuid, p_full_name text, p_employee_number text, p_tracking_no text\n) returns void\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $\ndeclare\n  v_notification jsonb;\nbegin\n  v_notification := jsonb_build_object(\n    'id', 'N_AUTH_' || p_request_id::text, 'role', 'admin', 'user_id', null,\n    'referral_id', null, 'title', 'طلب تسجيل موظف جديد',\n    'message', p_full_name || ' (' || p_employee_number || ') — ' || p_tracking_no,\n    'type', 'user_registration', 'read', false, 'created_at', now(), 'from_user', 'النظام'\n  );\n  update public.app_state\n  set data = jsonb_set(\n    coalesce(data, '{}'::jsonb), '{notifications}',\n    (select coalesce(jsonb_agg(item), '[]'::jsonb)\n     from (select value as item\n           from jsonb_array_elements(coalesce(data->'notifications','[]'::jsonb) || jsonb_build_array(v_notification)) with ordinality as n(value, ord)\n           order by ord desc limit 1000) retained),\n    true\n  ), updated_at = now()\n  where id = 'main';\nend;\n$;\n\ncreate or replace function public.wasl_create_conversation(
  p_creator uuid, p_type text, p_title text, p_member_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_members jsonb;
  v_ids uuid[];
begin
  if p_creator is null or p_type not in ('direct','group') then
    raise exception 'invalid conversation request' using errcode = '22023';
  end if;
  select array_agg(distinct member_id) into v_ids
  from unnest(coalesce(p_member_ids, array[]::uuid[]) || array[p_creator]) as requested(member_id);
  if p_type = 'direct' and coalesce(array_length(v_ids,1),0) <> 2 then
    raise exception 'direct conversation requires two members' using errcode = '22023';
  end if;
  if p_type = 'group' and coalesce(array_length(v_ids,1),0) < 2 then
    raise exception 'group conversation requires another member' using errcode = '22023';
  end if;

  insert into public.conversations(conversation_type,title,created_by)
  values (p_type, nullif(left(trim(coalesce(p_title,'')),200),''), p_creator)
  returning * into v_conversation;

  insert into public.conversation_members(conversation_id,user_id,member_role)
  select v_conversation.id, member_id,
         case when member_id = p_creator then 'owner' else 'member' end
  from unnest(v_ids) as requested(member_id);

  select jsonb_agg(jsonb_build_object(
    'conversation_id', conversation_id,
    'user_id', user_id,
    'member_role', member_role,
    'joined_at', joined_at
  ) order by user_id)
  into v_members
  from public.conversation_members
  where conversation_id = v_conversation.id;

  return jsonb_build_object(
    'conversation', to_jsonb(v_conversation),
    'members', coalesce(v_members,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.wasl_consume_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.wasl_consume_rate_limit(text,integer,integer) to service_role;
revoke all on function public.wasl_append_auth_notification(uuid,text,text,text) from public, anon, authenticated;\ngrant execute on function public.wasl_append_auth_notification(uuid,text,text,text) to service_role;\nrevoke all on function public.wasl_create_conversation(uuid,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.wasl_create_conversation(uuid,text,text,uuid[]) to service_role;

commit;
