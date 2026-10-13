ALTER TABLE users ADD COLUMN login_id TEXT;
CREATE UNIQUE INDEX users_login_id ON users(login_id COLLATE NOCASE);
CREATE TABLE app_sessions (token_hash TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);
CREATE TABLE login_attempts (client_hash TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
