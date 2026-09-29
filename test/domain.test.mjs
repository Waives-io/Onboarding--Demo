import test from 'node:test';
import assert from 'node:assert/strict';
import { caseToken, deriveStatus, hash, parseCSV, toCSV, validateFile } from '../worker/domain.mjs';

test('case tokens are deterministic per case and do not reveal the secret', async () => {
  const secret = 'a'.repeat(32);
  const first = await caseToken('case-1', secret);
  assert.equal(first, await caseToken('case-1', secret));
  assert.notEqual(first, await caseToken('case-2', secret));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(await hash(first), first);
});

test('case status follows requirement state without contradictions', () => {
  const base = [{ required: 1, status: 'uploaded' }, { required: 1, status: 'approved' }];
  assert.equal(deriveStatus(base, false), 'collecting');
  assert.equal(deriveStatus(base, true), 'client_completed');
  assert.equal(deriveStatus(base.map(r => ({ ...r, status: 'approved' })), true), 'ready_for_work');
  assert.equal(deriveStatus([{ required: 1, status: 'correction' }], true), 'action_required');
  assert.equal(deriveStatus(base, true, 'archived'), 'archived');
});

test('optional documents follow review semantics', () => {
  assert.equal(deriveStatus([
    { required: 1, status: 'approved' }, { required: 0, status: 'missing' },
  ], true), 'ready_for_work');
  assert.equal(deriveStatus([
    { required: 1, status: 'approved' }, { required: 0, status: 'uploaded' },
  ], true), 'client_completed');
});

test('file validation checks extension, MIME and signature', async () => {
  const good = new File(['%PDF-1.7\nsynthetic'], 'demo.pdf', { type: 'application/pdf' });
  const { filename, mime, size } = await validateFile(good);
  assert.deepEqual({ filename, mime, size }, { filename: 'demo.pdf', mime: 'application/pdf', size: good.size });
  await assert.rejects(() => validateFile(new File(['not-a-pdf-file'], 'demo.pdf', { type: 'application/pdf' })), /invalid_file_signature/);
  await assert.rejects(() => validateFile(new File(['%PDF-1.7'], 'demo.exe', { type: 'application/octet-stream' })), /invalid_file_type/);
});

test('CSV parsing handles quotes and export neutralizes formulas', () => {
  assert.deepEqual(parseCSV('name,reference\r\n"Acme, Ltd",A-1\r\n'), [{ name: 'Acme, Ltd', reference: 'A-1' }]);
  const csv = toCSV([{ name: '=HYPERLINK("https://bad")', reference: 'A-1' }], ['name', 'reference']);
  assert.match(csv, /'=HYPERLINK/);
  assert.deepEqual(parseCSV(csv), [{ name: '\'=HYPERLINK("https://bad")', reference: 'A-1' }]);
});

test('CSV import rejects malformed and duplicate headers', () => {
  assert.throws(() => parseCSV('name,name\nA,B'), /invalid_csv/);
  assert.throws(() => parseCSV('name,reference\n"unterminated,A-1'), /invalid_csv/);
});

test('deadline state uses calendar days with exclusive boundaries', async () => {
  const { deadlineState } = await import('../worker/domain.mjs');
  const at = due => deadlineState(due, 'collecting', '2026-09-28', 7, 2).deadline;
  assert.equal(at('2026-09-27'), 'overdue');
  assert.equal(at('2026-09-28'), 'urgent');
  assert.equal(at('2026-09-30'), 'urgent');
  assert.equal(at('2026-10-01'), 'warning');
  assert.equal(at('2026-10-05'), 'warning');
  assert.equal(at('2026-10-06'), 'ok');
  assert.equal(deadlineState('2026-09-01', 'closed', '2026-09-28').deadline, 'none');
  assert.equal(deadlineState('2026-09-01', 'ready_for_work', '2026-09-28').deadline, 'none');
});

test('local date follows Israel time around midnight and DST', async () => {
  const { localDate } = await import('../worker/domain.mjs');
  assert.equal(localDate(new Date('2026-09-27T21:30:00Z')), '2026-09-28');
  assert.equal(localDate(new Date('2026-09-27T20:30:00Z')), '2026-09-27');
  assert.equal(localDate(new Date('2026-01-15T22:30:00Z')), '2026-01-16');
});

test('only Israeli mobile numbers become WhatsApp numbers', async () => {
  const { israeliMobile } = await import('../worker/domain.mjs');
  for (const input of ['050-123-4567', '0501234567', '+972 50 123 4567', '00972501234567', '972501234567', '(050) 1234567'])
    assert.equal(israeliMobile(input), '972501234567', input);
  for (const input of ['', null, '03-1234567', '050123456', '"><script>', '0501234567 ext 2', '+1 212 555 0100'])
    assert.equal(israeliMobile(input), null, String(input));
});

test('progress counts sent documents while collecting and approvals afterwards', async () => {
  const { caseProgress } = await import('../worker/domain.mjs');
  const reqs = [
    { required: 1, status: 'uploaded' }, { required: 1, status: 'correction' }, { required: 1, status: 'missing' },
    { required: 0, status: 'missing' }, { required: 0, status: 'uploaded' },
  ];
  assert.deepEqual(caseProgress('collecting', reqs), { progress_kind: 'sent', progress_done: 1, progress_total: 3 });
  const done = [{ required: 1, status: 'approved' }, { required: 1, status: 'uploaded' }, { required: 0, status: 'missing' }];
  assert.deepEqual(caseProgress('client_completed', done), { progress_kind: 'approved', progress_done: 1, progress_total: 2 });
  assert.deepEqual(caseProgress('ready_for_work', [{ required: 1, status: 'approved' }, { required: 0, status: 'missing' }]), { progress_kind: 'approved', progress_done: 1, progress_total: 1 });
});

test('link version 1 matches the original token and a new version differs', async () => {
  const { caseLinkToken } = await import('../worker/domain.mjs');
  const secret = 's'.repeat(32);
  assert.equal(await caseLinkToken('case-1', 1, secret), await caseToken('case-1', secret));
  assert.notEqual(await caseLinkToken('case-1', 2, secret), await caseToken('case-1', secret));
});
