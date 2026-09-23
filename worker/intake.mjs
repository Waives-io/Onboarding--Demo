const allowedOrigin = 'https://waives-io.github.io';
const types = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      ...(origin === allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    },
  });
}

async function sameSecret(actual, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function scalar(data, name, max) {
  const values = data.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length > max) return null;
  return values[0].trim();
}

function correctSignature(bytes, extension) {
  if (extension === 'pdf') return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  if (extension === 'png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (origin !== allowedOrigin) return json(403, { error: 'origin_denied' });
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Invite-Code',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      } });
    }
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/api/intake') {
      return json(404, { error: 'not_found' }, origin);
    }

    const webhook = env.MAKE_WEBHOOK_URL;
    const invite = env.INTAKE_DEMO_CODE;
    if (!webhook || !invite || invite.length < 24) return json(503, { error: 'not_configured' }, origin);
    let target;
    try { target = new URL(webhook); } catch { return json(503, { error: 'not_configured' }, origin); }
    if (target.protocol !== 'https:' || !/^hook(?:\.[a-z0-9-]+)?\.make\.com$/.test(target.hostname) ||
        target.username || target.password || target.search || target.hash) {
      return json(503, { error: 'not_configured' }, origin);
    }

    const code = req.headers.get('X-Invite-Code') || '';
    if (!code || code.length > 128 || !(await sameSecret(code, invite))) {
      return json(403, { error: 'invalid_invite' }, origin);
    }
    const length = Number(req.headers.get('Content-Length') || 0);
    if (length > 4_800_000) return json(413, { error: 'too_large' }, origin);
    if (!req.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;')) {
      return json(415, { error: 'multipart_required' }, origin);
    }

    let data;
    try { data = await req.formData(); } catch { return json(400, { error: 'invalid_form' }, origin); }
    const id = scalar(data, 'submission_id', 64);
    const submittedAt = scalar(data, 'submitted_at', 40);
    const fullName = scalar(data, 'full_name', 100);
    const email = scalar(data, 'email', 254);
    const client = scalar(data, 'client_reference', 64);
    const period = scalar(data, 'period', 7);
    const kind = scalar(data, 'document_type', 32);
    const note = scalar(data, 'note', 1000);
    const complete = scalar(data, 'requirement_complete', 5);
    if (scalar(data, 'schema_version', 1) !== '1' || scalar(data, 'test_mode', 4) !== 'true' ||
        scalar(data, 'file_count', 1) !== '1' ||
        !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        !submittedAt || !Number.isFinite(Date.parse(submittedAt)) ||
        !fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !client || !/^[A-Za-z0-9_-]{1,64}$/.test(client) ||
        !period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !kind || !['expenses', 'sales_report', 'bank_statement'].includes(kind) ||
        note === null || !['true', 'false'].includes(complete || '')) {
      return json(400, { error: 'invalid_fields' }, origin);
    }
    const attachments = [...data.entries()].filter(([key]) => /^file_\d+$/.test(key));
    if (attachments.length !== 1 || attachments[0][0] !== 'file_1' || !(attachments[0][1] instanceof File)) {
      return json(400, { error: 'one_file_required' }, origin);
    }
    const file = attachments[0][1];
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!Object.hasOwn(types, extension) || !file.name || file.name.length > 180 ||
        file.size < 8 || file.size > 4 * 1024 * 1024) {
      return json(400, { error: 'invalid_file' }, origin);
    }
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!correctSignature(signature, extension)) return json(400, { error: 'invalid_file' }, origin);

    const forward = new FormData();
    for (const [key, value] of Object.entries({
      schema_version: '1', submission_id: id, submitted_at: submittedAt, full_name: fullName,
      email, client_reference: client, period, document_type: kind, note,
      requirement_complete: complete, test_mode: 'true', file_count: '1',
    })) forward.set(key, value);
    forward.set('file_1', file, file.name);
    try {
      const response = await fetch(target, {
        method: 'POST', body: forward, redirect: 'manual', signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) return json(502, { error: 'upstream_rejected', submission_id: id }, origin);
      let receipt;
      try { receipt = await response.json(); } catch {}
      if (receipt?.status === 'stored' && receipt.submission_id === id) {
        return json(200, { status: 'stored', submission_id: id }, origin);
      }
      return json(202, { status: 'accepted', submission_id: id }, origin);
    } catch {
      return json(502, { error: 'upstream_unconfirmed', submission_id: id }, origin);
    }
  },
};
