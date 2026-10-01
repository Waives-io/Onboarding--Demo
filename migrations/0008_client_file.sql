-- Additive only. A client is the office's "תיק": a contact person and the client's regular document list.
-- name stays the file or business name; contact_name is the person messages greet (falls back to name).
ALTER TABLE clients ADD COLUMN contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN regular_template_id TEXT REFERENCES templates(template_id) ON DELETE SET NULL;
