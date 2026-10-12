CREATE TABLE users (
  email TEXT PRIMARY KEY NOT NULL,
  user_id TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner','viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','disabled')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
