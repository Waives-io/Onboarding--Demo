-- Additive only. The reporting period becomes a date range; reporting_period keeps the display text.
ALTER TABLE cases ADD COLUMN period_start TEXT;
ALTER TABLE cases ADD COLUMN period_end TEXT;
