# Chat v2 — redesign notes (2026-09-07)

Modernisation of the shared conversation surface. **Both chat levels — the
project channel (`/projects/[id]/chat`) and the task Discussion DM — render the
same new `ChatPanelV2`, so they stay identical by construction** (they already
shared `ChatPanel`; v2 preserves that architecture).

## Decisions (Allen, 2026-09-07)

- **Thread visibility: whole-channel.** A thread inherits its conversation's
  visibility — no per-thread ACL. Private discussion already has a home in the
  per-contractor task DM.
- **True threads.** Replies leave the main stream and live in a rail thread
  view; parents show an "N replies" chip. Existing quoted replies (old
  `parent_message_id` rows) appear as thread replies — nothing is lost.
- **Feature flag**: `NEXT_PUBLIC_CHAT_V2` — on by default in dev/preview, off
  in production until set to `1` on Vercel. v1 (`chat-panel.tsx`) is untouched
  and remains the production surface until the flip.

## What changed

**Stream** — single left-aligned column (team channel, not SMS): no
right-aligned own messages, no per-sender coloured bubbles (the sender tint now
colours names only). 15px/1.55 body at ≤72ch. Day dividers as quiet hairlines;
5-minute grouping with hover timestamps in the gutter; an unread **"New"**
divider from your own read cursor; a subtle brand tint only on rows that
@mention you. New-message insertion stays scroll-anchored; reduced motion
respected (typing dots pulse instead of bounce, no smooth-scroll).

**Composer** — "Send" (not "Post"), Enter sends / Shift+Enter breaks (hint
shows until your first send), grows to 6 lines, placeholder "Message {name}…".
Drafts persist per conversation (localStorage). `#` opens a work-item typeahead
(tasks / snags / RFIs / payments / drawings, RLS-scoped per caller), `@`
mentions people; both keyboard-navigable. Sends are optimistic ("sending…" →
"sent"); a network failure or offline state queues the message with an explicit
**"Will send when back online"**, persisted across reloads and flushed on
reconnect — verified end-to-end with a browser test (offline → queued → online
→ delivered). Attachments deliberately refuse to queue (bytes need a
connection; the error says so). ↑ edits your last message; Esc closes menus and
the thread.

**Rich content** — photo grids (2-up mobile / 3-up desktop) with a
geotag + time overlay when metadata exists; voice notes as a decoded-peak
waveform player with duration (WebAudio, `<audio>` fallback); compact file
cards with type and size; work-item link chips with live status dot that
navigate to the item. Web uploads record capture time (`taken_at`); browsers
strip EXIF GPS, so coordinates come from the mobile app's sender path (which
has the columns waiting).

**Threads, reactions, pins** — thread view replaces the rail content with a
clear ← Back, parent + replies + its own reply box. Reactions are a six-emoji
hover tray (👍 ✅ ❤️ 😂 🎉 👏) with counts always shown; pin/edit/delete live in
the row's overflow menu; the Pinned tab is unchanged.

**Header & rail** — Details toggle collapses the rail on desktop; the
duplicated register icon row is gone (registers are now text links in the About
tab); People/Pinned/Files/About tabs unchanged; the rail is a sheet on mobile,
labelled as its own landmark.

**Today on site** — the two bolted-on To-dos/Events cards became one strip
above the composer showing counts, expanding inline to the existing management
UIs. *Deliberate deviation from the brief*: it hides at 0 · 0 for
non-managers but stays visible for managers — the strip is the only place a
first to-do/event can be created from chat, so hiding it at zero would
dead-end the feature.

**Empty state** — "{Project} · N people. Post the first site update." with
three real quick actions (Share a photo → picker; Post a site diary note →
diary; Mention a contractor → composer with `@`) and the people row with
presence. No illustration.

## Data model (migration `20260907120000_chat_v2_links_mentions_geo`, applied)

- `message_links` — work-item references; label/status resolved live at read
  time (never snapshotted). RLS mirrors `message_pins` (can_access_chat +
  sender-only insert).
- `message_mentions` — mention rows for the tint (notification fan-out is a
  follow-up).
- `message_attachments` + `lat`, `lng`, `taken_at`.
- Partial index on `messages(parent_message_id)` for reply counts.

## Craft gates

- axe on the signed-in chat page: **0 violations** (fixes along the way:
  people-rail secondary text, sidebar/mobile-nav/toast uppercase micro-labels
  zinc-400 → zinc-500, unique `aside` landmarks, sr-only page h1).
- Impeccable mechanical detector: 0 findings (typing dots were the one hit —
  bounce → pulse).
- Every icon button labelled; focus rings on all new controls; tabular
  numerals on times/counts; no horizontal overflow at 375 (grid 2-up, full-width
  waveform, sticky composer above the keyboard).

## Demo seed

`scripts/seed/chat-demo.mjs` (service role, idempotent unless `--force`)
seeds the live demo project's channel: pinned kickoff, contractor site update,
three geotagged photos, a thread with two replies, an 11-second voice note, a
task link chip, an @mention and reactions. Photos/voice are generated
placeholder media (pure-JS PNG encoder + WAV synth — no native deps), in the
same spirit as the existing seeded site photos. Note: the live DB currently
holds the fresh test org ("Chugutu road works"), not the Meridian seed — the
script targets whatever project conversation exists.

## Known follow-ups

- Mention notifications (rows exist; fan-out not wired).
- Thread mini-composer is text-only (attachments/links post to the channel).
- Search results are a separate filtered view (kept from v1) rather than
  inline stream filtering.
- Mobile app parity: the same flat-stream/thread/queue treatment on the Expo
  app, plus GPS capture for photo geotags.
- The whole-system UI/UX uniformity audit (requested) — next phase.
