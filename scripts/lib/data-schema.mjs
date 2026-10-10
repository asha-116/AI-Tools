// Structural checks for data files other than stamp duty (that one is checked in
// check-structure.mjs against data/stamp-duty/schema.json). Zero dependencies on purpose:
// the JSON Schema files document the shape; these functions enforce it in CI.

/** 1 sq ft in m² (international foot, 1959) — an exact definition, used to cross-check units. */
const SQ_M_PER_SQ_FT = 0.09290304;

const isText = (/** @type {unknown} */ v) => typeof v === 'string' && v.trim() !== '';
const isHttps = (/** @type {unknown} */ v) => typeof v === 'string' && v.startsWith('https://');

/**
 * @param {unknown} doc
 * @param {string} path
 * @param {string[]} errors
 * @returns {doc is Record<string, any>}
 */
function isObject(doc, path, errors) {
  if (typeof doc === 'object' && doc !== null && !Array.isArray(doc)) return true;
  errors.push(`${path}: must be a JSON object`);
  return false;
}

/**
 * @param {Record<string, any>} doc
 * @param {string} path
 * @param {string[]} errors
 */
function checkStatus(doc, path, errors) {
  if (doc.status !== 'draft' && doc.status !== 'verified') {
    errors.push(`${path}: "status" must be "draft" or "verified"`);
  }
  if (!isText(doc.verified_by)) errors.push(`${path}: "verified_by" is required`);
  else if (doc.status === 'verified' && /not verified/i.test(doc.verified_by)) {
    errors.push(`${path}: "verified_by" must name who verified it`);
  }
  if (!isText(doc.last_verified)) errors.push(`${path}: "last_verified" is required`);
}

/**
 * data/land-units/*.json (shape in data/land-units/schema.json).
 * `seen` collects unit ids across files so a duplicate id is caught.
 * @param {unknown} doc
 * @param {string} path
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
export function checkLandUnits(doc, path, seen = new Set()) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(doc, path, errors)) return errors;
  if (doc.dataset !== 'land-units') errors.push(`${path}: "dataset" must be "land-units"`);
  checkStatus(doc, path, errors);
  if (doc.states !== undefined) {
    if (!Array.isArray(doc.states) || !doc.states.every((s) => /^[A-Z]{2}$/.test(String(s)))) {
      errors.push(`${path}: "states" must be two-letter state codes, e.g. ["MH"]`);
    }
  }
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) {
    errors.push(`${path}: "sources" must be a non-empty array`);
  } else {
    for (const s of doc.sources) {
      if (!isHttps(s?.url) || !isText(s?.title)) {
        errors.push(`${path}: every source needs an https "url" and a "title"`);
      }
    }
  }
  if (!Array.isArray(doc.units) || doc.units.length === 0) {
    errors.push(`${path}: "units" must be a non-empty array`);
    return errors;
  }
  for (const u of doc.units) {
    const id = String(u?.id);
    if (!/^[a-z][a-z0-9_]*$/.test(id)) errors.push(`${path}: unit id "${id}" must be snake_case`);
    else if (seen.has(id)) errors.push(`${path}: unit id "${id}" is defined twice`);
    seen.add(id);
    if (!isText(u?.label_en) || !isText(u?.label_hi)) {
      errors.push(`${path}: unit "${id}" needs "label_en" and "label_hi"`);
    }
    if (typeof u?.sq_m !== 'number' || !Number.isFinite(u.sq_m) || u.sq_m <= 0) {
      errors.push(`${path}: unit "${id}" needs a positive "sq_m"`);
    } else if (u.sq_ft !== undefined) {
      // Both sizes are stored; they must describe the same area.
      const fromFt = Number(u.sq_ft) * SQ_M_PER_SQ_FT;
      if (!(Math.abs(fromFt - u.sq_m) <= 1e-9 * u.sq_m)) {
        errors.push(`${path}: unit "${id}": sq_ft × 0.09290304 = ${fromFt}, not sq_m ${u.sq_m}`);
      }
    }
  }
  return errors;
}

/**
 * data/free-tier-limits.json.
 * @param {unknown} doc
 * @param {string} path
 * @returns {string[]}
 */
export function checkFreeTierLimits(doc, path) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(doc, path, errors)) return errors;
  const t = doc.alert_threshold_percent;
  if (typeof t !== 'number' || t <= 0 || t > 100) {
    errors.push(`${path}: "alert_threshold_percent" must be a number from 1 to 100`);
  }
  if (!Array.isArray(doc.limits) || doc.limits.length === 0) {
    errors.push(`${path}: "limits" must be a non-empty array`);
    return errors;
  }
  const ids = new Set();
  for (const l of doc.limits) {
    const id = String(l?.id);
    if (!isText(l?.id) || ids.has(id)) errors.push(`${path}: limit ids must be unique ("${id}")`);
    ids.add(id);
    for (const key of ['service', 'metric', 'unit', 'verified_by', 'last_verified']) {
      if (!isText(l?.[key])) errors.push(`${path}: limit "${id}" needs "${key}"`);
    }
    if (l?.window !== 'day' && l?.window !== 'month') {
      errors.push(`${path}: limit "${id}": "window" must be "day" or "month"`);
    }
    if (typeof l?.limit !== 'number' || !(l.limit > 0)) {
      errors.push(`${path}: limit "${id}" needs a positive "limit"`);
    }
    if (!isHttps(l?.source)) errors.push(`${path}: limit "${id}" needs an https "source"`);
  }
  return errors;
}
