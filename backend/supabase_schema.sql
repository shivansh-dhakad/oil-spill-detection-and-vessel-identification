-- ==========================================================================
-- VarunaDrishti – Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ==========================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- predictions
-- Stores every completed oil-spill pipeline result.
-- --------------------------------------------------------------------------
create table if not exists public.predictions (
  -- IDs
  id                    text        primary key,           -- e.g. PRED-2025-001
  job_id                text        unique,                -- ML service job UUID

  -- Input metadata
  sensor                text,
  source_type           text,                              -- 'safe_zip' | 'sar_image'
  original_name         text,

  -- Detection result
  acquired_at           timestamptz not null default now(),
  region_name           text,
  region_lat            double precision,
  region_lon            double precision,
  status                text        not null default 'completed',
  detection             text        not null,              -- 'detected' | 'clean'
  confidence            double precision,
  slick_area_km2        double precision,
  area_is_coverage_pct  boolean     default false,
  model_name            text,
  severity              text,

  -- Environmental snapshot
  weather_wind_kts      double precision,
  weather_wind_dir      text,
  current_ms            double precision,
  current_dir           text,
  spill_origin_time     text,

  -- Attribution summary
  attribution_status    text,
  attribution_statement text,
  disclaimer            text,
  candidates_evaluated  int,
  elapsed_seconds       double precision,

  -- Full structured result blobs (JSONB for queryability)
  candidates            jsonb       default '[]'::jsonb,
  investigation_summary jsonb,
  map_data              jsonb,
  report                jsonb,
  files                 jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Indexes for the most common query patterns
create index if not exists idx_predictions_acquired_at  on public.predictions (acquired_at desc);
create index if not exists idx_predictions_detection    on public.predictions (detection);
create index if not exists idx_predictions_region       on public.predictions (region_name);
create index if not exists idx_predictions_confidence   on public.predictions (confidence);

-- Auto-update updated_at on row changes
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_predictions_updated_at on public.predictions;
create trigger trg_predictions_updated_at
  before update on public.predictions
  for each row execute procedure public.set_updated_at();

-- --------------------------------------------------------------------------
-- Row Level Security for predictions
-- The backend uses the service_role key so it bypasses RLS.
-- --------------------------------------------------------------------------
alter table public.predictions enable row level security;

create policy "service_role full access to predictions"
  on public.predictions
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- --------------------------------------------------------------------------
-- insitu_currents
-- Stores discrete ocean current observations (from Copernicus / Argo / drifters).
-- Replaces the need to deploy the 507MB CSV file along with the web/ML service.
-- --------------------------------------------------------------------------
create table if not exists public.insitu_currents (
  id                    bigint generated always as identity primary key,
  platform_id           text,
  time_str              text,
  timestamp_epoch       double precision not null,
  latitude              double precision not null,
  longitude             double precision not null,
  depth                 double precision default 0.0,
  u_ms                  double precision not null,             -- Eastward velocity (m/s)
  v_ms                  double precision not null,             -- Northward velocity (m/s)
  created_at            timestamptz not null default now()
);

-- Fast spatial, temporal, and depth indexes for drift & attribution queries
create index if not exists idx_insitu_spatial         on public.insitu_currents (latitude, longitude);
create index if not exists idx_insitu_epoch           on public.insitu_currents (timestamp_epoch);
create index if not exists idx_insitu_depth           on public.insitu_currents (depth);
create index if not exists idx_insitu_spatial_time    on public.insitu_currents (latitude, longitude, timestamp_epoch);

-- Enable RLS
alter table public.insitu_currents enable row level security;

-- Allow full access to backend / upload scripts via service_role
create policy "service_role full access to insitu_currents"
  on public.insitu_currents
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- Allow public / anon read-only queries so ML service can fetch currents with anon key
create policy "public read insitu_currents"
  on public.insitu_currents
  as permissive
  for select
  to anon, authenticated
  using (true);
