-- =============================================
-- 가족캘린더 : 1단계 - 테이블 만들기
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run]
-- (여러 번 실행해도 안전해요. 예전 버전을 실행했어도 다시 실행하면 바뀐 부분만 추가돼요)
-- =============================================

-- 가족 구성원 (이름 2글자, 색상, 알림 설정)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#A9C7FF',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists alert_events  boolean not null default true;   -- 가족 일정 알림 (오전 10시)
alter table public.profiles add column if not exists alert_closing boolean not null default false;  -- 청약 마감 알림 (오전 10시)
alter table public.profiles add column if not exists alert_listing boolean not null default false;  -- 상장 알림 (전날 밤 10시)

-- 일정
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  event_date date not null,          -- 시작일 (알림은 이 날 오전 10시)
  end_date date,                     -- 여러 날 일정일 때 마지막 날 (없으면 하루 일정)
  start_time time,                   -- 시간 (없으면 하루 종일)
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (event_date);

-- 공모주 일정 (구글 캘린더에서 자동으로 채워짐 — 직접 고치지 않아요)
--   kind = 'closing' : 청약 마지막 날 / 'listing' : 상장일
create table if not exists public.ipo_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('closing', 'listing')),
  name text not null,
  event_date date not null
);
alter table public.ipo_events add column if not exists detail text;  -- 알림에 보낼 상세 내용
create index if not exists ipo_events_date_idx on public.ipo_events (event_date);

-- 아이폰별 알림 구독 정보
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------- 보안 규칙 (로그인한 가족만 접근) ----------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.ipo_events enable row level security;

-- 가족 프로필: 모두 볼 수 있고, 자기 것만 만들고 고칠 수 있음
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated using (id = auth.uid());

-- 일정: 가족 모두 보고, 등록은 내 이름으로, 수정·삭제는 가족 누구나
drop policy if exists "events read" on public.events;
create policy "events read" on public.events
  for select to authenticated using (true);
drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events
  for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "events update" on public.events;
create policy "events update" on public.events
  for update to authenticated using (true);
drop policy if exists "events delete" on public.events;
create policy "events delete" on public.events
  for delete to authenticated using (true);

-- 공모주 일정: 가족 모두 보기만 (채우는 건 알림 함수가 함)
drop policy if exists "ipo read" on public.ipo_events;
create policy "ipo read" on public.ipo_events
  for select to authenticated using (true);

-- 알림 구독: 자기 것만
drop policy if exists "subs own" on public.push_subscriptions;
create policy "subs own" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
