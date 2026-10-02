-- "Closed" and "archived" did the same thing. One end state is left: the archive. Reopening still works.
UPDATE cases SET status='archived' WHERE status='closed';
