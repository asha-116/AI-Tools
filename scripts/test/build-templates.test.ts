import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DATE_FORMAT,
  INR_FORMAT,
  LAST_ROW,
  PERCENT_FORMAT,
  UI,
  buildAll,
  checkSpec,
  colLetter,
  loadSpec,
  toXlsxFormula,
} from '../build-templates.mjs';

type Lang = 'en' | 'hi';
interface Label {
  id: string;
  en: string;
  hi: string;
}
interface Column extends Label {
  type: string;
  formula?: string;
  options?: Label[];
  values?: Label[];
}
interface Sheet {
  id: string;
  title: { en: string; hi: string };
  columns?: Column[];
  formula?: string;
  formulas?: Record<string, string>;
}
interface Spec {
  id: string;
  sheets: Sheet[];
}

const products = ['lead-tracker', 'commission-ledger'];
const langs: Lang[] = ['en', 'hi'];
const out = mkdtempSync(join(tmpdir(), 'templates-'));
const books = new Map<string, ExcelJS.Workbook>();
const file = (id: string, lang: Lang) => join(out, id, lang, `${id}.xlsx`);
const spec = (id: string) => loadSpec(id) as Spec;
const clone = (id: string) => structuredClone(spec(id));

// Formats come back from exceljs without the `\` escapes.
const unescape = (fmt: string) => fmt.replace(/\\/g, '');

beforeAll(async () => {
  await buildAll({ outDir: out });
  for (const id of products) {
    for (const lang of langs) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(file(id, lang));
      books.set(`${id}/${lang}`, wb);
    }
  }
}, 60_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('spec formula check', () => {
  it('accepts both specs as committed', () => {
    for (const id of products) expect(() => checkSpec(spec(id))).not.toThrow();
  });

  it('fails when a column moves and the formulas still use the old letters', () => {
    const s = clone('lead-tracker');
    const cols = s.sheets[0].columns as Column[];
    [cols[3], cols[9]] = [cols[9], cols[3]]; // swap source and status
    expect(() => checkSpec(s)).toThrow(/leads\.follow_up: formula uses columns/);
  });

  it('fails when a formula points at the wrong column', () => {
    const s = clone('commission-ledger');
    const gst = s.sheets[0].columns?.find((c) => c.id === 'gst') as Column;
    gst.formula = gst.formula?.replace('N(I2)', 'N(F2)');
    expect(() => checkSpec(s)).toThrow(/deals\.gst: formula uses columns \[deals:F,H\]/);
  });

  it('fails when a column is compared with a label it does not have', () => {
    const s = clone('lead-tracker');
    s.sheets[1].formula = s.sheets[1].formula?.replace('Leads!M2:M="Overdue"', 'Leads!M2:M="Lost"');
    expect(() => checkSpec(s)).toThrow(/compared with "Lost"/);
  });

  it('fails on untranslatable strings, references past the last column and unknown sheets', () => {
    const s = clone('commission-ledger');
    const status = s.sheets[0].columns?.find((c) => c.id === 'payment_status') as Column;
    status.formula = status.formula?.replace('"Due"', '"Unpaid"');
    expect(() => checkSpec(s)).toThrow(/"Unpaid" is not a list option/);
    const t = clone('commission-ledger');
    t.sheets[2].formulas = { ...t.sheets[2].formulas, my_share: '=SUM(Deals!Z2:Z)' };
    expect(() => checkSpec(t)).toThrow(/past the last column/);
    const u = clone('commission-ledger');
    u.sheets[2].formulas = { ...u.sheets[2].formulas, my_share: '=SUM(Ledger!R2:R)' };
    expect(() => checkSpec(u)).toThrow(/unknown sheet "Ledger"/);
  });

  it('fails when a formula has no expected-columns entry', () => {
    const s = clone('commission-ledger');
    s.sheets[2].formulas = { ...s.sheets[2].formulas, extra: '=SUM(Deals!H2:H)' };
    expect(() => checkSpec(s)).toThrow(/summary\.extra: no EXPECTED_REFS entry/);
    expect(() => checkSpec({ ...s, id: 'nope' })).toThrow(/No EXPECTED_REFS entry/);
  });

  it('names columns like a spreadsheet', () => {
    expect([0, 13, 25, 26, 27].map(colLetter)).toEqual(['A', 'N', 'Z', 'AA', 'AB']);
  });
});

describe('formula translation', () => {
  it('keeps the English follow-up formula as written and moves it down the rows', () => {
    const s = spec('lead-tracker');
    const f = s.sheets[0].columns?.find((c) => c.id === 'follow_up')?.formula as string;
    expect(toXlsxFormula(s, f, 'en', 2)).toBe(f.slice(1));
    expect(toXlsxFormula(s, f, 'en', 7)).toBe(f.slice(1).replace(/J2/g, 'J7').replace(/L2/g, 'L7'));
  });

  it('compares the Hindi follow-up formula with the Hindi status labels', () => {
    const s = spec('lead-tracker');
    const f = s.sheets[0].columns?.find((c) => c.id === 'follow_up')?.formula as string;
    expect(toXlsxFormula(s, f, 'hi', 2)).toBe(
      'IF(OR(J2="डील पक्की",J2="हाथ से गई"),"",IF(L2="","तारीख नहीं",IF(L2<TODAY(),"देर हो गई",IF(L2=TODAY(),"आज","आगे"))))',
    );
  });

  it('quotes Hindi sheet names and closes open ranges', () => {
    const s = spec('commission-ledger');
    const f = s.sheets[0].columns?.find((c) => c.id === 'received')?.formula as string;
    expect(toXlsxFormula(s, f, 'hi', 5)).toBe(
      `IF(A5="","",SUMIF('भुगतान'!B2:B${LAST_ROW},A5,'भुगतान'!C2:C${LAST_ROW}))`,
    );
  });
});

describe.each(products)('%s workbook', (id) => {
  const s = spec(id);

  describe.each(langs)('%s', (lang) => {
    const wb = () => books.get(`${id}/${lang}`) as ExcelJS.Workbook;

    it('has a how-to sheet first, then the spec sheets', () => {
      expect(wb().worksheets.map((w) => w.name)).toEqual([
        UI.howTo[lang],
        ...s.sheets.map((sh) => sh.title[lang]),
      ]);
      const text = wb()
        .worksheets[0].getColumn(1)
        .values.filter((v) => typeof v === 'string');
      expect(text).toContain(UI.disclaimer[lang]);
      expect(text).toContain(
        `1. ${s.sheets[0].title[lang]}: ${(s.sheets[0] as Sheet & { purpose: Label }).purpose[lang]}`,
      );
    });

    for (const sheet of s.sheets.filter((sh) => sh.columns)) {
      it(`${sheet.id}: headers, frozen row, filter, dropdowns, formats and formulas`, () => {
        const ws = wb().getWorksheet(sheet.title[lang]) as ExcelJS.Worksheet;
        const cols = sheet.columns as Column[];
        expect(ws.getRow(1).values.slice(1)).toEqual(cols.map((c) => c[lang]));
        expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
        expect(ws.autoFilter).toBe(`A1:${colLetter(cols.length - 1)}1`);
        expect(ws.getCell('A1').font?.bold).toBe(true);

        cols.forEach((col, i) => {
          const letter = colLetter(i);
          const dv = (a: string) => ws.dataValidations.find(a);
          if (col.type === 'list') {
            const want = `"${col.options?.map((o) => o[lang]).join(',')}"`;
            for (const r of [2, 500, LAST_ROW]) {
              expect(dv(`${letter}${r}`)).toMatchObject({ type: 'list', formulae: [want] });
            }
          } else {
            expect(dv(`${letter}2`)).toBeUndefined();
          }
          const fmt = ws.getCell(`${letter}500`).numFmt;
          if (col.type === 'date') expect(fmt).toBe(DATE_FORMAT);
          if (col.type === 'inr') expect(fmt).toBe(unescape(INR_FORMAT));
          if (col.type === 'percent') expect(fmt).toBe(PERCENT_FORMAT);
          if (col.type === 'derived') {
            for (const r of [2, 3, LAST_ROW]) {
              const cell = ws.getCell(`${letter}${r}`);
              expect(cell.formula).toBe(toXlsxFormula(s, col.formula as string, lang, r));
              expect(cell.fill).toMatchObject({ pattern: 'solid' });
            }
            if (!col.values) expect(ws.getCell(`${letter}2`).numFmt).toBe(unescape(INR_FORMAT));
          }
        });
      });
    }

    it('uses only labels of its own language in formulas', () => {
      const other: Lang = lang === 'en' ? 'hi' : 'en';
      const foreign = new Set<string>();
      for (const sh of s.sheets) {
        for (const c of sh.columns ?? []) {
          for (const o of [...(c.options ?? []), ...(c.values ?? [])]) {
            if (o[other] && o[other] !== o[lang]) foreign.add(`"${o[other]}"`);
          }
        }
      }
      for (const ws of wb().worksheets) {
        ws.eachRow((row) =>
          row.eachCell((cell) => {
            for (const f of foreign) expect(cell.formula ?? '').not.toContain(f);
          }),
        );
      }
    });

    it('seeds clearly fake example rows', () => {
      const first = s.sheets[0];
      const ws = wb().getWorksheet(first.title[lang]) as ExcelJS.Worksheet;
      const values = (ws.getRow(2).values as unknown[]).filter((v) => typeof v === 'string');
      expect(values.some((v) => v === UI.example[lang](1))).toBe(true);
    });
  });
});

describe('sheet-level formulas', () => {
  it('writes the call list as one spilling array formula', async () => {
    const s = spec('lead-tracker');
    const sheet = s.sheets.find((sh) => sh.id === 'today') as Sheet;
    for (const lang of langs) {
      const ws = books.get(`lead-tracker/${lang}`)?.getWorksheet(sheet.title[lang]);
      const a2 = ws?.getCell('A2');
      expect(a2?.formula).toBe(toXlsxFormula(s, sheet.formula as string, lang));
      expect(a2?.formula).toContain('_xlfn._xlws.FILTER(_xlfn.HSTACK(');
      expect(ws?.getRow(1).values.slice(1)).toEqual(
        ['name', 'phone', 'status', 'next_follow_up', 'notes'].map(
          (cid) => s.sheets[0].columns?.find((c) => c.id === cid)?.[lang],
        ),
      );
      const zip = await JSZip.loadAsync(readFileSync(file('lead-tracker', lang)));
      expect(Object.keys(zip.files)).toContain('xl/metadata.xml');
      const xml = await zip.file('xl/worksheets/sheet3.xml')?.async('string');
      expect(xml).toMatch(/<c r="A2"[^>]* cm="1"><f t="array" ref="A2">/);
    }
    const hi = books.get('lead-tracker/hi')?.getWorksheet(sheet.title.hi)?.getCell('A2').formula;
    expect(hi).toContain(`'लीड'!M2:M${LAST_ROW}="देर हो गई"`);
  });

  it('lays out the lead summary with one row per status and source', () => {
    const s = spec('lead-tracker');
    const leads = s.sheets[0].columns as Column[];
    const status = leads.find((c) => c.id === 'status') as Column;
    const ws = books.get('lead-tracker/hi')?.getWorksheet('सारांश') as ExcelJS.Worksheet;
    expect(ws.getCell('A1').value).toBe(status.hi);
    expect(ws.getCell('A2').value).toBe(status.options?.[0].hi);
    expect(ws.getCell('B2').formula).toBe(`COUNTIF('लीड'!J2:J${LAST_ROW},A2)`);
    expect(ws.getCell('B3').formula).toBe(`COUNTIF('लीड'!J2:J${LAST_ROW},A3)`);
    const all = ws
      .getColumn(2)
      .values.map((v) => (v && typeof v === 'object' && 'formula' in v ? v.formula : ''));
    expect(all.some((f) => f.includes('"डील पक्की"') && f.includes('"हाथ से गई"'))).toBe(true);
  });

  it('labels each commission total with its Deals column header', () => {
    const s = spec('commission-ledger');
    const deals = s.sheets[0].columns as Column[];
    const ws = books.get('commission-ledger/en')?.getWorksheet('Summary') as ExcelJS.Worksheet;
    expect(ws.getCell('A1').value).toBe(deals.find((c) => c.id === 'commission')?.en);
    expect(ws.getCell('B1').formula).toBe(`SUM(Deals!H2:H${LAST_ROW})`);
    expect(ws.getCell('B5').formula).toBe(`SUM(Deals!R2:R${LAST_ROW})`);
    expect(ws.getCell('B5').numFmt).toBe(unescape(INR_FORMAT));
  });
});
