'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { importBoqRows, decryptBoqExcel, type ImportSection } from '../../actions';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { inputCompactClass } from '@/components/ui/form';
import { fmtMoney } from '@/lib/money';
import { type Row, type Kind, lineCents } from './grid-types';
import { ReviewGrid } from './review-grid';

type Cell = string | number | boolean | null;
type Grid = Cell[][];
type Sheet = { name: string; grid: Grid };
type Role = 'ignore' | 'item_no' | 'description' | 'unit' | 'qty' | 'rate' | 'amount' | 'section';

const ROLE_OPTIONS: [Role, string][] = [
  ['ignore', 'Ignore'],
  ['item_no', 'Item no.'],
  ['description', 'Description'],
  ['unit', 'Unit'],
  ['qty', 'Qty'],
  ['rate', 'Rate / unit'],
  ['amount', 'Amount'],
  ['section', 'Section'],
];

const str = (c: Cell | undefined): string => (c == null ? '' : String(c).trim());
const toNum = (c: Cell | undefined): number => {
  if (typeof c === 'number') return c;
  const n = parseFloat(str(c).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
};
// True numeric content (not text like "Item"/"Sum" that happens to sit in a qty cell).
const isNumeric = (c: Cell | undefined): boolean => {
  if (typeof c === 'number') return true;
  const s = str(c);
  return s !== '' && !isNaN(Number(s.replace(/[, ]/g, '')));
};

/** A sheet that looks like a summary/cover, not a priced bill — default it off. */
const looksLikeSummary = (name: string) => /summary|contents|cover|index|grand\s*total|preface/i.test(name);

// Rows that are running totals / carried-forward / collections — never items.
const NONITEM =
  /^\s*(sub[-\s]*total|totals?\b|carried\b|carried\s+(to|forward|down)|brought\s+(forward|down)|c\/?[fd]\b|b\/?[fd]\b|collection\b|to\s+(collection|summary)|amount\s+carried|grand\s+total|say\b)/i;

/** Guess a header row + per-column roles from the first few rows. */
function guess(grid: Grid): { headerSkip: number; roles: Role[]; sectionMode: 'auto' | 'column' } {
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  let headerRow = -1;
  for (let i = 0; i < Math.min(8, grid.length); i++) {
    const textCells = (grid[i] ?? []).filter((c) => str(c) !== '' && isNaN(Number(str(c)))).length;
    if (textCells >= 2) {
      headerRow = i;
      break;
    }
  }
  const roles: Role[] = Array.from({ length: cols }, () => 'ignore');
  if (headerRow >= 0) {
    const header = grid[headerRow] ?? [];
    for (let c = 0; c < cols; c++) {
      const h = str(header[c]).toLowerCase();
      if (!h) continue;
      if (/amount|total|value|sum\b/.test(h)) roles[c] = 'amount';
      else if (/qty|quant/.test(h)) roles[c] = 'qty';
      else if (/rate|price|unit\s*cost|u\/?rate/.test(h)) roles[c] = 'rate';
      else if (/unit|uom|u\/m|u\.o\.m/.test(h)) roles[c] = 'unit';
      else if (/desc|particular|work/.test(h)) roles[c] = 'description';
      else if (/item|no\.?|ref|code|s\/?n/.test(h)) roles[c] = 'item_no';
    }
  }
  return { headerSkip: headerRow >= 0 ? headerRow + 1 : 0, roles, sectionMode: roles.includes('section') ? 'column' : 'auto' };
}

/** Build normalised rows for one sheet from its column roles. */
function buildRows(grid: Grid, roles: Role[], headerSkip: number, sectionMode: 'auto' | 'column'): Row[] {
  const roleCol: Partial<Record<Role, number>> = {};
  roles.forEach((r, i) => {
    if (r !== 'ignore' && roleCol[r] === undefined) roleCol[r] = i;
  });
  const get = (r: Cell[], role: Role): Cell => {
    const c = roleCol[role];
    return c === undefined ? '' : (r[c] ?? '');
  };
  const built: Row[] = grid.slice(headerSkip).map((r) => {
    const description = str(get(r, 'description')) || (roleCol.description === undefined ? str(get(r, 'item_no')) : '');
    const sectionCell = str(get(r, 'section'));
    const unit = str(get(r, 'unit'));
    const qty = toNum(get(r, 'qty'));
    const rate = toNum(get(r, 'rate'));
    const amount = toNum(get(r, 'amount'));
    // A qty/rate/amount cell only "counts" when it holds a real number (not text
    // like "Item"/"Sum" that some lump-sum bills put in the qty/rate columns).
    const hasQ = isNumeric(get(r, 'qty'));
    const hasR = isNumeric(get(r, 'rate'));
    const hasA = isNumeric(get(r, 'amount'));
    const hasNum = hasQ || hasR || hasA;
    const hasD = description !== '';
    // A running-total / carried-forward / collection line (keeps its qty×rate out
    // of it) — never an item, even when it carries an amount.
    const isTotalLine = hasD && NONITEM.test(description) && !(hasQ && hasR);
    let kind: Kind;
    if (sectionMode === 'column') kind = sectionCell !== '' ? 'section' : !hasD || isTotalLine ? 'skip' : 'item';
    // Auto: a real item needs a description; a number-only row is a total → skip;
    // a description with no numbers is a heading.
    else kind = !hasD || isTotalLine ? 'skip' : hasNum ? 'item' : 'section';
    const desc = kind === 'section' && sectionCell ? sectionCell : description;
    return { kind, itemNo: str(get(r, 'item_no')), description: desc, unit, qty, rate, amount };
  });
  // Keep only the meaningful rows — drop totals, carried-forwards and blanks.
  return built.filter((r) => r.kind !== 'skip');
}

export function BoqImporter({ boqId, currency }: { boqId: string; currency: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'upload' | 'map' | 'review'>('upload');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerSkip, setHeaderSkip] = useState(0);
  const [roles, setRoles] = useState<Role[]>([]);
  const [sectionMode, setSectionMode] = useState<'auto' | 'column'>('auto');
  const [rows, setRows] = useState<Row[]>([]);
  const [replace, setReplace] = useState(false);
  const [pending, start] = useTransition();
  // A password-protected (encrypted OLE) file waiting on its password. Set from
  // onFile's catch when the buffer starts with the OLE/CFB signature; cleared on
  // cancel or a successful server-side decrypt.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const grid = sheets[sheetIndex]?.grid ?? [];
  const colCount = Math.min(20, grid.reduce((m, r) => Math.max(m, r.length), 0));
  const includedCount = included.filter(Boolean).length;

  // Shared post-parse logic: guard empty sheets, then seed the mapper. Used by
  // both the client-side parse and the server-side decrypt path.
  function loadSheets(parsed: Sheet[]): boolean {
    const first = parsed[0];
    if (!first) {
      setError('That file has no readable rows.');
      return false;
    }
    setSheets(parsed);
    // Default: include every sheet that isn't obviously a summary/cover.
    setIncluded(parsed.map((s) => !looksLikeSummary(s.name)));
    const firstBill = parsed.findIndex((s) => !looksLikeSummary(s.name));
    const idx = firstBill >= 0 ? firstBill : 0;
    setSheetIndex(idx);
    applyGuess(parsed[idx]!.grid);
    setStep('map');
    return true;
  }

  // Encrypted Office files are OLE/CFB containers starting with this signature.
  // SheetJS parses old plain .xls (also OLE), so only encrypted files reach the
  // catch below — a match there means "password-protected", not "corrupt".
  const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isOle = (buf: ArrayBuffer): boolean => {
    const b = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    if (b.length < 8) return false;
    return OLE_SIG.every((v, i) => b[i] === v);
  };

  async function onFile(file: File) {
    setError(null);
    setLockError(null);
    setLocked(null);
    setPassword('');
    setFileName(file.name);
    let buf: ArrayBuffer;
    try {
      const XLSX = await import('xlsx');
      buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const parsed: Sheet[] = wb.SheetNames.map((name): Sheet | null => {
        const ws = wb.Sheets[name];
        if (!ws) return null;
        return { name, grid: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as Grid };
      }).filter((s): s is Sheet => s !== null && s.grid.length > 0);
      loadSheets(parsed);
    } catch {
      // A password-protected file fails to parse here; if it's an encrypted OLE
      // container, prompt for the password (decrypt runs server-side). Otherwise
      // it's genuinely unreadable.
      if (buf! && isOle(buf!)) {
        setLocked(file);
      } else {
        setError('Could not read that file. Use .xlsx, .xls or .csv.');
      }
    }
  }

  async function onUnlock() {
    if (!locked || password.length === 0 || unlocking) return;
    setLockError(null);
    setUnlocking(true);
    try {
      const fd = new FormData();
      fd.append('file', locked);
      fd.append('password', password);
      const res = await decryptBoqExcel(fd);
      if ('error' in res) {
        setLockError(res.error);
        return;
      }
      if (loadSheets(res.sheets as Sheet[])) {
        setLocked(null);
        setPassword('');
      }
    } catch {
      setLockError('Could not unlock that file. Try again.');
    } finally {
      setUnlocking(false);
    }
  }

  function applyGuess(g: Grid) {
    const res = guess(g);
    setHeaderSkip(res.headerSkip);
    setRoles(res.roles);
    setSectionMode(res.sectionMode);
  }

  function pickSheet(i: number) {
    const s = sheets[i];
    if (!s) return;
    setSheetIndex(i);
    applyGuess(s.grid);
  }

  function toggleSheet(i: number) {
    setIncluded((p) => p.map((v, x) => (x === i ? !v : v)));
  }

  function buildReview() {
    const all: Row[] = [];
    sheets.forEach((s, i) => {
      if (!included[i]) return;
      // The sheet being previewed uses the on-screen mapping; the rest are auto-detected
      // (and everything stays editable in the review step below).
      const built =
        i === sheetIndex ? buildRows(s.grid, roles, headerSkip, sectionMode) : (() => {
          const gz = guess(s.grid);
          return buildRows(s.grid, gz.roles, gz.headerSkip, gz.sectionMode);
        })();
      if (built.length === 0) return;
      // Keep bills from bleeding together: if a sheet doesn't open with its own
      // heading, front it with a section named after the sheet.
      if (includedCount > 1 && built[0]!.kind !== 'section') {
        all.push({ kind: 'section', itemNo: '', description: s.name, unit: '', qty: 0, rate: 0, amount: 0 });
      }
      all.push(...built);
    });
    setRows(all);
    setStep('review');
  }

  const totals = useMemo(() => {
    let items = 0;
    let sections = 0;
    let skipped = 0;
    let cents = 0;
    for (const r of rows) {
      if (r.kind === 'skip') skipped++;
      else if (r.kind === 'section') sections++;
      else {
        items++;
        cents += lineCents(r);
      }
    }
    return { items, sections, skipped, cents };
  }, [rows]);

  function toSections(): ImportSection[] {
    const out: ImportSection[] = [];
    let cur: ImportSection | null = null;
    for (const r of rows) {
      if (r.kind === 'skip') continue;
      if (r.kind === 'section') {
        cur = { name: r.description || 'Untitled section', items: [] };
        out.push(cur);
      } else {
        if (!cur) {
          cur = { name: 'Imported items', items: [] };
          out.push(cur);
        }
        // Store so the item's total equals lineCents. When an amount is given it
        // wins: keep the qty/unit and back out the rate (rate = amount ÷ qty), or
        // qty 1 at the amount when there's no qty. Otherwise use qty × rate.
        let qty: number;
        let rateCents: number;
        if (r.amount > 0) {
          if (r.qty > 0) {
            qty = r.qty;
            rateCents = Math.round((r.amount * 100) / r.qty);
          } else {
            qty = 1;
            rateCents = Math.round(r.amount * 100);
          }
        } else {
          qty = r.qty;
          rateCents = Math.round(r.rate * 100);
        }
        cur.items.push({ itemNo: r.itemNo || null, description: r.description, uom: r.unit || null, qty, rateCents });
      }
    }
    return out.filter((s) => s.items.length > 0 || s.name !== 'Imported items');
  }

  function onImport() {
    setError(null);
    const sections = toSections();
    start(async () => {
      const res = await importBoqRows(boqId, sections, { replace });
      if (res.error) setError(res.error);
      else router.push(`/boq/${boqId}`);
    });
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  // ── UPLOAD ──────────────────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div className="mt-6">
        <FormError error={error} />
        {locked ? (
          <div className="rounded-xl border border-zinc-300 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-900/40">
            <h3 className="text-sm font-semibold">This file is password-protected</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{fileName}</span> is encrypted. Enter its
              password to unlock and import it. The password is used once to decrypt in memory and never stored.
            </p>
            <form
              className="mt-4 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onUnlock();
              }}
            >
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="File password"
                className={`${inputCompactClass} w-56`}
              />
              <Button type="submit" size="sm" disabled={unlocking || password.length === 0}>
                {unlocking ? 'Unlocking…' : 'Unlock & import'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLocked(null);
                  setPassword('');
                  setLockError(null);
                }}
              >
                Cancel
              </Button>
            </form>
            {lockError && (
              <div className="mt-3">
                <FormError error={lockError} />
              </div>
            )}
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-14 text-center transition hover:border-brand-500 hover:bg-brand-50/40 dark:border-zinc-700 dark:bg-zinc-900/40">
            <span className="text-sm font-medium">Drop an Excel/CSV bill here, or click to choose</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">.xlsx · .xls · .csv — any layout, any number of sheets</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        )}
      </div>
    );
  }

  // ── MAP ─────────────────────────────────────────────────────────────────────
  if (step === 'map') {
    const previewRows = grid.slice(0, Math.min(grid.length, headerSkip + 6));
    return (
      <div className="mt-6 space-y-5">
        <FormError error={error} />

        {sheets.length > 1 && (
          <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Sheets to import ({includedCount} of {sheets.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => toggleSheet(i)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                    included[i]
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                      : 'border-zinc-300 text-zinc-400 line-through dark:border-zinc-700'
                  }`}
                >
                  <span className={`inline-block h-3 w-3 rounded-sm border ${included[i] ? 'border-brand-500 bg-brand-500' : 'border-zinc-400'}`} />
                  {s.name}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Every selected sheet imports in one pass, each auto-mapped. Preview/adjust one below; fix anything in review.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            File: <span className="font-medium text-zinc-800 dark:text-zinc-200">{fileName}</span>
          </span>
          {sheets.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 dark:text-zinc-400">Previewing</span>
              <select value={sheetIndex} onChange={(e) => pickSheet(Number(e.target.value))} className={inputCompactClass}>
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Header rows to skip</span>
            <input
              type="number"
              min={0}
              max={20}
              value={headerSkip}
              onChange={(e) => setHeaderSkip(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              className={`${inputCompactClass} w-16`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500 dark:text-zinc-400">Sections</span>
            <select value={sectionMode} onChange={(e) => setSectionMode(e.target.value as 'auto' | 'column')} className={inputCompactClass}>
              <option value="auto">Auto — a row with no numbers is a heading</option>
              <option value="column">From a “Section” column</option>
            </select>
          </label>
        </div>

        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Set what each column is. Map <b>Amount</b> for lump-sum bills (where qty/rate say “Item/Sum”); map <b>Qty</b> and <b>Rate</b> for measured work. Greyed rows are skipped as headers.
        </p>

        <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                {Array.from({ length: colCount }, (_, c) => (
                  <th key={c} className="border-b border-r border-zinc-300 bg-zinc-100 p-1.5 dark:border-zinc-700 dark:bg-zinc-800/70">
                    <select
                      value={roles[c] ?? 'ignore'}
                      onChange={(e) => setRoles((p) => p.map((r, i) => (i === c ? (e.target.value as Role) : r)))}
                      className={`${inputCompactClass} min-w-[104px] ${roles[c] && roles[c] !== 'ignore' ? 'font-semibold text-brand-600 dark:text-brand-500' : 'text-zinc-500'}`}
                    >
                      {ROLE_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, ri) => (
                <tr key={ri} className={ri < headerSkip ? 'text-zinc-400 line-through' : ''}>
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c} className="max-w-[220px] truncate border-b border-r border-zinc-200 px-2 py-1 dark:border-zinc-800">
                      {str(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep('upload')}>
            ← Change file
          </Button>
          <Button size="sm" onClick={buildReview} disabled={!roles.includes('description') || includedCount === 0}>
            Continue to review →
          </Button>
          {!roles.includes('description') && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Map a Description column first.</span>
          )}
        </div>
      </div>
    );
  }

  // ── REVIEW ──────────────────────────────────────────────────────────────────
  return (
    <div className="mt-6 space-y-4">
      <FormError error={error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Fix anything that landed wrong — flip a row between <b>Section</b>, <b>Item</b> and <b>Skip</b>, or edit a value.
          A line with no qty/rate uses its <b>Amount</b>. Then import.
        </p>
        <div className="font-mono text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">{totals.sections} sections · {totals.items} items · </span>
          <span className="font-semibold text-brand-600 dark:text-brand-500">{fmtMoney(totals.cents, currency)}</span>
        </div>
      </div>

      <ReviewGrid boqId={boqId} rows={rows} setRow={setRow} currency={currency} />

      <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600"
        />
        Replace the bill’s existing contents — clears its current sections &amp; items before importing
      </label>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setStep('map')}>
          ← Back to mapping
        </Button>
        <Button size="sm" onClick={onImport} disabled={pending || totals.items === 0}>
          {pending ? 'Importing…' : `Import ${totals.items} items into ${Math.max(1, totals.sections)} section${totals.sections === 1 ? '' : 's'}`}
        </Button>
        <Link href={`/boq/${boqId}`} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Cancel
        </Link>
      </div>
    </div>
  );
}
