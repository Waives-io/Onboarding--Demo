-- Requests from before personal logins that nobody claimed go to the first active office manager.
-- The office no longer maps old free-text owners by hand.
UPDATE cases SET owner_id=(SELECT staff_id FROM staff WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1),
 owner=(SELECT name FROM staff WHERE role='admin' AND active=1 ORDER BY created_at LIMIT 1)
WHERE owner_id IS NULL AND EXISTS(SELECT 1 FROM staff WHERE role='admin' AND active=1);
