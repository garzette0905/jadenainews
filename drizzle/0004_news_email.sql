ALTER TABLE users ADD COLUMN news_email_enabled INTEGER NOT NULL DEFAULT 0 CHECK (news_email_enabled IN (0, 1));
