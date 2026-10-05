-- Each case type says how it asks for a period: none, one year, one month, or a range of months.
ALTER TABLE templates ADD COLUMN period_kind TEXT NOT NULL DEFAULT 'none' CHECK(period_kind IN ('none','year','month','range'));
UPDATE templates SET period_kind='year' WHERE name LIKE 'דוח שנתי%' OR name IN ('אישור יתרות שנתי','החזר מס – שכיר');
UPDATE templates SET period_kind='month' WHERE name='הנהלת חשבונות חודשית';
UPDATE templates SET period_kind='range' WHERE name='דיווח תקופתי למע״מ';
-- How many days a client gets to submit documents. The suggested date for every new case.
ALTER TABLE settings ADD COLUMN due_days INTEGER NOT NULL DEFAULT 14;
