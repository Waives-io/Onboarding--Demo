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
