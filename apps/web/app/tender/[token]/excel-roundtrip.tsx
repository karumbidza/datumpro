'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { saveBidLines } from './actions';

export interface RoundtripLine {
  itemId: string;
  itemNo: string;
  section: string;
  description: string;
  uom: string | null;
  qty: number;
  rateCents: number;
  durationDays: number | null;
}

interface Parsed {
  lines: { itemId: string; rateCents: number; durationDays: number | null }[];
  updated: number;
  unchanged: number;
  ignored: number;
}

/** Download the bill as .xlsx (rates/days prefilled from the draft), fill it
 *  offline, upload it back. The file carries a hidden line-ID column and the
 *  tender id — uploads are matched by ID, never by row position, and rejected
 *  outright when they belong to a different tender or barely match this bill.
 *  Parsing happens in the browser; only structured lines reach the server,
 *  where the RPC re-validates everything again. */
export function ExcelRoundtrip({
  token,
  tenderId,
  title,
  lines,
  onApplied,
}: {
  token: string;
  tenderId: string;
  title: string;
  lines: RoundtripLine[];
  onApplied: (saved: { itemId: string; rateCents: number; durationDays: number | null }[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const header = ['Item No', 'Section', 'Description', 'Unit', 'Qty', 'Rate', 'Days', '_line'];
    const rows = lines.map((l) => [
      l.itemNo,
      l.section,
      l.description,
      l.uom ?? '',
      l.qty,
      l.rateCents ? l.rateCents / 100 : '',
      l.durationDays ?? '',
      l.itemId,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 22 },
      { wch: 48 },
      { wch: 8 },
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { hidden: true },
    ];
    const meta = XLSX.utils.aoa_to_sheet([['tender', tenderId]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bid');
    XLSX.utils.book_append_sheet(wb, meta, '_meta');
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] } as never;
    XLSX.writeFile(wb, `${title.replace(/[^\w\- ]+/g, '').trim() || 'bid'}.xlsx`);
  }

  async function onFile(file: File) {
    setError(null);
    setParsed(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });

      const metaSheet = wb.Sheets['_meta'];
      const metaGrid = metaSheet
        ? (XLSX.utils.sheet_to_json(metaSheet, { header: 1, raw: false, defval: '' }) as string[][])
        : [];
      const fileTender = metaGrid.find((r) => r[0] === 'tender')?.[1] ?? null;
      if (fileTender !== tenderId) {
        setError(
          fileTender
            ? 'This file belongs to a different tender — download the template from this page.'
            : 'This is not a bid template from this tender — use Download Excel first.',
        );
        return;
      }

      const bid = wb.Sheets['Bid'];
      if (!bid) {
        setError('The "Bid" sheet is missing — use the downloaded template.');
        return;
      }
      const grid = XLSX.utils.sheet_to_json(bid, { header: 1, raw: true, defval: '' }) as (
        | string
        | number
      )[][];
      if (grid.length < 2) {
        setError('The file has no data rows.');
        return;
      }
      if (grid.length - 1 > 2000) {
        setError('That file has over 2000 rows — it does not match this bill.');
        return;
      }
      const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
      const col = (name: string) => head.indexOf(name);
      const cId = col('_line');
      const cRate = col('rate');
      const cDays = col('days');
      if (cId < 0 || cRate < 0) {
        setError('The template columns were changed — download a fresh copy and refill it.');
        return;
      }

      const known = new Map(lines.map((l) => [l.itemId, l]));
      const seen = new Set<string>();
      const out: Parsed['lines'] = [];
      let ignored = 0;
      let updated = 0;
      let unchanged = 0;
      let contentRows = 0;
      for (const row of grid.slice(1)) {
        const hasContent = row.some((c) => String(c).trim() !== '');
        if (!hasContent) continue;
        contentRows += 1;
        const id = String(row[cId] ?? '').trim();
        const line = known.get(id);
        if (!id || !line) {
          ignored += 1;
          continue;
        }
        if (seen.has(id)) {
          setError('The file contains the same line twice — download a fresh copy.');
          return;
        }
        seen.add(id);
        const rateRaw = String(row[cRate] ?? '').trim();
        const rateCents = rateRaw === '' ? 0 : Math.max(0, Math.round((Number(rateRaw) || 0) * 100));
        const daysRaw = cDays >= 0 ? String(row[cDays] ?? '').trim() : '';
        const durationDays = daysRaw === '' ? null : Math.max(0, Math.round(Number(daysRaw) || 0));
        if (rateCents === line.rateCents && durationDays === line.durationDays) unchanged += 1;
        else updated += 1;
        out.push({ itemId: id, rateCents, durationDays });
      }

      if (out.length === 0 || out.length < contentRows / 2) {
        setError('Most rows in that file do not match this bill — is it the right file?');
        return;
      }
      setParsed({ lines: out, updated, unchanged, ignored });
    } catch {
      setError('Could not read that file. Upload the .xlsx you downloaded from this page.');
    }
  }

  function applyUpload() {
    if (!parsed) return;
    startTransition(async () => {
      const res = await saveBidLines({ token, lines: parsed.lines });
      if (res.error) {
        setError(res.error);
        setParsed(null);
        return;
      }
      onApplied(parsed.lines);
      setParsed(null);
    });
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={exportXlsx}>
          Download Excel
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          Upload filled Excel
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = '';
          }}
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Fill Rate and Days offline, then upload — the file only fits this tender.
        </span>
      </div>

      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {parsed && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 dark:border-brand-900 dark:bg-brand-950/30">
          <p className="text-sm text-brand-700 dark:text-brand-400">
            {parsed.lines.length} line{parsed.lines.length === 1 ? '' : 's'} matched — {parsed.updated}{' '}
            will update, {parsed.unchanged} unchanged
            {parsed.ignored > 0 ? `, ${parsed.ignored} unknown row${parsed.ignored === 1 ? '' : 's'} ignored` : ''}
            . The file&apos;s values replace what&apos;s typed here.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={applyUpload} disabled={busy}>
              {busy ? 'Applying…' : 'Apply upload'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setParsed(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
