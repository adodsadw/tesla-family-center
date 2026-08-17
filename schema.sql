CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL DEFAULT 'line',
  source_id TEXT,
  sender_user_id TEXT,
  sender_name TEXT NOT NULL DEFAULT '家人',
  message TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  due_at INTEGER,
  category TEXT NOT NULL DEFAULT 'general',
  notified_at INTEGER,
  completed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created
ON tasks(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_due
ON tasks(status, due_at, notified_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
