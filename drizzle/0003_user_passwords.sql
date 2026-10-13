ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
ALTER TABLE app_sessions ADD COLUMN password_version INTEGER NOT NULL DEFAULT -1;
