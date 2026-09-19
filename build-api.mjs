import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('netlify-public', { recursive: true });
writeFileSync('netlify-public/index.html', '<!doctype html><meta charset="utf-8"><title>Waives Onboarding API</title><p>Waives Onboarding API</p>\n');
