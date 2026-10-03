-- Additive only. A short code opens the client's link: client.html#<code> asks the worker for the full token.
-- The code changes when the office revokes the link, so an old short link stops working with the old token.
ALTER TABLE cases ADD COLUMN short_code TEXT;
CREATE UNIQUE INDEX cases_short_code ON cases(short_code) WHERE short_code IS NOT NULL;
