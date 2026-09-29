-- Additive only. Old code keeps working against this schema.
ALTER TABLE cases ADD COLUMN link_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 office_name TEXT NOT NULL DEFAULT '', office_size TEXT NOT NULL DEFAULT '', manager_name TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 warning_days INTEGER NOT NULL DEFAULT 7, urgent_days INTEGER NOT NULL DEFAULT 2,
 whatsapp_template TEXT NOT NULL DEFAULT '', logo_version INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(urgent_days>=0 AND urgent_days<warning_days AND warning_days<=60)
);
INSERT INTO settings(id) VALUES (1);
CREATE TABLE logo (id INTEGER PRIMARY KEY CHECK(id=1), mime TEXT NOT NULL, data TEXT NOT NULL);
