-- 소미도 전시 아이맥 원격 확인(2026-10-21). Supabase 프로젝트 manhwa_viewer(ihecmsgxpfdiizlkdylv)에 적용.
-- 키오스크(index.html?k=키)가 2~15초마다 상태를 somido_report로 보내고, 작가 페이지(monitor.html?k=키)가 somido_watch로 읽는다.
-- 표 셋은 RLS만 켜고 정책 없음 → anon 키로는 직접 못 읽고 못 씀. 함수(security definer)만 열려 있고 함수가 somido_kiosk_keys의 비밀 키를 대조한다.
-- 키 넣기: insert into somido_kiosk_keys(key,label) values ('<비밀키>','전시장 아이맥');  (키는 ~/.config/somido/kiosk_key, 저장소엔 없음)
create table if not exists public.somido_kiosk_keys (key text primary key, label text, created_at timestamptz not null default now());
create table if not exists public.somido_kiosk_state (id text primary key, state jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(), started_at timestamptz);
create table if not exists public.somido_kiosk_events (id bigserial primary key, ts timestamptz not null default now(), type text not null, pid text, cut text, page int, extra jsonb);
create index if not exists somido_kiosk_events_ts on public.somido_kiosk_events (ts desc);
alter table public.somido_kiosk_keys enable row level security;
alter table public.somido_kiosk_state enable row level security;
alter table public.somido_kiosk_events enable row level security;

create or replace function public.somido_report(k text, s jsonb, ev jsonb default '[]'::jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if k is null or not exists (select 1 from somido_kiosk_keys where key = k) then return false; end if;
  insert into somido_kiosk_state (id, state, updated_at, started_at)
    values ('main', s, now(), coalesce((s->>'startedAt')::timestamptz, now()))
    on conflict (id) do update set state = excluded.state, updated_at = now(),
      started_at = case when somido_kiosk_state.state->>'startedAt' is distinct from excluded.state->>'startedAt' then excluded.started_at else somido_kiosk_state.started_at end;
  if jsonb_typeof(ev) = 'array' then
    insert into somido_kiosk_events (type, pid, cut, page, extra)
      select coalesce(e->>'type', '?'), e->>'pid', e->>'cut', nullif(e->>'page', '')::int, e->'extra'
      from (select e from jsonb_array_elements(ev) e limit 50) q;
  end if;
  return true;
end $$;

create or replace function public.somido_watch(k text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st somido_kiosk_state; today_start timestamptz;
begin
  if k is null or not exists (select 1 from somido_kiosk_keys where key = k) then return null; end if;
  select * into st from somido_kiosk_state where id = 'main';
  today_start := (date_trunc('day', now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
  return jsonb_build_object(
    'now', now(), 'updated_at', st.updated_at, 'started_at', st.started_at, 'state', coalesce(st.state, '{}'::jsonb),
    'today', (select jsonb_build_object('events', count(*), 'pins', count(*) filter (where type in ('page', 'cut')), 'first', min(ts), 'last', max(ts))
              from somido_kiosk_events where ts >= today_start),
    'top_pages', (select coalesce(jsonb_agg(jsonb_build_object('page', page, 'n', n) order by n desc), '[]'::jsonb)
                  from (select page, count(*) n from somido_kiosk_events where ts >= today_start and type in ('page', 'cut') and page is not null group by page order by n desc limit 8) t),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h), '[]'::jsonb)
              from (select extract(hour from ts at time zone 'Asia/Seoul')::int h, count(*) n from somido_kiosk_events where ts >= today_start group by 1) q),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('ts', ts, 'type', type, 'page', page, 'cut', cut) order by ts desc), '[]'::jsonb)
               from (select * from somido_kiosk_events order by ts desc limit 30) r),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
             from (select (ts at time zone 'Asia/Seoul')::date d, count(*) n from somido_kiosk_events where type in ('page', 'cut') group by 1 order by 1 desc limit 14) q)
  );
end $$;

revoke all on function public.somido_report(text, jsonb, jsonb) from public;
revoke all on function public.somido_watch(text) from public;
grant execute on function public.somido_report(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.somido_watch(text) to anon, authenticated;
