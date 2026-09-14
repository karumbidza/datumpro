'use client';

import { useMemo } from 'react';
import type { ProgrammeData } from '@/lib/data/programme-types';
import type { TaskStatus } from '@datumpro/shared/domain';
import { parseDate, addDays, formatDayMonth } from '@/lib/date';

const DAY_W = 10; // px per day (print-dense)
const ROW_H = 20;
const GRID_W = 360;
const HEAD_H = 52;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: '#94a3b8',
  in_progress: '#2c64e3',
  submitted: '#f59e0b',
  blocked: '#ef4444',
  done: '#22c55e',
};
function workingDays(startIso: string, endIso: string): number {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  if (!s || !e || e < s) return 1;
  let n = 0;
  for (let d = s; d <= e; d = addDays(d, 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return Math.max(1, n);
}
const fmt = (iso: string): string => {
  const d = parseDate(iso);
  return d ? formatDayMonth(d) : iso;
};

export function ProgrammePrint({ projectName, data }: { projectName: string; data: ProgrammeData }) {
  const model = useMemo(() => {
    if (!data.rangeStartIso || !data.rangeEndIso || data.tasks.length === 0) return null;
    const rs = parseDate(data.rangeStartIso)!;
    const re = parseDate(data.rangeEndIso)!;
    const axisStart = addDays(rs, -rs.getDay()); // back to the Sunday on/before
    const axisEnd = addDays(re, 7 - re.getDay()); // to the Sunday after (exclusive)
    const totalDays = Math.max(7, Math.round((+axisEnd - +axisStart) / 86_400_000));
    const nWeeks = Math.ceil(totalDays / 7);
    const offset = (iso: string) => Math.round((+parseDate(iso)! - +axisStart) / 86_400_000);

    const months: { label: string; w: number }[] = [];
    for (let w = 0; w < nWeeks; ) {
      const first = addDays(axisStart, w * 7);
      const m = first.getMonth();
      let span = 0;
      while (w + span < nWeeks && addDays(axisStart, (w + span) * 7).getMonth() === m) span++;
      months.push({ label: `${MON[m]} ’${String(first.getFullYear()).slice(2)}`, w: span * 7 * DAY_W });
      w += span;
    }
    const weeks: { label: string }[] = [];
    for (let i = 0; i < nWeeks; i++) {
      const ws = addDays(axisStart, i * 7);
      weeks.push({ label: `${ws.getDate()} ${MON[ws.getMonth()]}` });
    }
    const days: { wk: boolean }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const wd = addDays(axisStart, i).getDay();
      days.push({ wk: wd === 0 || wd === 6 });
    }
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    const todayOff = Math.round((+t0 - +axisStart) / 86_400_000);
    const todayX = todayOff >= 0 && todayOff <= totalDays ? todayOff * DAY_W : null;

    return { axisStart, totalDays, nWeeks, offset, months, weeks, days, timeW: totalDays * DAY_W, todayX };
  }, [data]);

  const today = fmt(new Date().toISOString().slice(0, 10));

  return (
    <div className="pp">
      <style>{CSS}</style>

      <div className="pp-toolbar no-print">
        <div>
          <strong>Programme of Works</strong> · {projectName}
          <span className="pp-hint"> — choose Landscape and “Save as PDF” (A3 fits a full programme best).</span>
        </div>
        <div className="pp-actions">
          <button type="button" className="pp-btn" onClick={() => window.print()}>Print / Save as PDF</button>
          <button type="button" className="pp-btn ghost" onClick={() => window.close()}>Close</button>
        </div>
      </div>

      <div className="pp-sheet">
        <div className="pp-title">
          <div>
            <div className="pp-eyebrow">Construction Programme</div>
            <h1>{projectName}</h1>
          </div>
          <div className="pp-meta">
            <div><span className="k">Programme start</span><span className="v">{data.projectStart ? fmt(data.projectStart) : '—'}</span></div>
            <div><span className="k">Projected finish</span><span className="v">{data.projectedFinish ? fmt(data.projectedFinish) : '—'}</span></div>
            <div><span className="k">Baseline finish</span><span className="v">{data.baselineFinish ? fmt(data.baselineFinish) : '—'}</span></div>
            <div><span className="k">Data date</span><span className="v warn">{today}</span></div>
            <div><span className="k">Tasks</span><span className="v">{data.tasks.length}</span></div>
          </div>
        </div>

        {!model ? (
          <div className="pp-empty">No scheduled tasks to print yet — set task dates on the Programme first.</div>
        ) : (
          <div className="pp-gantt">
            <div className="pp-grid" style={{ width: GRID_W }}>
              <div className="pp-ghead" style={{ height: HEAD_H }}>
                <span className="c-id">#</span>
                <span className="c-nm">Task</span>
                <span className="c-n">Dur</span>
                <span className="c-d">Start</span>
                <span className="c-d">Finish</span>
              </div>
              {data.tasks.map((t, i) => (
                <div className="pp-grow" style={{ height: ROW_H }} key={t.id}>
                  <span className="c-id">{i + 1}</span>
                  <span className="c-nm">
                    {t.critical && <span className="dot" />}
                    <span className="nm-t" title={t.title}>{t.title}</span>
                  </span>
                  <span className="c-n">{workingDays(t.startIso, t.endIso)}d</span>
                  <span className="c-d">{fmt(t.startIso)}</span>
                  <span className="c-d">{fmt(t.endIso)}</span>
                </div>
              ))}
            </div>

            <div className="pp-time" style={{ width: model.timeW }}>
              <div className="pp-axis" style={{ height: HEAD_H }}>
                <div className="ax-m">
                  {model.months.map((m, i) => (
                    <div key={i} style={{ width: m.w }}>{m.label}</div>
                  ))}
                </div>
                <div className="ax-w">
                  {model.weeks.map((w, i) => (
                    <div key={i} style={{ width: 7 * DAY_W }}>{w.label}</div>
                  ))}
                </div>
                <div className="ax-d">
                  {model.days.map((d, i) => (
                    <div key={i} className={d.wk ? 'wk' : ''} style={{ width: DAY_W }}>{DOW[(i) % 7]}</div>
                  ))}
                </div>
              </div>

              <div className="pp-body">
                <div
                  className="pp-lines"
                  style={{
                    backgroundImage:
                      `repeating-linear-gradient(90deg,var(--wk) 0,var(--wk) ${DAY_W}px,transparent ${DAY_W}px,transparent ${DAY_W * 6}px,var(--wk) ${DAY_W * 6}px,var(--wk) ${DAY_W * 7}px),` +
                      `repeating-linear-gradient(90deg,var(--ln) 0,var(--ln) 1px,transparent 1px,transparent ${DAY_W * 7}px)`,
                  }}
                />
                {data.tasks.map((t) => {
                  const x = model.offset(t.startIso) * DAY_W;
                  const w = Math.max(3, (model.offset(t.endIso) - model.offset(t.startIso) + 1) * DAY_W);
                  const hasBase = t.baselineStartIso && t.baselineEndIso;
                  const bx = hasBase ? model.offset(t.baselineStartIso!) * DAY_W : 0;
                  const bw = hasBase ? Math.max(3, (model.offset(t.baselineEndIso!) - model.offset(t.baselineStartIso!) + 1) * DAY_W) : 0;
                  return (
                    <div className="pp-trow" style={{ height: ROW_H }} key={t.id}>
                      {hasBase && <div className="pp-base" style={{ left: bx, width: bw }} />}
                      <div
                        className={`pp-bar${t.critical ? ' crit' : ''}`}
                        style={{ left: x, width: w, background: STATUS_COLOR[t.status] }}
                      />
                    </div>
                  );
                })}
                {model.todayX != null && <div className="pp-today" style={{ left: model.todayX }} />}
              </div>
            </div>
          </div>
        )}

        <div className="pp-foot">
          <div className="pp-legend">
            <span><i className="sw" style={{ background: STATUS_COLOR.in_progress }} />In progress</span>
            <span><i className="sw" style={{ background: STATUS_COLOR.done }} />Done</span>
            <span><i className="sw" style={{ background: STATUS_COLOR.todo }} />To do</span>
            <span><i className="sw" style={{ background: STATUS_COLOR.blocked }} />Blocked</span>
            <span><i className="sw crit" />Critical path</span>
            <span><i className="sw base" />Baseline</span>
            <span><i className="sw td" />Data date</span>
          </div>
          <div className="pp-meta2">Programme of Works · Prepared by Project Manager · Generated {today}</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.pp{--ink:#19212b;--muted:#5c6773;--faint:#8a94a1;--ln:#e2e7ed;--lns:#cbd3dc;--band:#f0f3f7;--panel:#fcfdfe;--wk:#eceff4;--today:#e0483f;--brand:#2c64e3;
  color:var(--ink);background:#fff;font:13px/1.4 'Barlow Semi Condensed',system-ui,-apple-system,sans-serif;min-height:100vh}
.pp *{box-sizing:border-box}
.pp-toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--lns);font-size:13px}
.pp-hint{color:var(--faint)}
.pp-actions{display:flex;gap:8px}
.pp-btn{appearance:none;border:1px solid var(--brand);background:var(--brand);color:#fff;font:inherit;font-weight:600;
  padding:7px 14px;border-radius:7px;cursor:pointer}
.pp-btn.ghost{background:transparent;color:var(--ink);border-color:var(--lns)}
.pp-sheet{max-width:1400px;margin:0 auto;padding:16px}
.pp-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;
  border-bottom:2px solid #232c38;padding-bottom:12px;margin-bottom:12px}
.pp-eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--brand);font-weight:700}
.pp-title h1{margin:2px 0 0;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:26px;text-transform:uppercase;letter-spacing:.01em}
.pp-meta{display:grid;grid-template-columns:repeat(3,auto);gap:2px 20px}
.pp-meta .k{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);font-weight:600}
.pp-meta .v{display:block;font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:500}
.pp-meta .v.warn{color:var(--today)}
.pp-gantt{display:flex;border:1px solid var(--lns);border-radius:6px;overflow:hidden}
.pp-grid{flex:0 0 auto;border-right:2px solid var(--lns)}
.pp-ghead{display:flex;align-items:flex-end;background:var(--band);border-bottom:1.5px solid var(--lns);
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding-bottom:5px}
.pp-grow{display:flex;align-items:center;border-bottom:1px solid var(--ln);font-size:12px}
.pp-grow:nth-child(even){background:#fafbfc}
.c-id{flex:0 0 28px;text-align:right;padding-right:6px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint)}
.c-nm{flex:1;min-width:0;display:flex;align-items:center;gap:5px;padding:0 6px}
.c-nm .nm-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.c-nm .dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#ef4444}
.c-n{flex:0 0 40px;text-align:right;padding-right:6px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--muted)}
.c-d{flex:0 0 56px;text-align:right;padding-right:6px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--muted)}
.pp-time{flex:0 0 auto;position:relative}
.pp-axis{background:var(--band);border-bottom:1.5px solid var(--lns)}
.ax-m{display:flex;height:19px}
.ax-m>div{font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:11px;text-transform:uppercase;
  border-left:1px solid var(--lns);padding:2px 0 0 5px;overflow:hidden;white-space:nowrap}
.ax-w{display:flex;height:16px}
.ax-w>div{font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--muted);border-left:1px solid var(--ln);padding:1px 0 0 3px;overflow:hidden;white-space:nowrap}
.ax-d{display:flex;height:15px}
.ax-d>div{text-align:center;font-size:8px;line-height:15px;color:var(--faint)}
.ax-d>div.wk{background:var(--wk)}
.pp-body{position:relative}
.pp-lines{position:absolute;inset:0;z-index:0}
.pp-trow{position:relative}
.pp-bar{position:absolute;top:50%;transform:translateY(-50%);height:11px;border-radius:2px;z-index:2;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08)}
.pp-bar.crit{box-shadow:inset 0 0 0 1.5px #d83b3b}
.pp-base{position:absolute;top:calc(50% + 6px);height:3px;border-radius:2px;background:#b9c2ce;z-index:1}
.pp-today{position:absolute;top:0;bottom:0;border-left:1.5px dashed var(--today);z-index:4}
.pp-empty{padding:40px;text-align:center;color:var(--faint)}
.pp-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;
  border-top:1.5px solid var(--lns);margin-top:12px;padding-top:10px}
.pp-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11.5px;color:var(--muted)}
.pp-legend span{display:inline-flex;align-items:center;gap:6px}
.pp-legend .sw{width:22px;height:9px;border-radius:2px;display:inline-block}
.pp-legend .sw.crit{background:#fff;box-shadow:inset 0 0 0 1.5px #d83b3b}
.pp-legend .sw.base{background:#b9c2ce;height:4px}
.pp-legend .sw.td{width:0;height:12px;border-left:2px dashed var(--today);border-radius:0}
.pp-meta2{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--faint)}
@media print{
  @page{size:A3 landscape;margin:8mm}
  .no-print{display:none!important}
  .pp-sheet{max-width:none;margin:0;padding:0}
  .pp-gantt{border:1px solid #333;border-radius:0}
  .pp-grow{height:16px!important}
  .pp-trow{height:16px!important}
}
`;
