-- Additive only. Personal logins replace the shared office code.
-- pw holds a JSON record {alg,iter,salt,hash} so the iteration count can change without breaking old passwords.
CREATE TABLE staff (
 staff_id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','manager')), pw TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_seen_at TEXT
);
-- Sessions without a staff member (the old shared code) are no longer accepted.
ALTER TABLE sessions ADD COLUMN staff_id TEXT REFERENCES staff(staff_id);
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
CREATE INDEX sessions_staff ON sessions(staff_id);
-- owner stays as the old free text until the admin maps it to a staff member.
ALTER TABLE cases ADD COLUMN owner_id TEXT REFERENCES staff(staff_id);
CREATE INDEX cases_owner ON cases(owner_id);
ALTER TABLE clients ADD COLUMN created_by TEXT REFERENCES staff(staff_id);
ALTER TABLE events ADD COLUMN actor_type TEXT;
ALTER TABLE events ADD COLUMN actor_id TEXT;
