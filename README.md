# התיק מוכן

דמו עובד לאיסוף, בדיקה ומעקב אחר מסמכי לקוחות במשרד רואי חשבון. לקוח נשמר פעם אחת, וכל שירות או תקופת דיווח נשמרים כמקרה נפרד עם דרישות, קישור לקוח, סטטוס והיסטוריה משלו.

## כתובות

- דף הבית: `https://waives-io.github.io/Onboarding--Demo/`
- סביבת המשרד: `https://waives-io.github.io/Onboarding--Demo/office.html`
- פורטל לקוח: קישור אישי שנוצר מתוך המקרה ומסתיים ב־`client.html#<token>`
- טופס הקליטה המקורי: `https://waives-io.github.io/Onboarding--Demo/upload.html`
- API: `https://waives-onboarding-intake.autumn-glitter-1f91.workers.dev`

יש להשתמש במסמכים ובפרטי לקוחות פיקטיביים בלבד.

## מבנה המערכת

- GitHub Pages מגיש את `office.html`, `client.html` ו־`upload.html`.
- Cloudflare Worker ב־`worker/portal.mjs` מספק את ה־API. הנתיב `/api/intake` ממשיך להפעיל את `worker/intake.mjs` הקיים.
- Cloudflare D1 הוא מקור האמת ללקוחות, מקרים, דרישות, העלאות, אירועים והתחברויות משרד.
- Make שומר קובץ ב־Google Drive, מוסיף שורה ל־Google Sheets ומחזיר אישור שמירה. ה־Worker מסמן העלאה כ־`stored` רק לאחר שקיבל מזהי Drive ואישור עדכון גיליון.
- קובץ נשמר בתיקיית דרישה. תיקון נשלח לאותה תיקייה ונרשם כגרסה חדשה.

התרחיש הקיים ב־Make הורחב באמצעות Router, בלי להחליף את מסלול הקליטה הישן:

| פעולה | תוצאה |
| --- | --- |
| `upload_document` | יצירת תיקיית דרישה, העלאה, הוספת שורה ל־`Submissions` והחזרת אישור |
| `upload_document_revision` | העלאה לתיקיית הדרישה הקיימת, הוספת שורת גרסה והחזרת אישור |
| `lookup_submission` | חיפוש לפי `submission_id` והחזרת אישור קיים לצורך התאוששות |

העמודות הפעילות בגיליון `Submissions` הן A:O: `submission_id`, `submitted_at`, `client_reference`, `full_name`, `email`, `period`, `document_type`, `requirement_complete`, `file_count`, `processing_status`, `drive_file_ids`, `review_note`, `test_mode`, `note`, `last_updated_at`.

## מודל הנתונים

המיגרציות נמצאות ב־`migrations/`:

- `clients`: רשומה יחידה לכל לקוח; `reference` ייחודי.
- `cases`: שורה לכל טיפול או תקופה; כל מקרה מקושר ללקוח אחד.
- `requirements`: רשימת המסמכים הנדרשים למקרה, כולל סטטוס ותיקיית Drive.
- `uploads`: גרסאות הקבצים ואישור השמירה החיצוני.
- `document_catalog`, `templates`, `template_items`: קטלוג ותבניות למקרים חדשים.
- `events`: יומן פעילות.
- `sessions`, `login_limits`: התחברות משרד והגבלת ניסיונות.

סטטוס המקרה נגזר מהדרישות:

- `collecting`: עדיין חסרים מסמכי חובה.
- `action_required`: המשרד ביקש תיקון.
- `client_completed`: הלקוח סיים וכל מסמכי החובה שמורים, אך הבדיקה טרם הסתיימה.
- `ready_for_work`: כל מסמכי החובה אושרו; גם מסמך רשות שהועלה חייב להיבדק.
- `closed` או `archived`: המקרה נעול עד לפתיחה מחדש.

## אבטחה

- סודות נשמרים רק כ־Cloudflare Worker secrets: `MAKE_WEBHOOK_URL`, `INTAKE_DEMO_CODE`, `OFFICE_CODE`, `PORTAL_LINK_KEY`, `MAKE_BRIDGE_KEY`.
- קישור לקוח הוא capability ייחודי למקרה המבוסס HMAC. רק הגיבוב שלו נשמר ב־D1.
- CORS מאפשר את אתר GitHub Pages בלבד; סביבת פיתוח מקומית מותרת רק מול Worker מקומי.
- קוד המשרד יוצר session אקראי לשמונה שעות ומוגבל לחמישה ניסיונות כניסה בחלון של 15 דקות לכתובת IP.
- סוג, סיומת וחתימת קובץ נבדקים. הגודל המרבי הוא 4 MiB לקובץ.
- קישורי לקוח לא כוללים מזהי Drive, פרטי קשר או מספרי לקוח.
- CSV מיוצא עם הגנה מפני formula injection.

## פיתוח מקומי

נדרש Node.js. אין תלויות npm לפרויקט.

1. יוצרים `.dev.vars` מקומי, שאינו נכלל ב־Git, עם חמשת הסודות.
2. מפעילים את המיגרציות המקומיות:

   ```powershell
   npx wrangler d1 migrations apply files-readiness-demo --local
   ```

3. מפעילים Worker:

   ```powershell
   npx wrangler dev
   ```

4. מגישים את הקבצים הסטטיים בשרת מקומי ופותחים `office.html`.

`portal-config.js` מפנה אוטומטית ל־`http://127.0.0.1:8787` כשדף ה־HTML מוגש מ־localhost, ול־Worker החי בפריסה ציבורית.

## בדיקות

```powershell
node --test test/*.test.mjs
node --check worker/portal.mjs
node --check office.mjs
node --check client.mjs
git diff --check
```

הבדיקות מכסות יצירת token למקרה, חישוב סטטוסים, CSV, אימות קבצים, ה־intake הקיים, CORS, אימות גישה והתנהגות כאשר D1 אינו מוגדר. קובצי הבדיקה ב־`test/fixtures/` סינתטיים.

## פריסה

```powershell
npx wrangler d1 migrations apply files-readiness-demo --remote
npx wrangler deploy
```

GitHub Pages מתפרסם מענף ברירת המחדל של המאגר. אחרי כל פריסה יש לבדוק את `/api/health`, כניסה למשרד, יצירת לקוח, שני מקרים לאותו לקוח, העלאה בכל מקרה, השלמת לקוח, אישור, בקשת תיקון והעלאת גרסה.

## ייבוא וייצוא CSV

ממשק המשרד כולל ייצוא לקוחות או מקרים וייבוא של עד 40 רשומות בפעולה. ייבוא לקוחות דורש לפחות `name` ו־`reference`. ייבוא מקרים דורש `client_id`, `name`, `reporting_period`, `due_date` ו־`template_id`; ניתן לספק `case_id` ייחודי. כל הקובץ נדחה אם אחת השורות אינה תקינה, כדי למנוע ייבוא חלקי.

## פתרון תקלות

- העלאה שמוצגת כ"ממתינה": אין להעלות שוב. במשרד לוחצים "בדיקת שמירה"; הפעולה מחפשת את `submission_id` בגיליון.
- `integration_not_ready`: אחד מסודות Make חסר או `PORTAL_BRIDGE_ENABLED` אינו `true`.
- `origin_denied`: הבקשה לא הגיעה מ־GitHub Pages המורשה או משרת הפיתוח המקומי.
- `too_many_attempts`: ממתינים 15 דקות לפני ניסיון כניסה נוסף.
- קישור לקוח הפסיק לעבוד: בדקו שלא הוחלף `PORTAL_LINK_KEY`; החלפתו מבטלת את כל הקישורים הקיימים.

