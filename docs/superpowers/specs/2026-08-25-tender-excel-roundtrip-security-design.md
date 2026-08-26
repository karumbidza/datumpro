# Tender Bid Excel Round-Trip + Invite Hardening — Design Spec

**Date:** 2026-08-25
**Status:** Approved design (user, 2026-08-25), pending implementation
**Depends on:** BOQ sealed tender (shipped), bid days column (shipped 2026-08-25), BOQ Excel importer patterns (`boq-importer.tsx`, SheetJS 0.20.3 patched build)

## 1. Problem

Bidders want to price offline: download the bill from the tender form, fill rates/days in Excel, and re-upload. That opens integrity questions (is the uploaded file the one we issued? for this tender? within limits?) and prompted a security review of the invite flow. Separately: clarity on the new-vs-existing contractor paths and multi-org accounts.

## 2. What already holds (no work; recorded so it isn't re-litigated)

- **Identity**: `/tender/{token}` forces sign-in; `accept_boq_bid_invite` rejects any signed-in email ≠ invited email; first accept binds `boq_bidders.user_id`; RLS scopes all bid reads/writes to that user. Budget rates never reach bidders (`tender_bill_lines` projection).
- **Progress saving**: per-cell blur upserts (rate + days travel together). Nothing volatile in the browser.
- **Accounts**: one account per person. New contractor signs up with the invited email, then accepts. Existing contractor signs in. Membership is per-org (`org_members` row per org with own role/member_type); the sidebar org switcher (cookie `dp_active_org`) rebuilds the nav per active org — contractor in Org A + owner of Org B works today with one account. Bidders are NOT org members; award enrols the winner.

## 3. Excel round-trip (authenticated bid workspace only)

**Export** — client-side (SheetJS) from the bidder's own bill view:
- Columns: `Item No | Description | Unit | Qty | Rate | Days` — Rate/Days prefilled with the bidder's current draft values (or blank).
- Hidden column `_line` carries the `boq_item_id` per row; cell `_meta` (hidden row 1) carries the tender id. Sheet name `Bid`.
- Never includes budget rates. Download allowed only while the bid is editable (open + not submitted).

**Upload** — file parsed **in the browser** (no file to the server), then one bulk action:
1. Client parses sheet `Bid`, reads `_meta` tender id and `_line` ids, extracts Rate/Days per row.
2. **Preview gate** (nothing saved yet): "N of M lines matched — X updated, Y unchanged, Z ignored (unknown lines)". Confirm applies; cancel discards.
3. **Upload wins**: confirming overwrites matched lines' rate/days with the file's values (blank rate cell → rate 0 unpriced; blank days → null). Unmatched bill lines keep their online values.
4. Bulk save via new RPC (below). UI then re-renders from the server state.

**Reject the file outright when**: `_meta` tender id ≠ this tender; sheet `Bid` missing; > 2000 rows; duplicate `_line` ids; or < 50 % of rows carry a `_line` id found in this bill (wrong/mangled file). Errors are specific ("this file belongs to a different tender").

## 4. Server hardening

**`save_bid_lines(p_token text, p_lines jsonb)`** — new SECURITY DEFINER RPC (the bulk counterpart of the per-cell save):
- Resolves the bidder by token AND `user_id = auth.uid()` (both must hold); rejects if submitted, withdrawn, or tender not open / past `close_at`.
- Validates every line: `boq_item_id` belongs to the tender's bill; `rate_cents` int ≥ 0; `duration_days` null or 0–3650; ≤ 2000 lines per call. Any invalid line rejects the whole call (no partial writes).
- **Rate limit**: `boq_bidders.bulk_upload_count` + `bulk_upload_window_start` — max 10 calls per rolling hour; 11th raises "too many uploads — try again shortly". (Same cap-on-row defence pattern as the org-creation cap.)
- Upserts all lines in one statement; returns `{saved, ignored}`.

**Invite-token lifecycle** (migration + RPC touch-ups):
- `accept_boq_bid_invite` additionally rejects when the tender is closed/cancelled or `close_at` has passed ("this tender has closed").
- **Resend rotates the token**: the resend action generates a fresh `invite_token` (old link dies) before emailing. No fixed-time expiry (per decision) — a link lives until tender close or rotation.
- Once `user_id` is bound, accept by a *different* uid with the same email is impossible (emails are unique in auth); binding is effectively one-time.

## 5. Multi-org polish

- Org switcher entries gain a role chip — "Owner", "Admin", "PM", "Staff", "Contractor", "Client" — from the membership's role/member_type, so mixed-hat users see which hat is active.
- No data-model change: everything else already works (per-org nav, cookie-remembered active org, cross-org tender invites listed on the contractor home).

## 6. Out of scope (v1)

Offline fill *before* account creation (the file is only issued inside the authenticated workspace); server-side virus scanning (no file ever reaches the server); XLSX cell-level locking/passwords (cosmetic — integrity is enforced on upload, not in the file); org-invitation flows (unchanged).

## 7. Testing

- **SQL sims + `rls_security.sql`**: save_bid_lines — foreign item id rejected, wrong-user token rejected, post-submit rejected, closed-tender rejected, rate-limit trips on the 11th call, happy-path upsert overwrites; accept-invite rejected after close; token rotation kills the old link.
- **Web**: typecheck + build; manual round-trip (export → edit → upload → preview counts → values land).

## 8. Rollout order

1. Migration: `bulk_upload_count`/`bulk_upload_window_start` on `boq_bidders`; `save_bid_lines` RPC; accept-after-close guard; resend rotation (server action + RPC if needed).
2. Bid workspace: Export button (SheetJS builder) + Upload button (parse → preview modal → bulk save).
3. Org switcher role chips.
