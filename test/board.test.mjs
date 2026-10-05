import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, defaultPeriod, periodOf, alignRange, caseName, addDays, yearChoices } from '../board.mjs';

test('waiting for review means the client finished, or said they do not have a document', () => {
  // Finished.
  assert.equal(groupOf({ status: 'client_completed', deadline: 'ok' }), 'review');
  // One of two documents arrived, nothing marked as missing: still on the way, not in review.
  assert.equal(groupOf({ status: 'collecting', deadline: 'ok', reviewable_count: 1, unavailable: 0 }), 'progress');
  assert.equal(groupOf({ status: 'collecting', deadline: 'overdue', reviewable_count: 1, unavailable: 0 }), 'late');
  assert.equal(groupOf({ status: 'collecting', deadline: 'warning', reviewable_count: 0 }), 'late');
  // "I don't have this document", waiting for the office's answer.
  assert.equal(groupOf({ status: 'collecting', deadline: 'overdue', unavailable: 1 }), 'review');
  assert.equal(groupOf({ status: 'ready_for_work' }), 'ready');
  assert.equal(groupOf({ status: 'archived', unavailable: 1 }), 'archive');
});

test('the period of a new case follows the case type', () => {
  const today = '2026-10-05';
  assert.deepEqual(defaultPeriod('none', today), {});
  assert.deepEqual(periodOf('none'), { start: null, end: null, label: '' });
  assert.deepEqual(periodOf('year', defaultPeriod('year', today)), { start: '2025-01-01', end: '2025-12-31', label: '2025' });
  assert.deepEqual(periodOf('month', defaultPeriod('month', today)), { start: '2026-09-01', end: '2026-09-30', label: '09/2026' });
  assert.deepEqual(periodOf('month', { y: 2025, m: 0 }), { start: '2025-01-01', end: '2025-12-31', label: '2025' });
  assert.equal(periodOf('month', { y: 2024, m: 2 }).end, '2024-02-29');
  assert.deepEqual(periodOf('range', defaultPeriod('range', today)), { start: '2026-08-01', end: '2026-09-30', label: '08/2026–09/2026' });
  // January: the last two finished months cross the year.
  assert.deepEqual(defaultPeriod('range', '2027-01-10'), { fy: 2026, fm: 11, ty: 2026, tm: 12 });
  assert.deepEqual(alignRange({ fy: 2026, fm: 9, ty: 2026, tm: 7 }), { fy: 2026, fm: 9, ty: 2026, tm: 9 });
  assert.deepEqual(yearChoices(today), [2026, 2025, 2024, 2023]);
});

test('case names: the type alone, or the type and a period that reads left to right', () => {
  assert.equal(caseName('הצהרת הון', ''), 'הצהרת הון');
  assert.equal(caseName('דוח שנתי', '2025'), 'דוח שנתי 2025');
  assert.equal(caseName('מע״מ', '07/2026–08/2026'), 'מע״מ ⁦07/2026–08/2026⁩');
  assert.equal(addDays('2026-10-05', 10), '2026-10-15');
});
