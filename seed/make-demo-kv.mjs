// Builds seed/demo-kv.json from seed/demo-files/*.pdf so the office preview shows the demo documents.
// Run: node seed/make-demo-kv.mjs, then: npx wrangler kv bulk put seed/demo-kv.json --binding FILES --remote
// The keys match the seeded uploads (file:<submission_id>), like a real upload. The JSON is generated, not committed.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = new URL('./demo-files/', import.meta.url), list = JSON.parse(readFileSync(new URL('./demo-files.json', import.meta.url), 'utf8'));
const have = new Set(readdirSync(dir)), out = [];
for (const f of list) {
  const name = f.submission_id + '.pdf'; if (!have.has(name)) continue;
  out.push({ key: 'file:' + f.submission_id, value: readFileSync(new URL(name, dir)).toString('base64'), base64: true, metadata: { mime: 'application/pdf', filename: f.doc + '.pdf' } });
}
writeFileSync(new URL('./demo-kv.json', import.meta.url), JSON.stringify(out));
console.log(out.length + ' files');
