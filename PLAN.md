# Demo review round (02/10/2026): decisions after Codex second opinion
1. Words: לקוח = clients, תיק = cases, סוג תיק = templates. UI and message text only; tables, columns, API paths stay. `{request}` stays as a hidden alias of `{case}`.
2. Board groups, first match wins: (1) מחכה לבדיקה שלך = client_completed OR any stored upload waiting (action "בדיקה"); (2) הלקוח מתעכב = collecting/action_required with warning/urgent/overdue (action "תזכורת"); (3) בתהליך, collapsed. ready_for_work in its own tab; archive apart.
3. Progress is one stable count from the server: docs_received / docs_approved / docs_total (untouched optional docs excluded; "אין לי" not counted as received). Add reviewable_count for the board.
4. CRM, one additive migration: clients.stage (lead/onboarding/active/inactive, default active), client_notes, tasks, events.client_id (backfilled from cases, set on every new event). Landing-page inquiries become stage 'lead' clients; inquiries stays as source record linked by client_id.
5. Managers see notes, tasks and client timeline only for clients where they own a case; admin sees all.

# PLAN: office feedback round 1 (17 items), revised after Codex critique

Delivered in 3 stages, each its own PR + production check. Design (stage 3) by GPT.

## Stage 1: features without auth changes (PR A)
- Rename מקרה/מקרים → תיק/תיקים everywhere (2).
- New-case: searchable client picker over all clients + "פתיחת תיק" from client row (3).
- Dashboard tiles filter by status; tile labels = badge labels (3, 14).
- Template in new case lists only its documents; "+ הוספת מסמך" opens catalog search; remove per row (3).
- Template editor: new template starts empty; one include checkbox + "חובה"; file counter shown only when "כמה קבצים" ticked (4).
- Visible "סגירת תיק" in case header (6).
- Progress by requirement state, not uploads (15): collecting/action_required = required reqs in uploaded|approved (correction excluded) / required;
  client_completed/ready_for_work = approved / (all reqs minus optional-missing). Same formula for list and detail, server-computed.
- Deadline (7): calendar dates in Asia/Jerusalem; days = due − today. overdue <0, urgent 0..U, warning U+1..W, else ok (defaults W=7, U=2,
  validated 0≤U<W). Closed/archived → none. Table-driven tests incl. boundaries.
- WhatsApp: explicit IL phone parser → digits-only 972… or no link; anchor built via DOM/URL; text from read-only reminder formatter
  (no event on render; `reminder_prepared` only on explicit click) (7).
- Client link (8, also review finding 3): token = HMAC(case_id:link_version). Shown on case + client page with copy. "Revoke link" bumps version.
  Migration 0003 adds `cases.link_version INTEGER DEFAULT 1` + token_hash recompute on bump; existing links keep working (v1 = current formula).
- Client edit (16): `POST /api/clients/:id`.
- Settings page (13): office name, size, manager name, phone, email, address, W/U days, WhatsApp template (allowlisted placeholders, length cap).
  Logo: decoded + magic-byte check (png/jpg), ≤200KB decoded, stored in its own table, served by `GET /api/logo` with ETag.
- Client portal: button "שליחת המסמך למשרד לבדיקה" (9); after "סיימתי" re-render into completion state (11).
- Migration order: deploy code with explicit column lists first, then additive migration 0003, then features.

## Stage 2: staff, roles, personal login (PR B), items 13 and 17
- `staff(staff_id, name, email UNIQUE COLLATE NOCASE, role admin|manager, pw record {alg,iter,salt,hash}, active)`.
  sessions get `staff_id`, `auth_type`, `last_seen_at` (throttled 5 min). events get `actor_type` + `actor_id`
  (staff | bootstrap | client | system).
- Bootstrap: OFFICE_CODE works only while no active admin exists; creating the first admin disables it.
- Password: PBKDF2 with iterations benchmarked on the deployed plan (Workers CPU limit); IP throttle before derivation,
  dummy hash for unknown email, per-account limit.
- Deny-by-default authorization for every office route, reads included: manager = cases where owner_id=self and their clients;
  owner forced to self on create; client edit only if all its cases are own, else admin; admin-only settings/staff/catalog/templates/CSV/reassign.
  Session checks staff active + current role each request; deactivate/role change/reset revokes sessions.
- Legacy free-text owner: admin maps each distinct value to a staff member in a one-time screen before enforcement is switched on.
- "Who is in the app": admin list of staff with recent activity.
- Role × route matrix tests.

## Stage 3: design (GPT, ref ezcount.co.il/system-features)
Look & feel (5), asterisks (1), progress faded→strong (10), sticky header (12), right-side menu: תיקים, לקוחות, מסמכים, תבניות, אחראים,
הגדרות (17), deadline colors (7), logo placement (13).

## Risks
Missed read check leaks data → deny-by-default helper + matrix tests. Migration ordering → compatibility deploy first + D1 Time Travel bookmark.
PBKDF2 CPU → benchmark before enabling. Stage gates: each stage verified in production before the next.

## Phase B: sending record, approve all, next case (level 3)
1. Migration 0006 (additive): cases.first_sent_at, last_sent_at, sent_count INTEGER NOT NULL DEFAULT 0, last_channel TEXT.
   One helper markSent(db,caseId,channel,me) -> batch: UPDATE cases (first_sent_at=coalesce(first_sent_at,now), last_sent_at=now, sent_count+1, last_channel) guarded by ownership, + event 'link_sent' (detail=channel, actor staff).
   POST /api/cases/:id/reminder takes optional {channel:'whatsapp'|'email'} and records the send when given (the office opened WhatsApp/email with the text; we cannot confirm delivery, so the record means "prepared and opened by the office").
   POST /api/cases/:id/sent {channel:'copy'} records a copied link. Allowed on active cases only.
   Case list returns the fields; the row shows "נשלח 30.9 · WhatsApp · 2 פעמים" or a "טרם נשלח" marker.
2. POST /api/cases/:id/review-all: approves every requirement in status 'uploaded' that has a stored upload and no pending upload, one batch:
   events (INSERT..SELECT with randomblob ids, actor) before the UPDATE, same idle+ownership guards as single review, then syncCase and completed_at. Returns caseView + approved count. 409 nothing_to_review when zero.
3. Next case (UI only): case page shows "לתיק הבא" when the current case has no document waiting for review and another visible case is client_completed (ordered by due date). Button "אישור הכול (N)" above the documents when N>=2 uploaded.
Tests: markSent counts/first-vs-last, channel validation, manager scope 404, closed case 409; review-all approves only uploaded+stored, skips pending, moves case to ready_for_work, events per doc, ownership race.

## Flows UX (level 3): document picker, send flow, client rows
1. Rows editor: one input (datalist). Picking an existing name adds it at once; a typed new name shows one inline "＋ הוספת 'X' כמסמך חדש" button; Enter adds. No separate label+button.
2. Send dialog in two steps: (a) channel cards showing the destination (WhatsApp → phone, email → address, copy link); a channel without a valid destination is disabled with the reason. (b) editable message preview + one real <a href> (wa.me / mailto) or copy button; the contact is recorded on that click (existing /contacts). Text comes from /reminder; for a case with nothing missing, a plain link message.
3. Client portal: one row per document (name, status, "＋"). "＋" expands an inline panel: file picker (respecting max files / correction), optional note to the office (≤500 chars). Choosing files returns to the row showing the chosen file names; the row's "שליחה" button becomes enabled. Sending uploads as today.
   Migration 0007 (additive): uploads.client_note TEXT. /api/portal/uploads accepts form field `client_note` (clean, ≤500), stored on the upload row; office case page shows it under the file. Not sent to Make.
Tests: client_note stored/trimmed/limit, shown to office only on that case, absent when not given; old clients without the field still work.

## Client file model (level 3), approved by Galli 2026-10-01
Words: "תיק" = the client's file (one per client). "בקשת מסמכים" (short: "בקשה") = what the code calls a case: one period's document collection.
1. Migration 0008 (additive): clients.contact_name TEXT (איש קשר), clients.template_id TEXT (the client's regular document list; must exist, else null).
   clientFields: contact_name (≤120, optional), template_id (optional; 404 template_not_found if given and missing). CSV export adds both.
2. Menu: "לוח עבודה" (today's cases dashboard, unchanged logic), "תיקים" (today's clients page), "הגדרות". Old view keys stay internally.
3. תיקים list: one row per client file: name, company no., contact person, phone, regular list, open requests count + nearest due, "＋ תיק חדש".
   תיק page (showClient): contact card (incl. contact person), regular document list, the requests (periods) with status/due/send, "＋ בקשת מסמכים" prefilled with the client and its regular list.
4. New request dialog (today's new case): title "בקשת מסמכים חדשה"; choosing a client preselects its regular list; "＋ תיק חדש" inline instead of "＋ לקוח חדש".
5. Request page (today's case page): header "<client> · <period>", link "← לתיק של <client>".
6. All UI wording: case→בקשה where it means a period's collection; client→תיק where it means the client record. Tiles/statuses unchanged. Client portal wording unchanged except "תיק" → "בקשה" where it refers to the period.
Tests: client contact_name/template_id validation and round-trip; template_not_found; CSV columns; manager scope unchanged.
