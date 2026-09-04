-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — site diary HSE snapshot
--
-- Adds an optional daily health & safety snapshot to each site diary entry:
-- how many reportable incidents and near-misses there were, the topic of the
-- toolbox talk (if one was held), and free-form safety observations (hazards,
-- PPE issues). All four columns are nullable — an entry without them is simply
-- a diary entry with no HSE record for that day.
--
-- Additive only: no policy changes. The existing site_diary_entries RLS
-- (project members / org staff read; author or manager writes) already covers
-- these columns.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.site_diary_entries
  add column if not exists hse_incidents    integer,  -- reportable incidents that day
  add column if not exists hse_near_misses  integer,  -- near-misses that day
  add column if not exists hse_toolbox_talk text,     -- topic of the toolbox talk held, if any
  add column if not exists hse_notes        text;     -- safety observations / hazards / PPE issues
