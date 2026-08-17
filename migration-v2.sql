-- Tesla Family Center v2 migration
-- Run this ONCE on the existing tesla-family-center-db database.

ALTER TABLE tasks ADD COLUMN due_at INTEGER;
ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE tasks ADD COLUMN notified_at INTEGER;
ALTER TABLE tasks ADD COLUMN completed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_due
ON tasks(status, due_at, notified_at);

CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
