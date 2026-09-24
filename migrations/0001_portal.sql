PRAGMA foreign_keys = ON;
CREATE TABLE clients (
 client_id TEXT PRIMARY KEY, name TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
 business_number TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'active', tags TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE cases (
 case_id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(client_id), name TEXT NOT NULL,
 type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', reporting_period TEXT NOT NULL, due_date TEXT NOT NULL,
 owner TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','action_required','client_completed','ready_for_work','closed','archived')),
 drive_folder_id TEXT, token_hash TEXT NOT NULL UNIQUE, client_completed_at TEXT, completed_at TEXT, closed_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_activity TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE document_catalog (document_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE templates (template_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE template_items (template_id TEXT NOT NULL REFERENCES templates(template_id) ON DELETE CASCADE, document_id TEXT NOT NULL REFERENCES document_catalog(document_id), required INTEGER NOT NULL DEFAULT 1, max_files INTEGER NOT NULL DEFAULT 1 CHECK(max_files BETWEEN 1 AND 20), position INTEGER NOT NULL, PRIMARY KEY(template_id,document_id));
CREATE TABLE requirements (
 requirement_id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(case_id), document_id TEXT REFERENCES document_catalog(document_id),
 name TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 1, max_files INTEGER NOT NULL DEFAULT 1 CHECK(max_files BETWEEN 1 AND 20), position INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'missing' CHECK(status IN ('missing','uploaded','correction','approved')), correction_message TEXT NOT NULL DEFAULT ''
);
CREATE TABLE uploads (
 submission_id TEXT PRIMARY KEY, requirement_id TEXT NOT NULL REFERENCES requirements(requirement_id),
 filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, content_hash TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','stored','failed')), drive_file_id TEXT, drive_folder_id TEXT,
 version INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), stored_at TEXT,
 UNIQUE(requirement_id,version)
);
CREATE TABLE events (event_id TEXT PRIMARY KEY, case_id TEXT REFERENCES cases(case_id), action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX cases_client ON cases(client_id);
CREATE INDEX cases_filters ON cases(status,category,reporting_period,due_date,owner);
CREATE INDEX requirements_case ON requirements(case_id,position);
CREATE INDEX uploads_requirement ON uploads(requirement_id,state,version);
CREATE UNIQUE INDEX upload_pending_lock ON uploads(requirement_id) WHERE state='pending';
CREATE INDEX events_case_time ON events(case_id,created_at);
CREATE INDEX session_expiry ON sessions(expires_at);
INSERT INTO document_catalog VALUES ('expenses','מסמכי הוצאות','חשבוניות וקבלות לתקופה',1),('sales','דוח מכירות','סיכום המכירות לתקופה',1),('bank','תדפיס בנק','תדפיס מלא לתקופה',1),('annual','אישור יתרות שנתי','אישור יתרות לסוף השנה',1);
INSERT INTO templates VALUES ('monthly','הנהלת חשבונות חודשית'),('annual','דוח שנתי');
INSERT INTO template_items VALUES ('monthly','expenses',1,10,0),('monthly','sales',1,1,1),('monthly','bank',1,3,2),('annual','annual',1,3,0),('annual','bank',1,3,1);
