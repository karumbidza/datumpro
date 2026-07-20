# Claude Code Handover A — Identity, Access & Blockers

Scope: invitation flow, username & avatar setup, role-scoped task views, act-on-behalf, blockers.

**Run this before Handover B.** B depends on contractor records and role resolution landing first.

> Attach `datumpro-snag-spec-02.md` to the session or place it at `docs/snag-spec-02.md`.

---

## Prompt

I'm refining identity, access control, and the blocker system in this codebase. **Do not scaffold new infrastructure.** Auth, storage, permissions, and UI patterns already exist here — find them and extend them.

Read `docs/snag-spec-02.md` sections 1 and 4 for target behaviour. It's a specification of intent, not a migration to run verbatim.

### Phase 0 — Audit before writing anything

Do not write code yet. Investigate and report back with file paths and line references:

1. **Current invitation flow** — is there one? Trace it end to end: trigger, token generation and storage, email/SMS send, accept route, account creation, role assignment, redirect. If none exists, say so plainly rather than assuming.
2. **User and profile schema** — the users/profiles tables, what's on them, how they relate to auth. Is there already a `username`, `avatar_url`, or display-name field? Is there a separate contractor or company record?
3. **File storage** — what's configured (Supabase Storage, R2, S3), how uploads are done today, whether image processing exists anywhere, and what the public URL pattern is.
4. **Permission model** — how are roles stored and checked? RLS policies, middleware, a permission helper, per-route guards? Show me a representative example of each layer you find.
5. **Task detail screen** — the component tree for the task view. Which actions render, and what currently gates their visibility.
6. **Existing audit logging** — is there any table or helper recording who did what? Name it if so.
7. **Notification infrastructure** — any existing in-app notification, email, or push mechanism, and any background job runner.
8. **Gap analysis** — table classifying each area as `exists, reuse as-is` / `exists, needs extension` / `missing, must create`.
9. **Risks** — anything conflicting with current structure or that would break existing records, queries, or generated types.

Stop after this and wait for my sign-off.

### Phase 1 — Invitations & profile setup

**Migrations first, additive only.** Nullable or defaulted columns on existing tables; backfill usernames for existing users from their names.

- `invitations` table per spec §1.2. Store `token_hash`, never the raw token. Partial unique index on `(org_id, email) where status = 'pending'`.
- Add to profiles: `username` (unique per org, `^[a-z0-9._-]{3,30}$`), `avatar_url`, `avatar_thumb_url`, `avatar_updated_at`.
- `national_id` is **not** part of the username. If a field is needed for contractor vetting, add it separately, admin-read-only, and do not render it anywhere in the UI.

Setup screen:
- Email pre-filled and locked from the invitation
- Username auto-suggested `firstname.lastname`, collision-resolved with a numeric suffix, editable, live availability check (debounced)
- Avatar: upload or camera capture → client-side square crop → resize 512px WebP + 96px thumb → **strip EXIF** → store
- Fallback avatar = initials on a colour deterministically hashed from `user_id`. Never a grey silhouette.
- Company and trade fields shown only when `intended_party = 'subcontractor'`

Use the existing form library, validation location, upload helper, and auth flow. Match the nearest comparable screen in the repo.

Also wire: resend (rate-limited), revoke, expiry handling, and a clear "this invitation has expired" state rather than a generic error.

### Phase 2 — Avatar surfaces

Render the avatar wherever a person is named: chat, task assignee, member lists, mentions, audit entries, comment threads. One shared `<Avatar>` component with size variants — if two avatar implementations exist when you're done, that's a failure.

Cache-bust via `avatar_updated_at` in the query string.

### Phase 3 — Role-scoped task view

Contractor panel: `Update progress`, `Submit for sign-off`, `Raise blocker`, `Upload evidence`.

PM/admin sees the same region as a **read-only status strip** — progress % and staleness, sign-off state, open blocker count with a review link — plus an explicit `Act on behalf` action.

Act-on-behalf requirements:
- Reason is mandatory
- Writes `performed_by`, `on_behalf_of`, `reason` to the audit log
- Renders a persistent badge on the task: *"Marked complete by X on behalf of Y"*
- Notifies the contractor it happened
- Gate it in RLS or server-side policy, not only in the component

Do not simply hide contractor controls from PMs — they lose awareness of what's outstanding.

### Phase 4 — Blockers

- `task_blockers` table per spec §4.2
- Grouped type picker (dependency / commercial / resources / site & external / other) — a flat 15-item list is unusable on a phone
- Auto-populate links: `predecessor_incomplete` pre-fills from the dependency graph; `payment_due` offers open invoices
- Open blocker sets a visible `is_blocked` state on the task
- Escalation: unacknowledged at 24h → PM, 48h → admin. Use the existing job runner if one exists; if not, flag it and propose the smallest option rather than adding a scheduler unasked
- Resolution requires a note and `actual_impact_days`; rejection requires a reason and notifies the raiser
- `weather` and `site_access_denied` propose a `project_calendar_exceptions` row for PM approval — reuse that table, don't create a parallel one
- Project dashboard widget: open blockers grouped by type

### Working rules

- **Small commits, one concern each.** Migrations, then types, then invitations, then avatars, then views, then blockers.
- Regenerate types after migrations using the repo's existing command.
- No new dependencies without asking — name it, say what it replaces, wait. This applies especially to image processing; check what's already available first.
- If existing code already does something in the spec, use it and tell me.
- Where the spec conflicts with an established repo pattern, **the repo pattern wins** — flag it, don't silently follow the doc.
- Permission changes must be enforced server-side. A hidden button is not access control.

### Out of scope

Tendering, quote comparison, dependency alert rules, task field additions. Those are Handover B — don't build them, but don't block them either.

Start with Phase 0.
