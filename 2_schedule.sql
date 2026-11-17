-- =============================================
-- 가족캘린더 : 알림 시간 예약
--   · 매일 오전 10시 : 오늘의 가족 일정 + 오늘 청약 마감 종목
--   · 매일 밤 10시   : 내일 상장 종목
-- 아래 두 군데를 바꾼 뒤 SQL Editor 에서 [Run] (여러 번 실행해도 안전)
--   ① 프로젝트주소  : Project URL (예: https://abcdxyz.supabase.co)
--   ② 크론비밀번호  : Edge Function Secrets 의 CRON_SECRET 과 똑같이
-- =============================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 예전에 만든 예약이 있으면 정리
select cron.unschedule(jobid) from cron.job
 where jobname in ('family-morning-push', 'family-10am', 'family-10pm');

-- Supabase 시계는 UTC 기준 → 한국 시간보다 9시간 느려요
-- UTC 01:00 = 한국 오전 10:00
select cron.schedule('family-10am', '0 1 * * *', $$
  select net.http_post(
    url := '① 프로젝트주소/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '② 크론비밀번호'),
    body := '{"slot":"morning"}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- UTC 13:00 = 한국 밤 10:00
select cron.schedule('family-10pm', '0 13 * * *', $$
  select net.http_post(
    url := '① 프로젝트주소/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '② 크론비밀번호'),
    body := '{"slot":"evening"}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- 확인용: 예약 목록 (family-10am, family-10pm 두 줄이 보이면 성공)
select jobname, schedule from cron.job;

-- 문제가 생기면 최근 실행 기록 보기:
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
