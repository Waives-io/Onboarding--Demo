// Pure rules shared by the office page and the worker: which board group a case is in, and the period of a new case.
// No DOM here, so the tests can import it.

export const LATE = ['warning', 'urgent', 'overdue'];

// Which group a case belongs to. First match wins, so every open case lands in exactly one place.
// "Waiting for your review" means the client is done, or the client said they don't have a document and waits for an answer.
// A client who sent only some of the documents is still on the way: late (near or past the date) or in progress.
export const groupOf = c => ['closed', 'archived'].includes(c.status) ? 'archive'
  : c.status === 'ready_for_work' ? 'ready'
  : c.status === 'client_completed' || Number(c.unavailable) > 0 && ['collecting', 'action_required'].includes(c.status) ? 'review'
  : LATE.includes(c.deadline) ? 'late' : 'progress';

// How a case type asks for its period.
export const PERIOD_KINDS = { none: 'בלי תקופה', year: 'שנה', month: 'חודש', range: 'מחודש עד חודש' };
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// The current year and three back.
export const yearChoices = today => { const y = +today.slice(0, 4); return [y, y - 1, y - 2, y - 3]; };

// The suggested choice, from today (YYYY-MM-DD): last year, last month, or the last two months that ended.
export function defaultPeriod(kind, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const back = n => { const d = new Date(Date.UTC(y, m - 1 - n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
  if (kind === 'year') return { y: y - 1 };
  if (kind === 'month') return back(1);
  if (kind === 'range') { const a = back(2), b = back(1); return { fy: a.y, fm: a.m, ty: b.y, tm: b.m }; }
  return {};
}

// "To" never comes before "from": a later "from" pulls "to" along.
export const alignRange = p => p.ty * 12 + p.tm < p.fy * 12 + p.fm ? { ...p, ty: p.fy, tm: p.fm } : p;

// The dates and the short label of a choice. For a month, m=0 means the whole year.
export function periodOf(kind, p = {}) {
  const year = y => ({ start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) });
  const month = (y, m) => ({ start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${lastDay(y, m)}`, label: `${pad(m)}/${y}` });
  if (kind === 'year' && p.y) return year(p.y);
  if (kind === 'month' && p.y) return p.m ? month(p.y, p.m) : year(p.y);
  if (kind === 'range' && p.fy && p.ty) {
    const r = alignRange(p), a = month(r.fy, r.fm), b = month(r.ty, r.tm);
    return { start: a.start, end: b.end, label: a.label === b.label ? a.label : `${a.label}–${b.label}` };
  }
  return { start: null, end: null, label: '' };
}

// The case name: the type, then the period. A period with slashes is a left-to-right island, so "07/2026–08/2026" never flips.
export const caseName = (type, label) => !label ? type : label.includes('/') ? `${type} ⁦${label}⁩` : `${type} ${label}`;

// A date some days after another, both YYYY-MM-DD.
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
