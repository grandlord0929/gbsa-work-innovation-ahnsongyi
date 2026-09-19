-- GBSA 지능형 통합 업무 리마인더 — Supabase(PostgreSQL) 스키마
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여 넣고 Run.
-- 여러 번 실행해도 안전합니다(IF NOT EXISTS). 데이터를 지우지 않습니다.

-- 사원 (엑셀 employees.xlsx 대체)
create table if not exists public.employees (
  emp_no     text primary key,
  name       text not null,
  dept       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_employees_dept on public.employees (dept);

-- 제출요청 (관리자가 발송하는 요청 1건)
create table if not exists public.requests (
  id             bigint generated always as identity primary key,
  title          text not null,
  cat            text not null check (cat in ('service', 'edu', 'doc')),
  requester_dept text not null,
  target_dept    text not null,
  due            date not null,
  created_at     timestamptz not null default now()
);

-- 업무 체크리스트 (사원별 1행)
create table if not exists public.tasks (
  id         bigint generated always as identity primary key,
  cat        text not null check (cat in ('service', 'edu', 'doc')),
  title      text not null,
  dept       text not null,                              -- 요청부서
  assignee   text not null default '전체 직원',
  due        date not null,
  status     text not null default 'normal' check (status in ('normal', 'warn', 'urgent', 'overdue', 'done')),
  source_raw text,
  emp_no     text not null references public.employees (emp_no) on delete cascade,
  emp_name   text not null,
  emp_dept   text not null,
  request_id bigint references public.requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_emp     on public.tasks (emp_no);
create index if not exists idx_tasks_request on public.tasks (request_id);
create index if not exists idx_tasks_status  on public.tasks (status);

-- 제출 이력 (수료증 OCR 결과 포함)
create table if not exists public.submissions (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks (id) on delete cascade,
  file_name      text,
  course_name    text,
  issuer         text,
  completed_date text,
  ocr_text       text,
  match_method   text,
  submitted_at   timestamptz not null default now()
);
create index if not exists idx_submissions_task on public.submissions (task_id);

-- AI 매니저 대화 로그
create table if not exists public.chat_logs (
  id         bigint generated always as identity primary key,
  question   text not null,
  answer     text not null,
  created_at timestamptz not null default now()
);

-- 보안: 모든 테이블에 RLS 를 켜고 정책을 만들지 않는다.
--  → anon / authenticated 키로는 어떤 데이터도 읽거나 쓸 수 없고,
--    서버(백엔드)가 사용하는 service_role 키만 접근할 수 있다. (service_role 은 RLS 를 우회)
alter table public.employees   enable row level security;
alter table public.requests    enable row level security;
alter table public.tasks       enable row level security;
alter table public.submissions enable row level security;
alter table public.chat_logs   enable row level security;

revoke all on public.employees, public.requests, public.tasks, public.submissions, public.chat_logs from anon, authenticated;
