#!/usr/bin/env node
// Standalone validator/indexer (used by the scaffolded repo CI): node validate-cli.mjs validate|index [dir] [--check]
import { loadLibrary, writeIndex } from './format.mjs';
const [cmd, ...rest] = process.argv.slice(2), dir = rest.find((a) => !a.startsWith('--')) || '.', check = rest.includes('--check');
if (cmd === 'validate') {
  const r = loadLibrary(dir);
  r.warnings.forEach((w) => console.log(`warn: ${w}`)); r.errors.forEach((e) => console.error(`error: ${e}`));
  console.log(r.errors.length ? `INVALID (${r.errors.length} errors)` : `OK ${r.manifest.name}@${r.manifest.version}: ${r.assets.length} assets`);
  process.exit(r.errors.length ? 1 : 0);
} else if (cmd === 'index') {
  const r = writeIndex(dir, { check });
  r.errors.forEach((e) => console.error(`error: ${e}`));
  console.log(r.ok ? (r.changed.length ? `wrote ${r.changed.join(', ')}` : 'index up to date') : 'FAILED');
  process.exit(r.ok ? 0 : 1);
} else { console.error('usage: validate-cli.mjs validate|index [dir] [--check]'); process.exit(2); }
