create table if not exists public.order_syncs (
  bling_order_id text primary key,
  trello_card_id text not null,
  trello_card_url text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_syncs_created_at on public.order_syncs (created_at desc);

create table if not exists public.sync_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  scanned integer not null,
  eligible integer not null,
  created integer not null,
  skipped integer not null,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
