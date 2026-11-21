// Safety primitives for treating library content as UNTRUSTED input: path rules, symlink refusal, size caps, hashing.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const LIMITS = Object.freeze({
  maxJsonBytes: 1 << 20,          // any descriptor/manifest/index
  maxFileBytes: 16 << 20,         // one asset file
  maxLibraryBytes: 128 << 20,     // whole library tree
  maxFiles: 5000,                 // files in a library tree
  maxAssets: 2000,
  maxFilesPerAsset: 256,
  maxPathLen: 240,
});

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** true when p is a safe relative POSIX path: no abs, no drive letter, no backslash, no NUL, no "." / ".." / empty segments. */
export function isSafeRel(p) {
  if (typeof p !== 'string' || !p || p.length > LIMITS.maxPathLen) return false;
  if (p.includes('\0') || p.includes('\\') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Resolve rel under root; throws on traversal or when any existing component is a symlink. Returns the absolute path. */
export function resolveInside(root, rel) {
  if (!isSafeRel(rel)) throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  const base = resolve(root), abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error(`path escapes root: ${rel}`);
  let cur = base;
  for (const seg of rel.split('/')) {
    cur = join(cur, seg);
    let st; try { st = lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) throw new Error(`symlink in path: ${rel}`);
  }
  return abs;
}

/** Walk a tree without following symlinks. Returns { files: [rel...], problems: [string] } (symlinks, specials and caps are problems). */
export function walkTree(root, { skip = ['.git', 'node_modules'] } = {}) {
  const files = [], problems = []; let bytes = 0;
  const rec = (rel) => {
    let names; try { names = readdirSync(join(root, rel)).sort(); } catch (e) { problems.push(`cannot read ${rel || '.'}: ${e.code || e.message}`); return; }
    for (const n of names) {
      if (!rel && skip.includes(n)) continue;
      const r = rel ? `${rel}/${n}` : n, st = lstatSync(join(root, r));
      if (st.isSymbolicLink()) problems.push(`symlink not allowed: ${r}`);
      else if (st.isDirectory()) rec(r);
      else if (st.isFile()) {
        files.push(r); bytes += st.size;
        if (st.size > LIMITS.maxFileBytes) problems.push(`file too large (${st.size} bytes): ${r}`);
        if (files.length > LIMITS.maxFiles) { problems.push(`more than ${LIMITS.maxFiles} files`); return; }
      } else problems.push(`special file not allowed: ${r}`);
      if (files.length > LIMITS.maxFiles) return;
    }
  };
  rec('');
  if (bytes > LIMITS.maxLibraryBytes) problems.push(`library larger than ${LIMITS.maxLibraryBytes} bytes`);
  return { files, bytes, problems };
}

/** Read and parse JSON with a size cap; throws on symlink/too big/invalid. Rejects __proto__ keys. */
export function readJson(path) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new Error(`symlink not allowed: ${path}`);
  if (st.size > LIMITS.maxJsonBytes) throw new Error(`JSON too large (${st.size} bytes): ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'), (k, v) => { if (k === '__proto__') throw new Error('forbidden key __proto__'); return v; });
}

/** Read a regular, non-symlink file under root with size cap. */
export function readInside(root, rel, max = LIMITS.maxFileBytes) {
  const abs = resolveInside(root, rel), st = lstatSync(abs);
  if (!st.isFile()) throw new Error(`not a regular file: ${rel}`);
  if (st.size > max) throw new Error(`file too large: ${rel}`);
  const real = realpathSync(abs);
  if (!real.startsWith(realpathSync(root) + sep)) throw new Error(`path escapes root: ${rel}`);
  return readFileSync(abs);
}

/** Deterministic JSON: sorted keys at every level, 2-space indent, trailing newline. */
export function stableJson(v) {
  const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v), null, 2) + '\n';
}
