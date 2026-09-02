/** Work Pulse — the dashboard's dynamic greeting engine.
 *
 *  Pure, deterministic composition: given the signed-in user's workspace signals
 *  (all sourced from real DB values) and the current *local* time, produce a human
 *  greeting — a time-of-day line plus one contextual insight chosen by priority, and
 *  a compact "at a glance" line. No randomness, no fabricated numbers: every clause
 *  is backed by a count the caller measured. Kept framework-free so it unit-tests
 *  and runs identically on the server or in the browser. */

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'late';

/** All figures are real counts measured for the current user (RLS-scoped). */
export interface WorkPulseData {
  firstName: string;
  pendingApprovals: number; // approvals waiting on this user
  overdueTasks: number; // not done, past their due date
  notStartedTasks: number; // planned start is past but still to-do (behind on starting)
  dueTodayTasks: number; // due today, not done
  dueSoonTasks: number; // due within the next 2 days (excludes today), not done
  upcomingTasks: number; // not done, due within the next 7 days
  blockedTasks: number;
  completedThisWeek: number; // tasks this user finished this week
  recentActivityCount: number; // task activity across the workspace in the last few hours
  userRecentlyActive: boolean; // this user did something in the last hour
  overallProgressPct: number | null; // portfolio progress, when known
  activeProjectName: string | null; // the project most of the upcoming work sits on
  nextDeadlineIso: string | null; // YYYY-MM-DD of the next task due
}

export interface WorkPulseGreeting {
  primary: string; // "Good afternoon, Allen"
  insight: string; // the one contextual sentence
  glance: string | null; // "1 approval · 7 upcoming · Next deadline Sep 3"
  emoji: string | null; // an optional, sparingly-used accent for the primary line
}

export interface ComposeOptions {
  /** The client may allow a playful late-night line (subject to its own cooldown). */
  allowPlayful?: boolean;
}

export function timeOfDay(now: Date): TimeOfDay {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'late';
}

const cap = (s: string): string => (s.length ? s[0]!.toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function primaryLine(data: WorkPulseData, tod: TimeOfDay, opts: ComposeOptions): { text: string; emoji: string | null } {
  const name = data.firstName;
  if (tod === 'late') {
    if (opts.allowPlayful && data.userRecentlyActive) {
      return { text: `Burning the midnight oil, ${name}?`, emoji: '🌙' };
    }
    return { text: `Good evening, ${name}`, emoji: null };
  }
  const word = tod === 'morning' ? 'Good morning' : tod === 'afternoon' ? 'Good afternoon' : 'Good evening';
  return { text: `${word}, ${name}`, emoji: null };
}

/** Full, self-contained clauses so singular/plural always agrees when combined. */
function attentionClauses(data: WorkPulseData): { priority: number; clause: string }[] {
  const out: { priority: number; clause: string }[] = [];
  if (data.overdueTasks > 0) {
    out.push({
      priority: 100,
      clause: plural(
        data.overdueTasks,
        '1 task has slipped past its planned date',
        `${data.overdueTasks} tasks have slipped past their planned dates`,
      ),
    });
  }
  if (data.notStartedTasks > 0) {
    out.push({
      priority: 90,
      clause: plural(
        data.notStartedTasks,
        '1 task should have started but hasn’t',
        `${data.notStartedTasks} tasks should have started but haven’t`,
      ),
    });
  }
  if (data.pendingApprovals > 0) {
    out.push({
      priority: 80,
      clause: plural(
        data.pendingApprovals,
        '1 approval is waiting for you',
        `${data.pendingApprovals} approvals are waiting for you`,
      ),
    });
  }
  if (data.dueTodayTasks > 0) {
    out.push({
      priority: 72,
      clause: plural(data.dueTodayTasks, '1 task is due today', `${data.dueTodayTasks} tasks are due today`),
    });
  }
  if (data.dueSoonTasks > 0) {
    out.push({
      priority: 70,
      clause: plural(
        data.dueSoonTasks,
        '1 task is due in the next couple of days',
        `${data.dueSoonTasks} tasks are due in the next couple of days`,
      ),
    });
  }
  if (data.blockedTasks > 0) {
    out.push({
      priority: 65,
      clause: plural(data.blockedTasks, '1 task is blocked', `${data.blockedTasks} tasks are blocked`),
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

function insightLine(data: WorkPulseData): string {
  // 1. Attention items (overdue > approvals > deadlines > blocked) — combine the
  //    top two into one natural sentence.
  const attention = attentionClauses(data);
  if (attention.length >= 2) {
    return `${cap(attention[0]!.clause)}, and ${attention[1]!.clause}.`;
  }
  if (attention.length === 1) {
    return `${cap(attention[0]!.clause)}.`;
  }

  // 2. Workload — what's coming up (project-aware when one project dominates).
  if (data.upcomingTasks > 0) {
    if (data.activeProjectName) {
      return plural(
        data.upcomingTasks,
        `${data.activeProjectName} has 1 task coming up this week.`,
        `${data.activeProjectName} has ${data.upcomingTasks} tasks coming up this week.`,
      );
    }
    return plural(
      data.upcomingTasks,
      `You've got 1 task coming up this week.`,
      `You've got ${data.upcomingTasks} tasks coming up this week.`,
    );
  }

  // 3. A positive note when a good chunk got done and nothing's pressing.
  if (data.completedThisWeek >= 5) {
    return `Nice work — you've cleared ${data.completedThisWeek} tasks this week.`;
  }

  // 4. Progress.
  if (data.overallProgressPct != null && data.overallProgressPct > 0) {
    if (data.activeProjectName) {
      return `${data.activeProjectName} is ${data.overallProgressPct}% of the way there.`;
    }
    return `Things are moving — overall progress is at ${data.overallProgressPct}%.`;
  }

  // 5. Recent workspace activity.
  if (data.recentActivityCount > 0) {
    return plural(
      data.recentActivityCount,
      `1 update has landed in the last few hours.`,
      `${data.recentActivityCount} updates have landed in the last few hours.`,
    );
  }

  // 6. Quiet — nothing needs the user.
  return `Nice and quiet — nothing urgent is waiting for you.`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  const mi = Number(m) - 1;
  if (mi < 0 || mi > 11 || !d) return iso;
  return `${MONTHS[mi]} ${Number(d)}`;
}

function glanceLine(data: WorkPulseData): string | null {
  const parts: string[] = [];
  if (data.pendingApprovals > 0) parts.push(plural(data.pendingApprovals, '1 approval', `${data.pendingApprovals} approvals`));
  if (data.overdueTasks > 0) parts.push(plural(data.overdueTasks, '1 overdue', `${data.overdueTasks} overdue`));
  if (data.upcomingTasks > 0) parts.push(plural(data.upcomingTasks, '1 upcoming', `${data.upcomingTasks} upcoming`));
  if (data.nextDeadlineIso) parts.push(`Next deadline ${shortDate(data.nextDeadlineIso)}`);
  // Only worth a glance line when there are at least two distinct facts to show.
  return parts.length >= 2 ? parts.slice(0, 3).join(' · ') : null;
}

/** Compose the full greeting from real signals and the viewer's local time. */
export function composeWorkPulse(data: WorkPulseData, now: Date, opts: ComposeOptions = {}): WorkPulseGreeting {
  const tod = timeOfDay(now);
  const primary = primaryLine(data, tod, opts);
  return {
    primary: primary.text,
    insight: insightLine(data),
    glance: glanceLine(data),
    emoji: primary.emoji,
  };
}
