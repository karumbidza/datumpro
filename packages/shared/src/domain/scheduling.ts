/**
 * Scheduling engine — Critical Path Method (CPM) + Earned-Value progress.
 *
 * Pure, framework-agnostic logic shared by web and mobile. Two independent
 * questions are answered separately (see docs/FUNCTIONAL_SPEC.md):
 *   • computeSchedule → how the dependency graph lays out in time: each task's
 *     earliest/latest start & finish, float (slack), and whether it's on the
 *     critical path. Non-critical tasks can slip (or run in parallel) without
 *     moving the project end; critical ones can't.
 *   • computeProgress → how much is done vs how much *should* be done by now,
 *     weighted (by cost when known, else duration). Only VERIFIED work (a task
 *     signed off to `done`) counts as earned — self-reported % never inflates it.
 *
 * All times are whole-day offsets from an implicit project day 0. The caller maps
 * day offsets back to calendar dates against the project's start date.
 */
import type { TaskStatus } from './tasks';

const EPS = 1e-9;

/**
 * How two tasks are tied together (predecessor point → successor point):
 *   fs — finish-to-start: successor can't START until predecessor FINISHES (+lag). The default.
 *   ss — start-to-start:  successor can't START until predecessor STARTS (+lag).
 *   ff — finish-to-finish: successor can't FINISH until predecessor FINISHES (+lag).
 *   sf — start-to-finish: successor can't FINISH until predecessor STARTS (+lag). Rare.
 */
export type DependencyType = 'fs' | 'ss' | 'ff' | 'sf';

export interface SchedDependency {
  /** A predecessor of the task carrying this dependency. */
  predecessorId: string;
  /** Days of lag (or lead, when negative) on the relationship. */
  lagDays: number;
  /** Relationship type. Absent ⇒ finish-to-start (back-compat). */
  type?: DependencyType;
}

export interface SchedTask {
  id: string;
  /** Whole days of work. 0 = a milestone (a zero-duration marker). */
  durationDays: number;
  status: TaskStatus;
  /** Relative importance for progress: agreed cost when known, else duration. */
  weight: number;
  /** Predecessors of THIS task (finish-to-start + lag). */
  dependencies: SchedDependency[];
  /** ISO dates used only for the planned-% (schedule) baseline. */
  plannedStart?: string | null;
  plannedEnd?: string | null;
}

export interface ScheduledTask {
  id: string;
  es: number; // earliest start
  ef: number; // earliest finish
  ls: number; // latest start
  lf: number; // latest finish
  float: number; // ls - es (total float / slack)
  critical: boolean;
}

export interface ScheduleResult {
  tasks: Record<string, ScheduledTask>;
  projectDurationDays: number;
  /** Critical-path task ids, ordered by earliest start. */
  criticalPath: string[];
  /** True if the dependency graph contains a cycle (schedule is then empty). */
  hasCycle: boolean;
}

interface Edge {
  id: string;
  lag: number;
  type: DependencyType;
}

/** Forward/backward CPM passes. Cycle-safe: returns hasCycle and an empty
 *  schedule rather than looping forever (the DB already rejects cycles). */
export function computeSchedule(tasks: SchedTask[]): ScheduleResult {
  const ids = tasks.map((t) => t.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dur = (id: string) => Math.max(0, byId.get(id)?.durationDays ?? 0);

  const successors = new Map<string, Edge[]>();
  const predecessors = new Map<string, Edge[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    successors.set(id, []);
    predecessors.set(id, []);
    indegree.set(id, 0);
  }
  for (const t of tasks) {
    for (const d of t.dependencies) {
      if (!byId.has(d.predecessorId)) continue; // ignore dangling edges
      const type = d.type ?? 'fs';
      successors.get(d.predecessorId)!.push({ id: t.id, lag: d.lagDays, type });
      predecessors.get(t.id)!.push({ id: d.predecessorId, lag: d.lagDays, type });
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
    }
  }

  // Kahn topological order.
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  const deg = new Map(indegree);
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const e of successors.get(n)!) {
      deg.set(e.id, (deg.get(e.id) ?? 0) - 1);
      if ((deg.get(e.id) ?? 0) === 0) queue.push(e.id);
    }
  }
  if (order.length !== ids.length) {
    return { tasks: {}, projectDurationDays: 0, criticalPath: [], hasCycle: true };
  }

  // Forward pass → ES/EF. Each predecessor edge imposes a minimum earliest start
  // on the successor, per relationship type (finish/start anchor on each side).
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    let start = 0;
    const d = dur(id);
    for (const p of predecessors.get(id)!) {
      const pEs = es.get(p.id) ?? 0;
      const pEf = ef.get(p.id) ?? 0;
      let min: number;
      switch (p.type) {
        case 'ss':
          min = pEs + p.lag;
          break; // successor starts after predecessor starts
        case 'ff':
          min = pEf + p.lag - d;
          break; // successor finishes after predecessor finishes
        case 'sf':
          min = pEs + p.lag - d;
          break; // successor finishes after predecessor starts
        default:
          min = pEf + p.lag; // fs: successor starts after predecessor finishes
      }
      start = Math.max(start, min);
    }
    es.set(id, start);
    ef.set(id, start + d);
  }
  const projectDuration = ids.length ? Math.max(...ids.map((id) => ef.get(id) ?? 0)) : 0;

  // Backward pass → LS/LF. Each successor edge caps this task's latest finish,
  // the mirror of the forward rule for the relationship type.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const succ = successors.get(id)!;
    const d = dur(id);
    let finish = succ.length ? Infinity : projectDuration;
    for (const s of succ) {
      const sLs = ls.get(s.id) ?? projectDuration;
      const sLf = lf.get(s.id) ?? projectDuration;
      let cap: number;
      switch (s.type) {
        case 'ss':
          cap = sLs - s.lag + d;
          break;
        case 'ff':
          cap = sLf - s.lag;
          break;
        case 'sf':
          cap = sLf - s.lag + d;
          break;
        default:
          cap = sLs - s.lag; // fs
      }
      finish = Math.min(finish, cap);
    }
    lf.set(id, finish);
    ls.set(id, finish - d);
  }

  const out: Record<string, ScheduledTask> = {};
  for (const id of ids) {
    const f = (ls.get(id) ?? 0) - (es.get(id) ?? 0);
    out[id] = {
      id,
      es: es.get(id) ?? 0,
      ef: ef.get(id) ?? 0,
      ls: ls.get(id) ?? 0,
      lf: lf.get(id) ?? 0,
      float: f,
      critical: f <= EPS,
    };
  }

  const criticalPath = ids
    .filter((id) => out[id]!.critical)
    .sort((a, b) => out[a]!.es - out[b]!.es || out[a]!.ef - out[b]!.ef);

  return { tasks: out, projectDurationDays: projectDuration, criticalPath, hasCycle: false };
}

export interface ProgressResult {
  /** Weighted, verified completion (0–100). */
  earnedPct: number;
  /** Weighted schedule baseline — how much should be done by now (0–100). */
  plannedPct: number;
  /** Schedule Performance Index = earned ÷ planned. 1 = on schedule. */
  spi: number;
  totalWeight: number;
}

const MS_PER_DAY = 86_400_000;

function earnedPctFor(task: SchedTask): number {
  return task.status === 'done' ? 100 : 0;
}

/** How much of a task SHOULD be complete by `now`, from its planned window.
 *  Undated tasks mirror their earned % so they don't distort the SPI. */
function plannedPctFor(task: SchedTask, now: number): number {
  if (!task.plannedStart || !task.plannedEnd) return earnedPctFor(task);
  const start = new Date(task.plannedStart).getTime();
  const end = new Date(task.plannedEnd).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return earnedPctFor(task);
  if (now <= start) return 0;
  if (now >= end || end <= start) return 100;
  return ((now - start) / (end - start)) * 100;
}

/** Duration-or-cost-weighted earned vs planned progress. If every weight is 0
 *  (e.g. all milestones), tasks are weighted equally so the bar still moves. */
export function computeProgress(tasks: SchedTask[], now: Date = new Date()): ProgressResult {
  const nowMs = now.getTime();
  const useEqual = tasks.every((t) => (t.weight ?? 0) <= 0);
  let ev = 0;
  let pv = 0;
  let total = 0;
  for (const t of tasks) {
    const w = useEqual ? 1 : Math.max(0, t.weight);
    total += w;
    ev += (w * earnedPctFor(t)) / 100;
    pv += (w * plannedPctFor(t, nowMs)) / 100;
  }
  return {
    earnedPct: total > 0 ? (ev / total) * 100 : 0,
    plannedPct: total > 0 ? (pv / total) * 100 : 0,
    spi: pv > EPS ? ev / pv : 1,
    totalWeight: total,
  };
}

export type ScheduleHealth = 'ahead' | 'on_track' | 'slightly_behind' | 'behind';

export function scheduleHealth(spi: number): ScheduleHealth {
  if (spi >= 1.02) return 'ahead';
  if (spi >= 0.95) return 'on_track';
  if (spi >= 0.85) return 'slightly_behind';
  return 'behind';
}

/** Inclusive whole-day duration between two ISO dates (min 1). Milestones with a
 *  single date resolve to 1. Returns fallback when unparseable/missing. */
export function inclusiveDays(
  startISO?: string | null,
  endISO?: string | null,
  fallback = 1,
): number {
  if (!startISO || !endISO) return fallback;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return fallback;
  return Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1);
}
