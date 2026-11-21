// Asset-library format: load + validate (untrusted-input safe), content hashing, deterministic INDEX.json / INDEX.md.
// Self-contained (only sibling modules + schemas/) so it can be copied into a library repo as tools/library/.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema-lite.mjs';
import { LIMITS, isSafeRel, readInside, readJson, resolveInside, sha256, stableJson, walkTree } from './safe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const loadSchema = (n) => JSON.parse(readFileSync(join(here, 'schemas', n), 'utf8'));
export const SCHEMAS = { library: loadSchema('library.schema.json'), asset: loadSchema('asset.schema.json'), index: loadSchema('index.schema.json'), registry: loadSchema('registry.schema.json'), lock: loadSchema('lock.schema.json') };
export const ASSET_TYPES = SCHEMAS.library.properties.assetTypes.items.enum;
export const FORMAT_VERSION = 1;
const NEEDS_PREVIEW = new Set(['sprite', 'character', 'tileset', 'sfx', 'song', 'fx', 'font']);

/** Content hash of an asset: sha256 over sorted "path\0sha256\n" lines (independent of descriptor metadata). */
export const assetHash = (files) => sha256(Buffer.from([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}\0${f.sha256}\n`).join('')));

/** Read files of an asset dir and return the files[] + hash for a descriptor. */
export function fingerprint(assetDir, paths) {
  const files = [...new Set(paths)].sort().map((p) => { const b = readInside(assetDir, p); return { path: p, sha256: sha256(b), bytes: b.length }; });
  return { files, hash: assetHash(files) };
}

const cmpVer = (a, b) => { const p = (v) => v.split(/[-+]/)[0].split('.').map(Number); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
/** Does semver `v` satisfy a simple range ("1.2.3", "^1.2.0", "~1.2.0", ">=1.0.0", "*")? */
export function satisfies(v, range) {
  if (!range || range === '*') return true;
  const m = /^([\^~]|>=)?(\d+\.\d+\.\d+)/.exec(range); if (!m) return false;
  const [op, base] = [m[1] || '', m[2]], c = cmpVer(v, base), [bM, bm] = base.split('.').map(Number), [vM, vm] = v.split('.').map(Number);
  if (op === '>=') return c >= 0;
  if (op === '^') return c >= 0 && (bM > 0 ? vM === bM : vm === bm);
  if (op === '~') return c >= 0 && vM === bM && vm === bm;
  return c === 0;
}

/**
 * Load and validate a library directory.
 * -> { dir, manifest, assets: [{ id, dir, descriptor }], errors: string[], warnings: string[] }
 */
export function loadLibrary(dir) {
  const root = resolve(dir), errors = [], warnings = [], assets = [];
  let manifest = null;
  const err = (m) => errors.push(m);
  if (!existsSync(root)) return { dir: root, manifest, assets, errors: [`not found: ${root}`], warnings };
  const tree = walkTree(root); tree.problems.forEach(err);
  try { manifest = readJson(join(root, 'library.json')); } catch (e) { err(`library.json: ${e.message}`); return { dir: root, manifest: null, assets, errors, warnings, bytes: tree.bytes }; }
  validateSchema(SCHEMAS.library, manifest).forEach((m) => err(`library.json ${m}`));
  const adir = join(root, 'assets');
  let ids = [];
  if (existsSync(adir)) {
    if (lstatSync(adir).isSymbolicLink()) err('assets/ is a symlink'); else ids = readdirSync(adir).filter((n) => { try { return lstatSync(join(adir, n)).isDirectory(); } catch { return false; } }).sort();
  }
  if (ids.length > LIMITS.maxAssets) { err(`more than ${LIMITS.maxAssets} assets`); ids = ids.slice(0, LIMITS.maxAssets); }
  const seen = new Set();
  for (const id of ids) {
    const d = join(adir, id), where = `assets/${id}`;
    let desc;
    try { desc = readJson(join(d, 'asset.json')); } catch (e) { err(`${where}/asset.json: ${e.message}`); continue; }
    const before = errors.length;
    validateSchema(SCHEMAS.asset, desc).forEach((m) => err(`${where}/asset.json ${m}`));
    if (errors.length > before) continue;
    if (desc.id !== id) err(`${where}: id "${desc.id}" does not match directory name`);
    if (seen.has(desc.id)) err(`${where}: duplicate id ${desc.id}`); seen.add(desc.id);
    if (manifest && Array.isArray(manifest.assetTypes) && !manifest.assetTypes.includes(desc.type)) err(`${where}: type ${desc.type} not listed in library.json assetTypes`);
    const paths = new Set();
    for (const f of desc.files) {
      if (!isSafeRel(f.path)) { err(`${where}: unsafe file path ${JSON.stringify(f.path)}`); continue; }
      if (f.path === 'asset.json') { err(`${where}: asset.json cannot list itself`); continue; }
      if (paths.has(f.path)) { err(`${where}: duplicate file ${f.path}`); continue; } paths.add(f.path);
      try {
        const b = readInside(d, f.path);
        if (b.length !== f.bytes) err(`${where}/${f.path}: size ${b.length} != descriptor ${f.bytes}`);
        if (sha256(b) !== f.sha256) err(`${where}/${f.path}: sha256 mismatch (file modified or descriptor stale)`);
      } catch (e) { err(`${where}/${f.path}: ${e.message}`); }
    }
    if (desc.hash !== assetHash(desc.files)) err(`${where}: content hash does not match files`);
    if (desc.preview) {
      try { readInside(d, desc.preview, 2 << 20); } catch (e) { err(`${where}: preview ${e.message}`); }
    } else if (NEEDS_PREVIEW.has(desc.type)) warnings.push(`${where}: no preview for ${desc.type}`);
    if (desc.type === 'sfx' || desc.type === 'song') { if (desc.duration == null) warnings.push(`${where}: audio asset without duration`); }
    else if (['sprite', 'character', 'tileset', 'fx'].includes(desc.type) && !desc.size) warnings.push(`${where}: no size`);
    assets.push({ id: desc.id, dir: d, descriptor: desc });
  }
  // dependencies within this library must resolve (no cycles, version ranges satisfied)
  const byId = new Map(assets.map((a) => [a.id, a.descriptor]));
  for (const a of assets) for (const dep of a.descriptor.dependencies || []) {
    if (dep.library) continue; // external, checked at install/registry time
    const t = byId.get(dep.id);
    if (!t) err(`assets/${a.id}: dependency ${dep.id} not found in this library`);
    else if (!satisfies(t.version, dep.version)) err(`assets/${a.id}: dependency ${dep.id}@${t.version} does not satisfy ${dep.version}`);
  }
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return; if (state.get(id) === 1) { err(`dependency cycle: ${[...trail, id].join(' -> ')}`); return; }
    state.set(id, 1); for (const d of (byId.get(id)?.dependencies || [])) if (!d.library && byId.has(d.id)) visit(d.id, [...trail, id]); state.set(id, 2);
  };
  for (const id of byId.keys()) visit(id, []);
  if (manifest && !assets.length) warnings.push('library has no assets');
  return { dir: root, manifest, assets, errors: [...new Set(errors)], warnings, bytes: tree.bytes };
}

const sum = (a) => a.descriptor.files.reduce((n, f) => n + f.bytes, 0);

/** Deterministic INDEX object for a loaded (valid) library. No timestamps; sorted by id. */
export function buildIndex(lib) {
  const m = lib.manifest, list = [...lib.assets].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byType = {};
  const assets = list.map(({ descriptor: d, id }) => {
    byType[d.type] = (byType[d.type] || 0) + 1;
    const e = { id, type: d.type, version: d.version, tags: [...d.tags].sort(), license: d.license, author: d.author, hash: d.hash, descriptor: `assets/${id}/asset.json`, bytes: d.files.reduce((n, f) => n + f.bytes, 0) };
    for (const k of ['name', 'description', 'format', 'size', 'duration', 'palette', 'dependencies']) if (d[k] !== undefined) e[k] = d[k];
    if (d.preview) e.preview = `assets/${id}/${d.preview}`;
    return e;
  });
  const libHash = sha256(Buffer.from(stableJson({ name: m.name, version: m.version, license: m.license, assets: assets.map((a) => [a.id, a.version, a.hash]) })));
  return { formatVersion: FORMAT_VERSION, library: { name: m.name, version: m.version, license: m.license, description: m.description, tags: [...m.tags].sort(), hash: libHash }, counts: { total: assets.length, byType: Object.fromEntries(Object.keys(byType).sort().map((k) => [k, byType[k]])) }, assets };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const dims = (a) => (a.size ? `${a.size.w}x${a.size.h}${a.size.frames > 1 ? ` x${a.size.frames}` : ''}` : a.duration != null ? `${a.duration.toFixed(2)} s` : '');
export function buildIndexMd(index) {
  const L = index.library, out = [`# ${L.name} ${L.version}`, '', L.description, '', `License: ${L.license} | Assets: ${index.counts.total} (${Object.entries(index.counts.byType).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) | Library hash: \`${L.hash.slice(0, 12)}\``, '', 'Generated by `library.index`; do not edit. Machine-readable: [INDEX.json](INDEX.json).', ''];
  const types = Object.keys(index.counts.byType);
  for (const t of types) {
    out.push(`## ${t}`, '', '| Preview | Id | Name | Size | Tags | License | Version |', '|---|---|---|---|---|---|---|');
    for (const a of index.assets.filter((x) => x.type === t)) {
      const prev = a.preview ? (/\.(png|gif|jpe?g|svg)$/i.test(a.preview) ? `<img src="${a.preview}" height="40" alt="${esc(a.id)}">` : `[preview](${a.preview})`) : '';
      out.push(`| ${prev} | [\`${a.id}\`](${a.descriptor}) | ${esc(a.name || a.description)} | ${dims(a)} | ${esc(a.tags.join(', '))} | ${esc(a.license)} | ${a.version} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** Validate, then write INDEX.json + INDEX.md (or with check:true compare only). -> { ok, errors, warnings, index, changed:[files], stale:[files] } */
export function writeIndex(dir, { check = false } = {}) {
  const lib = loadLibrary(dir);
  if (lib.errors.length) return { ok: false, errors: lib.errors, warnings: lib.warnings, changed: [], stale: [] };
  const index = buildIndex(lib), files = { 'INDEX.json': stableJson(index), 'INDEX.md': buildIndexMd(index) + '\n' };
  const changed = [], stale = [];
  for (const [n, txt] of Object.entries(files)) {
    const p = resolveInside(lib.dir, n);
    const cur = existsSync(p) ? readFileSync(p, 'utf8') : null;
    if (cur === txt) continue;
    if (check) stale.push(n); else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt); changed.push(n); }
  }
  return { ok: check ? !stale.length : true, errors: check && stale.length ? stale.map((s) => `${s} is out of date (run index)`) : [], warnings: lib.warnings, index, changed, stale };
}

/** Validate an INDEX.json object against its schema (for fetched/untrusted indexes). */
export const validateIndexObject = (o) => validateSchema(SCHEMAS.index, o);
