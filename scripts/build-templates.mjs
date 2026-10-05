#!/usr/bin/env node
// Builds the paid spreadsheet templates from products/<id>/spec.json.
//
//   npm run build:templates            -> products/<id>/dist/<lang>/<id>.xlsx
//   node scripts/build-templates.mjs --out <dir>
//
// One English and one Hindi workbook per product. Built files are uploaded to R2 and never
// committed (products/*/dist/ is git-ignored). Before anything is written, every formula in the
// spec is checked: each column letter must point at the column the formula is meant to use
// (EXPECTED_REFS below), string literals compared with a column must be one of its labels, and
// every literal must have a Hindi translation. Any mismatch throws.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;

export const PRODUCT_IDS = ['lead-tracker', 'commission-ledger'];
export const LANGS = ['en', 'hi'];
/** Last row that gets formulas and dropdowns. Spec ranges like `B2:B` become `B2:B1000`. */
export const LAST_ROW = 1000;
/** Indian digit grouping (12,34,56,789.00); no currency symbol, the header says ₹. */
export const INR_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
export const DATE_FORMAT = 'dd-mmm-yyyy';
/** Percent columns hold the number the user types (2 means 2 %), so no Excel `%` scaling. */
export const PERCENT_FORMAT = '0.00"%"';
export const RATE_FORMAT = '0.0"%"';

/**
 * Which columns each spec formula is meant to read, by column id (sheet id -> column ids).
 * The check derives letters from the spec's column order and compares them with the letters
 * the formula actually uses, so a reordered or mistyped column fails the build.
 * `$label` is the label cell in column A of a summary sheet.
 */
export const EXPECTED_REFS = {
  'lead-tracker': {
    'leads.follow_up': { leads: ['status', 'next_follow_up'] },
    today: { leads: ['name', 'phone', 'status', 'next_follow_up', 'notes', 'follow_up'] },
    'summary.count_by_status': { leads: ['status'], summary: ['$label'] },
    'summary.count_by_source': { leads: ['source'], summary: ['$label'] },
    'summary.win_rate_percent': { leads: ['status'] },
  },
  'commission-ledger': {
    'deals.commission': {
      deals: ['fixed_commission', 'deal_value', 'commission_percent'],
    },
    'deals.gst': { deals: ['commission', 'gst_percent'] },
    'deals.invoiced': { deals: ['commission', 'gst'] },
    'deals.received': { deals: ['deal_id'], payments: ['deal_id', 'amount'] },
    'deals.pending': { deals: ['invoiced', 'received'] },
    'deals.payment_status': { deals: ['invoiced', 'received'] },
    'deals.co_broker_amount': { deals: ['commission', 'co_broker_percent'] },
    'deals.my_share': { deals: ['commission', 'co_broker_amount'] },
    'summary.commission': { deals: ['commission'] },
    'summary.invoiced': { deals: ['invoiced'] },
    'summary.received': { deals: ['received'] },
    'summary.pending': { deals: ['pending'] },
    'summary.my_share': { deals: ['my_share'] },
  },
};

/** Strings the spec does not carry. Hindi needs human review before sale (AGENTS.md). */
export const UI = {
  howTo: { en: 'How to use', hi: 'उपयोग कैसे करें' },
  version: { en: 'Template version', hi: 'टेम्पलेट संस्करण' },
  examples: {
    en: 'Rows marked "Example – delete me" are samples: delete them before you start.',
    hi: 'जिन पंक्तियों पर "उदाहरण – हटाएँ" लिखा है, वे नमूने हैं: शुरू करने से पहले उन्हें हटा दें।',
  },
  grey: {
    en: 'Grey columns are filled by formulas — do not type in them.',
    hi: 'ग्रे कॉलम फ़ॉर्मूले से भरते हैं — उनमें कुछ न लिखें।',
  },
  disclaimer: {
    en: 'For record-keeping only — verify figures with a professional.',
    hi: 'केवल रिकॉर्ड रखने के लिए — आंकड़ों की पुष्टि किसी विशेषज्ञ से करें।',
  },
  win_rate_percent: {
    en: 'Win rate % (deals done ÷ (deals done + lost))',
    hi: 'सफलता दर % (डील पक्की ÷ (डील पक्की + हाथ से गई))',
  },
  example: { en: (n) => `Example ${n} – delete me`, hi: (n) => `उदाहरण ${n} – हटाएँ` },
  exampleArea: { en: 'Example area', hi: 'उदाहरण इलाका' },
  exampleFlat: { en: 'Example flat, 2 BHK', hi: 'उदाहरण फ़्लैट, 2 BHK' },
  exampleNext: { en: 'Example – call back', hi: 'उदाहरण – दोबारा कॉल करें' },
};

/** Seed rows: clearly fake, so the sheet shows how it works. Values by column id. */
const EXAMPLES = {
  'lead-tracker': {
    leads: (t) => [
      {
        added: { formula: 'TODAY()-10' },
        name: t.example(1),
        phone: '00000 00000',
        source: { option: 'whatsapp' },
        need: { option: 'buy' },
        type: { option: 'flat' },
        location: t.exampleArea,
        budget_min: 4000000,
        budget_max: 6000000,
        status: { option: 'contacted' },
        last_contact: { formula: 'TODAY()-3' },
        next_follow_up: { formula: 'TODAY()' },
        notes: t.example(1),
      },
      {
        added: { formula: 'TODAY()-5' },
        name: t.example(2),
        phone: '00000 00000',
        source: { option: 'portal' },
        need: { option: 'rent' },
        type: { option: 'flat' },
        location: t.exampleArea,
        budget_min: 20000,
        budget_max: 30000,
        status: { option: 'new' },
        next_follow_up: { formula: 'TODAY()-2' },
        notes: t.example(2),
      },
      {
        added: { formula: 'TODAY()-20' },
        name: t.example(3),
        phone: '00000 00000',
        source: { option: 'referral' },
        need: { option: 'buy' },
        type: { option: 'plot' },
        location: t.exampleArea,
        budget_min: 2500000,
        budget_max: 3500000,
        status: { option: 'visit-planned' },
        last_contact: { formula: 'TODAY()-1' },
        next_follow_up: { formula: 'TODAY()+3' },
        notes: t.example(3),
      },
    ],
    visits: (t) => [
      {
        date: { formula: 'TODAY()-1' },
        lead: t.example(3),
        property: t.exampleFlat,
        feedback: t.example(3),
        next_step: t.exampleNext,
      },
    ],
  },
  'commission-ledger': {
    // Same numbers as spec known_answers.deals[0] and [1], so the owner can check the sheet.
    deals: (t) => [
      {
        deal_id: 'D-EX1',
        date: { formula: 'TODAY()-30' },
        property: t.exampleFlat,
        client: t.example(1),
        deal_value: 10000000,
        commission_percent: 2,
        gst_percent: 18,
        co_broker: t.example(1),
        co_broker_percent: 50,
        notes: t.example(1),
      },
      {
        deal_id: 'D-EX2',
        date: { formula: 'TODAY()-7' },
        property: t.exampleFlat,
        client: t.example(2),
        fixed_commission: 25000,
        gst_percent: 0,
        notes: t.example(2),
      },
    ],
    payments: (t) => [
      {
        date: { formula: 'TODAY()-20' },
        deal_id: 'D-EX1',
        amount: 100000,
        mode: { option: 'bank' },
        reference: t.example(1),
      },
      {
        date: { formula: 'TODAY()-10' },
        deal_id: 'D-EX1',
        amount: 18000,
        mode: { option: 'upi' },
        reference: t.example(1),
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Formula parsing

/** Column letter for a 0-based index (0 -> A, 26 -> AA). */
export function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Splits a formula into code and string-literal segments (`""` escapes a quote). */
export function segments(formula) {
  const out = [];
  let i = 0;
  let code = '';
  while (i < formula.length) {
    if (formula[i] === '"') {
      if (code) out.push({ code });
      code = '';
      let j = i + 1;
      let lit = '';
      for (;;) {
        if (j >= formula.length) throw new Error(`Unterminated string in formula: ${formula}`);
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            lit += '"';
            j += 2;
            continue;
          }
          break;
        }
        lit += formula[j];
        j += 1;
      }
      out.push({ literal: lit });
      i = j + 1;
    } else {
      code += formula[i];
      i += 1;
    }
  }
  if (code) out.push({ code });
  return out;
}

const REF_RE =
  /(?<![A-Za-z0-9_.!'])(?:([A-Za-z_][A-Za-z0-9_]*)!)?([A-Z]{1,3})([0-9]+)(?::([A-Z]{1,3})([0-9]*))?(?![A-Za-z0-9_(])/g;

/** Cell and range references in one code segment. */
export function findRefs(code) {
  return [...code.matchAll(REF_RE)].map((m) => ({
    text: m[0],
    index: m.index,
    sheet: m[1] ?? null,
    col: m[2],
    row: Number(m[3]),
    endCol: m[4] ?? null,
    endRow: m[5] === undefined ? null : m[5] === '' ? '' : Number(m[5]),
  }));
}

/** Every formula in a spec, with where it lives. */
export function specFormulas(spec) {
  const list = [];
  for (const sheet of spec.sheets) {
    for (const col of sheet.columns ?? []) {
      if (col.type === 'derived') {
        if (!col.formula) throw new Error(`${spec.id}: derived column ${col.id} has no formula`);
        list.push({ key: `${sheet.id}.${col.id}`, sheet, column: col, formula: col.formula });
      }
    }
    if (sheet.formula) list.push({ key: sheet.id, sheet, formula: sheet.formula });
    for (const [name, formula] of Object.entries(sheet.formulas ?? {})) {
      list.push({ key: `${sheet.id}.${name}`, sheet, formulaKey: name, formula });
    }
  }
  return list;
}

function sheetByTitle(spec, title) {
  const sheet = spec.sheets.find((s) => s.title.en === title);
  if (!sheet) throw new Error(`${spec.id}: formula refers to unknown sheet "${title}"`);
  return sheet;
}

/** en label -> { en, hi } for every list option and derived value in the product. */
export function labelMap(spec) {
  const map = new Map();
  for (const sheet of spec.sheets) {
    for (const col of sheet.columns ?? []) {
      for (const o of [...(col.options ?? []), ...(col.values ?? [])]) {
        if (!o.en) continue;
        const seen = map.get(o.en);
        if (seen && seen.hi !== o.hi) {
          throw new Error(`${spec.id}: label "${o.en}" has two Hindi translations`);
        }
        map.set(o.en, { en: o.en, hi: o.hi });
      }
    }
  }
  return map;
}

/**
 * Checks every spec formula. Throws with a list of all problems found.
 * @returns {Map<string, {key: string, refs: Array<{sheetId: string, col: string}>}>}
 */
export function checkSpec(spec) {
  const expected = EXPECTED_REFS[spec.id];
  if (!expected) throw new Error(`No EXPECTED_REFS entry for product "${spec.id}"`);
  const labels = labelMap(spec);
  const errors = [];
  const formulas = specFormulas(spec);
  const result = new Map();

  for (const f of formulas) {
    const where = `${spec.id} ${f.key}`;
    if (!f.formula.startsWith('=')) errors.push(`${where}: formula must start with "="`);
    const want = expected[f.key];
    if (!want) {
      errors.push(`${where}: no EXPECTED_REFS entry — add one in scripts/build-templates.mjs`);
      continue;
    }
    const used = new Map(); // sheetId -> Set(letters)
    const refs = [];
    const segs = segments(f.formula.slice(1));
    segs.forEach((seg, si) => {
      if (seg.code === undefined) return;
      for (const ref of findRefs(seg.code)) {
        const target = ref.sheet ? sheetByTitle(spec, ref.sheet) : f.sheet;
        if (ref.endCol !== null && ref.endCol !== ref.col) {
          errors.push(`${where}: ${ref.text} spans several columns`);
        }
        if (ref.row !== 2) errors.push(`${where}: ${ref.text} should start at row 2`);
        if (ref.endRow !== null && ref.endRow !== '') {
          errors.push(`${where}: ${ref.text} should be open-ended (e.g. B2:B)`);
        }
        if (target.columns) {
          const idx = target.columns.findIndex((_, i) => colLetter(i) === ref.col);
          if (idx === -1) {
            errors.push(`${where}: ${ref.text} is past the last column of ${target.id}`);
          } else if (f.column && target === f.sheet && target.columns[idx] === f.column) {
            errors.push(`${where}: ${ref.text} refers to the formula's own column`);
          }
        } else if (ref.col !== 'A' || ref.sheet) {
          errors.push(`${where}: ${ref.text} — only A (the label cell) is allowed here`);
        }
        if (!used.has(target.id)) used.set(target.id, new Set());
        used.get(target.id).add(ref.col);
        refs.push({ sheetId: target.id, col: ref.col });

        // `X2="label"` / `X2:X<>"label"`: the label must belong to column X.
        const after = seg.code.slice(ref.index + ref.text.length);
        const next = segs[si + 1];
        if (/^\s*(=|<>)\s*$/.test(after) && next?.literal && target.columns) {
          const col = target.columns[target.columns.findIndex((_, i) => colLetter(i) === ref.col)];
          const own = [...(col?.options ?? []), ...(col?.values ?? [])].map((o) => o.en);
          if (!own.includes(next.literal)) {
            errors.push(
              `${where}: ${ref.text} is compared with "${next.literal}", which is not a label of column ${col?.id ?? ref.col}`,
            );
          }
        }
      }
    });
    for (const seg of segs) {
      if (seg.literal && !labels.has(seg.literal)) {
        errors.push(
          `${where}: string "${seg.literal}" is not a list option/value, so it cannot be translated`,
        );
      }
    }
    // Compare letters used with letters expected.
    const wantLetters = new Map();
    for (const [sheetId, ids] of Object.entries(want)) {
      const sheet = spec.sheets.find((s) => s.id === sheetId);
      if (!sheet) {
        errors.push(`${where}: EXPECTED_REFS names unknown sheet ${sheetId}`);
        continue;
      }
      const letters = new Set();
      for (const id of ids) {
        if (id === '$label') {
          letters.add('A');
          continue;
        }
        const idx = (sheet.columns ?? []).findIndex((c) => c.id === id);
        if (idx === -1)
          errors.push(`${where}: EXPECTED_REFS names unknown column ${sheetId}.${id}`);
        else letters.add(colLetter(idx));
      }
      wantLetters.set(sheetId, letters);
    }
    const fmt = (m) =>
      [...m.entries()]
        .map(([s, set]) => `${s}:${[...set].sort().join(',')}`)
        .sort()
        .join(' ');
    if (fmt(used) !== fmt(wantLetters)) {
      errors.push(
        `${where}: formula uses columns [${fmt(used)}] but should use [${fmt(wantLetters)}]`,
      );
    }
    result.set(f.key, { key: f.key, refs });
  }
  for (const key of Object.keys(expected)) {
    if (!formulas.some((f) => f.key === key)) {
      errors.push(`${spec.id} ${key}: EXPECTED_REFS entry has no formula in the spec`);
    }
  }
  if (errors.length) {
    throw new Error(`Spec formula check failed:\n  - ${errors.join('\n  - ')}`);
  }
  return result;
}

function quoteSheet(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * Turns a spec (Google Sheets) formula into the text stored in the .xlsx, without the "=".
 * - sheet names and string literals are translated into `lang`;
 * - open-ended ranges (B2:B) end at LAST_ROW, because Excel has no open-ended ranges;
 * - single-cell references move from row 2 to `row`;
 * - `{a,b}` array literals become HSTACK(a,b); FILTER/SORT/HSTACK get the _xlfn prefixes
 *   that the file format needs for Excel 365 functions.
 */
export function toXlsxFormula(spec, formula, lang, row = 2) {
  const labels = labelMap(spec);
  let out = '';
  for (const seg of segments(formula.replace(/^=/, ''))) {
    if (seg.literal !== undefined) {
      const label = seg.literal === '' ? null : labels.get(seg.literal);
      if (seg.literal !== '' && !label) throw new Error(`No translation for "${seg.literal}"`);
      out += `"${(label ? label[lang] : '').replace(/"/g, '""')}"`;
      continue;
    }
    let code = seg.code.replace(REF_RE, (...m) => {
      const [, sheet, col, r, endCol, endRow] = m;
      const prefix = sheet ? `${quoteSheet(sheetByTitle(spec, sheet).title[lang])}!` : '';
      if (endCol !== undefined) return `${prefix}${col}${r}:${endCol}${endRow || LAST_ROW}`;
      return `${prefix}${col}${Number(r) - 2 + row}`;
    });
    if (code.includes(';'))
      throw new Error(`Vertical array literals are not supported: ${formula}`);
    code = code
      .replace(/\{/g, 'HSTACK(')
      .replace(/\}/g, ')')
      .replace(/\bFILTER\(/g, '_xlfn._xlws.FILTER(')
      .replace(/\bSORT\(/g, '_xlfn._xlws.SORT(')
      .replace(/\bHSTACK\(/g, '_xlfn.HSTACK(');
    out += code;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Workbook

const COLORS = {
  headerFill: 'FF1F4E79',
  headerFont: 'FFFFFFFF',
  derivedHeaderFill: 'FF7F7F7F',
  derivedFill: 'FFEDEDED',
  derivedFont: 'FF404040',
  exampleFont: 'FF7F7F7F',
};

function numFmtFor(type) {
  if (type === 'date') return DATE_FORMAT;
  if (type === 'inr') return INR_FORMAT;
  if (type === 'percent') return PERCENT_FORMAT;
  return undefined;
}

function widthFor(col, lang) {
  const base = { date: 14, inr: 16, percent: 12, list: 18, text: 18, derived: 16 }[col.type] ?? 16;
  const longest = Math.max(
    col[lang].length + 2,
    ...(col.options ?? []).map((o) => o[lang].length + 4),
    ...(col.values ?? []).map((o) => o[lang].length + 2),
  );
  if (col.id === 'notes') return 40;
  return Math.min(40, Math.max(base, longest));
}

function styleHeader(cell, derived) {
  cell.font = { bold: true, color: { argb: COLORS.headerFont } };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: derived ? COLORS.derivedHeaderFill : COLORS.headerFill },
  };
  cell.alignment = { vertical: 'middle', wrapText: true };
}

function freezeAndFilter(ws, columnCount) {
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
  ws.getRow(1).height = 30;
}

function exampleValue(spec, col, value, lang) {
  if (value && typeof value === 'object' && 'option' in value) {
    const opt = col.options?.find((o) => o.id === value.option);
    if (!opt) throw new Error(`${spec.id}: example uses unknown option ${col.id}=${value.option}`);
    return opt[lang];
  }
  if (value && typeof value === 'object' && 'formula' in value) return { formula: value.formula };
  return value;
}

function addColumnSheet(wb, spec, sheet, lang, t) {
  const ws = wb.addWorksheet(sheet.title[lang]);
  const cols = sheet.columns;
  ws.columns = cols.map((col) => ({
    key: col.id,
    width: widthFor(col, lang),
    style: numFmtFor(col.type) ? { numFmt: numFmtFor(col.type) } : {},
  }));
  const header = ws.getRow(1);
  cols.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col[lang];
    styleHeader(cell, col.type === 'derived');
    if (col.note) cell.note = col.note;
  });
  freezeAndFilter(ws, cols.length);

  const examples = EXAMPLES[spec.id]?.[sheet.id]?.(t) ?? [];
  examples.forEach((ex, n) => {
    const row = ws.getRow(n + 2);
    for (const [id, value] of Object.entries(ex)) {
      const i = cols.findIndex((c) => c.id === id);
      if (i === -1) throw new Error(`${spec.id}: example uses unknown column ${sheet.id}.${id}`);
      const cell = row.getCell(i + 1);
      cell.value = exampleValue(spec, cols[i], value, lang);
      cell.font = { italic: true, color: { argb: COLORS.exampleFont } };
    }
  });

  cols.forEach((col, i) => {
    const letter = colLetter(i);
    if (col.type === 'list') {
      const list = col.options.map((o) => o[lang]);
      if (list.some((l) => l.includes(','))) {
        throw new Error(`${spec.id}: option of ${col.id} contains a comma`);
      }
      const formula = `"${list.join(',')}"`;
      if (formula.length > 255) throw new Error(`${spec.id}: dropdown for ${col.id} is too long`);
      ws.dataValidations.add(`${letter}2:${letter}${LAST_ROW}`, {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: 'warning',
      });
    }
    if (col.type === 'derived') {
      for (let r = 2; r <= LAST_ROW; r += 1) {
        const cell = ws.getCell(`${letter}${r}`);
        cell.value = { formula: toXlsxFormula(spec, col.formula, lang, r) };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.derivedFill } };
        cell.font = { color: { argb: COLORS.derivedFont } };
        const fmt = col.values ? undefined : INR_FORMAT;
        if (fmt) cell.numFmt = fmt;
      }
    }
  });
  return ws;
}

/** Sheet with one spilling formula in A2 (e.g. "Call today"). */
function addArraySheet(wb, spec, sheet, lang) {
  const ws = wb.addWorksheet(sheet.title[lang]);
  // Output columns are the {…} array members, in order; the FILTER condition comes after.
  const inner = sheet.formula.match(/\{([^}]*)\}/);
  if (!inner) throw new Error(`${spec.id}: ${sheet.id} formula has no {…} column list`);
  const shown = findRefs(inner[1]).map((r) => {
    const src = sheetByTitle(spec, r.sheet);
    return src.columns[src.columns.findIndex((_, i) => colLetter(i) === r.col)];
  });
  ws.columns = shown.map((col) => ({
    width: widthFor(col, lang),
    style: numFmtFor(col.type) ? { numFmt: numFmtFor(col.type) } : {},
  }));
  shown.forEach((col, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    cell.value = col[lang];
    styleHeader(cell, true);
  });
  freezeAndFilter(ws, shown.length);
  ws.getCell('A2').value = {
    formula: toXlsxFormula(spec, sheet.formula, lang),
    shareType: 'array',
    ref: 'A2',
  };
  return ws;
}

function addSummarySheet(wb, spec, sheet, lang) {
  const ws = wb.addWorksheet(sheet.title[lang]);
  ws.columns = [{ width: 46 }, { width: 18 }];
  let row = 1;
  const grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.derivedFill } };
  for (const [key, formula] of Object.entries(sheet.formulas)) {
    const refs = findRefs(formula);
    const external = refs.filter((r) => r.sheet);
    const src = sheetByTitle(spec, external[0].sheet);
    const srcCol = src.columns[src.columns.findIndex((_, i) => colLetter(i) === external[0].col)];
    const perLabel = refs.some((r) => !r.sheet && r.col === 'A');
    if (perLabel) {
      // A table: one row per option of the counted column.
      const head = ws.getRow(row);
      head.getCell(1).value = srcCol[lang];
      head.getCell(2).value = src.title[lang];
      styleHeader(head.getCell(1), false);
      styleHeader(head.getCell(2), true);
      row += 1;
      for (const opt of srcCol.options) {
        ws.getCell(`A${row}`).value = opt[lang];
        const cell = ws.getCell(`B${row}`);
        cell.value = { formula: toXlsxFormula(spec, formula, lang, row) };
        cell.fill = grey;
        row += 1;
      }
    } else {
      const label = UI[key]?.[lang] ?? srcCol[lang];
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`A${row}`).font = { bold: true };
      const cell = ws.getCell(`B${row}`);
      cell.value = { formula: toXlsxFormula(spec, formula, lang, row) };
      cell.fill = grey;
      cell.numFmt = UI[key] ? RATE_FORMAT : INR_FORMAT;
    }
    row += 1;
  }
  ws.views = [{ state: 'frozen', ySplit: 0 }];
  return ws;
}

function addHowTo(wb, spec, lang, t, productName) {
  const ws = wb.addWorksheet(t.howTo);
  ws.columns = [{ width: 110 }];
  const lines = [];
  lines.push({ text: productName, font: { bold: true, size: 16 } });
  lines.push({ text: `${t.version} ${spec.version}`, font: { color: { argb: 'FF7F7F7F' } } });
  lines.push({ text: '' });
  let n = 1;
  for (const sheet of spec.sheets) {
    if (sheet.purpose) lines.push({ text: `${n++}. ${sheet.title[lang]}: ${sheet.purpose[lang]}` });
  }
  lines.push({ text: `${n++}. ${t.grey}` });
  lines.push({ text: `${n}. ${t.examples}` });
  lines.push({ text: '' });
  lines.push({ text: t.disclaimer, font: { bold: true } });
  lines.forEach((l, i) => {
    const cell = ws.getCell(`A${i + 1}`);
    cell.value = l.text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (l.font) cell.font = l.font;
  });
  return ws;
}

function strings(lang) {
  const t = {};
  for (const [k, v] of Object.entries(UI)) t[k] = v[lang];
  return t;
}

/** Builds one workbook (not yet written). */
export function buildWorkbook(spec, lang, productName) {
  checkSpec(spec);
  const t = strings(lang);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ChangeLens';
  wb.company = 'ChangeLens';
  wb.title = productName;
  wb.calcProperties.fullCalcOnLoad = true;
  addHowTo(wb, spec, lang, t, productName);
  for (const sheet of spec.sheets) {
    if (sheet.columns) addColumnSheet(wb, spec, sheet, lang, t);
    else if (sheet.formula) addArraySheet(wb, spec, sheet, lang);
    else if (sheet.formulas) addSummarySheet(wb, spec, sheet, lang);
    else throw new Error(`${spec.id}: sheet ${sheet.id} has no columns or formulas`);
  }
  for (const ws of wb.worksheets) {
    if (ws.name.length > 31 || /[[\]:*?/\\]/.test(ws.name)) {
      throw new Error(`${spec.id}: invalid sheet name "${ws.name}"`);
    }
  }
  return wb;
}

const METADATA_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">' +
  '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" ' +
  'pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" ' +
  'clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>' +
  '<futureMetadata name="XLDAPR" count="1"><bk><extLst>' +
  '<ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}">' +
  '<xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>' +
  '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>';

/**
 * Marks array formulas as dynamic (spilling) arrays so Excel 365 shows every row instead of
 * only the first. exceljs cannot write this metadata, so it is added to the zip afterwards.
 */
export async function markDynamicArrays(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let marked = 0;
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async('string');
    const next = xml.replace(/<c r="([A-Z]+\d+)"([^>]*)><f t="array"/g, (_, r, attrs) => {
      marked += 1;
      return `<c r="${r}"${attrs} cm="1"><f t="array"`;
    });
    if (next !== xml) zip.file(name, next);
  }
  if (!marked) return buffer;
  zip.file('xl/metadata.xml', METADATA_XML);
  const types = await zip.file('[Content_Types].xml').async('string');
  zip.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>',
    ),
  );
  const relsName = 'xl/_rels/workbook.xml.rels';
  const rels = await zip.file(relsName).async('string');
  zip.file(
    relsName,
    rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdMetadata1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>',
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function loadSpec(id) {
  return JSON.parse(readFileSync(join(root, 'products', id, 'spec.json'), 'utf8'));
}

function productNames() {
  const catalog = JSON.parse(readFileSync(join(root, 'products', 'catalog.json'), 'utf8'));
  return new Map(catalog.products.map((p) => [p.id, { en: p.name_en, hi: p.name_hi }]));
}

/**
 * Builds every product in both languages.
 * @param {{ outDir?: string }} [options] outDir replaces products/ as the output root
 * @returns {Promise<string[]>} paths written
 */
export async function buildAll(options = {}) {
  const names = productNames();
  const written = [];
  for (const id of PRODUCT_IDS) {
    const spec = loadSpec(id);
    checkSpec(spec);
    for (const lang of LANGS) {
      const name = names.get(id)?.[lang] ?? id;
      const wb = buildWorkbook(spec, lang, name);
      const buffer = await markDynamicArrays(Buffer.from(await wb.xlsx.writeBuffer()));
      const dir = options.outDir
        ? join(options.outDir, id, lang)
        : join(root, 'products', id, 'dist', lang);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${id}.xlsx`);
      writeFileSync(file, buffer);
      written.push(file);
    }
  }
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--out');
  const outDir = i === -1 ? undefined : process.argv[i + 1];
  buildAll({ outDir }).then(
    (files) => {
      for (const f of files) console.log(`wrote ${f}`);
    },
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
