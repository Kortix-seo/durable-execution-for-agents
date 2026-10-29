-- The journal lives here: one row per run, one row per completed step.
create table if not exists durable_runs (
  run_id     text primary key,
  status     text not null default 'running',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists durable_steps (
  run_id text not null references durable_runs(run_id) on delete cascade,
  seq    int  not null,
  name   text not null,
  result jsonb not null,
  at     timestamptz not null default now(),
  primary key (run_id, seq)
);

-- The domain tables the steps write to. Each key makes the effect idempotent
-- even if the same row is inserted again.
create table if not exists tickets (
  job_id  text primary key,
  subject text not null,
  body    text not null
);

create table if not exists refunds (
  job_id       text primary key,
  intent       text not null,
  amount_cents int  not null
);

create table if not exists outbox (
  job_id  text not null,
  channel text not null,
  body    text not null,
  primary key (job_id, channel)
);

-- Seed the row the first step reads.
insert into tickets (job_id, subject, body)
values ('demo-1', 'Refund for order 88213', 'Charged twice, please refund one charge.')
on conflict (job_id) do nothing;
