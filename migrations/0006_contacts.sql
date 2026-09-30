-- Additive only. Each time the office opens WhatsApp or email with the link, or copies the link, one row.
-- We cannot see whether the message was actually sent, so this records the office's attempt, not delivery.
-- send_id comes from the browser, so a double click or a retry stays one row.
CREATE TABLE contacts (
 send_id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(case_id),
 channel TEXT NOT NULL CHECK(channel IN ('whatsapp','email','copy')), actor_id TEXT REFERENCES staff(staff_id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX contacts_case_time ON contacts(case_id,created_at);
