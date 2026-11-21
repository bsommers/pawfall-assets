// Minimal zero-dep JSON-Schema validator (subset): type, enum, const, required, properties, additionalProperties (bool|schema),
// items, minItems, maxItems, minProperties, minimum, maximum, minLength, maxLength, pattern. Returns string[] of "path: problem".
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

export function validateSchema(schema, value, path = '$') {
  const errs = [];
  const walk = (s, v, p) => {
    if (s.type) {
      const ts = Array.isArray(s.type) ? s.type : [s.type];
      if (!ts.some((t) => isType(v, t))) { errs.push(`${p}: expected ${ts.join('|')}, got ${typeOf(v)}`); return; }
    }
    if (s.const !== undefined && v !== s.const) errs.push(`${p}: must equal ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errs.push(`${p}: must be one of ${s.enum.join(', ')} (got ${JSON.stringify(v)})`);
    if (typeof v === 'string') {
      if (s.minLength != null && v.length < s.minLength) errs.push(`${p}: shorter than ${s.minLength}`);
      if (s.maxLength != null && v.length > s.maxLength) errs.push(`${p}: longer than ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${p}: does not match ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errs.push(`${p}: below minimum ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) errs.push(`${p}: above maximum ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errs.push(`${p}: needs at least ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) errs.push(`${p}: allows at most ${s.maxItems} items`);
      if (s.items) v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (s.minProperties != null && keys.length < s.minProperties) errs.push(`${p}: needs at least ${s.minProperties} properties`);
      for (const r of s.required || []) if (!Object.hasOwn(v, r)) errs.push(`${p}: missing required "${r}"`);
      for (const k of keys) {
        const sub = s.properties && Object.hasOwn(s.properties, k) ? s.properties[k] : null;
        if (sub) walk(sub, v[k], `${p}.${k}`);
        else if (s.additionalProperties === false) errs.push(`${p}: unexpected property "${k}"`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, v[k], `${p}.${k}`);
      }
    }
  };
  walk(schema, value, path);
  return errs;
}
