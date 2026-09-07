# Landing redesign — what changed and why (2026-09-07)

Redesign of the public marketing page (`apps/web/app/page.tsx`), brief: clean,
modern, expensive, minimalist — "we get the job done, and we are worth it."

## Direction

The page now reads like a well-set contract document — an editorial paper-and-ink
voice — with the product itself as the only imagery and the only saturated
colour. That is the argument in visual form: DatumPro's promise *is* the paper
trail, so the page is the document and the product shots are the evidence.
Expensive = restraint: the page never raises its voice.

Per the follow-up direction, the palette does **not** drift from the app: white
ground, zinc ink/greys, the product blue (`brand-600`) as the single accent —
used for exactly two things, the primary CTA and the one highlighted state
inside the hero dashboard shot.

## Typography

- **One family: Newsreader** (variable, optical-size axis) — high-contrast
  display cut for headlines, sturdier text cut for body, loaded via `next/font`
  **scoped to the landing route only** (`.landing` class). The app keeps Space
  Grotesk/system sans untouched.
- Product recreations render in the app's own sans — the serif/sans contrast
  (document vs software) is the page's signature.
- Roman only: the italic cut cost ~150KB of preloaded font for three short
  phrases and pushed mobile LCP from 3.0s to 4.1s. Dropped for the performance
  floor; if a customer quote lands, weigh reinstating it.
- Lining figures forced page-wide; `tabular-nums` on every data figure.

## Structure (old → new)

- Killed: centred hero, pulsing-dot badge, background grid, browser-chrome mock,
  three equal pillar cards, icon grids, uppercase eyebrows, dark "field band"
  flip, card-on-everything, footer link columns, "Everything you need to know".
- New rhythm: left-aligned hero (headline unchanged, per decision) → three
  claim/evidence sections, alternating sides, one claim each — **The work**
  (programme, planned-vs-actual), **The money** (sealed tender), **The record**
  (audit log + DB-scoped access) → **"What the usual way costs"** (failure →
  mechanism pairs; no fabricated testimonials — a clearly marked HTML-comment
  slot awaits a real named quote) → quiet field row with the milestone-claim
  phone shot → one-line pricing ("per organisation and per active project") →
  demo form (same fields/action/honeypot/states) → FAQ → one-row footer
  (© 2026, "by Quillstone Digital" kept).
- FAQ: original four tightened to ≤2 sentences, plus two new: WhatsApp/
  spreadsheets, and patchy-signal Zimbabwe — the latter answered only from
  verified behaviour (compressed uploads at `quality: 0.6`, explicit offline
  error + retry, no offline queue).
- No self-serve signup anywhere; both CTAs are "Request a demo" + "See the
  programme view" (no walkthrough video exists — checked).

## Evidence policy

Product shots stay **faithful HTML recreations** (crisper than PNGs, themable,
can't drift) but every name and figure now comes from the seeded Meridian
Construction demo org (`docs/DEMO.md`): projects at 100/90/18%, payments
$440k/$156k/$100k, tasks "Plastering & screeds" / "Internal finishes &
painting" / "Balcony balustrades", contractors BuildRight/AquaPlumb/Spark,
actors Patience/Brian/Allen. The tender shot shows the **sealed** state — no
amounts — because the demo defines none and sealed is the point. Marketing
sentences were removed from inside the shots (product UI speaks product).

⚠️ **Caveat:** at build time the connected Supabase DB contained only a fresh
test org ("Chugutu road works"), not the Meridian seed — shots were built from
`docs/DEMO.md`. If the demo org is reseeded with different data, re-check the
figures.

## Motion

One orchestrated load moment: hero lines rise/fade staggered, dashboard settles
last (`land-rise`, CSS-only, ~1s total). CTA hover: colour deepen + 2px arrow
nudge. Everything behind `prefers-reduced-motion`.

## Craft floor — measured

- axe: **0 violations**, light and dark (fixed: page `text-zinc-500` → `600`,
  4.44:1 → 5.8:1; cookie-consent backdrop was a nameless `<button>`, now a
  `div` when non-dismissable — that fix touches `cookie-consent.tsx`).
- Lighthouse mobile (production build): **performance 95** (two runs), **a11y
  100**, CLS 0, TBT 10ms. Remaining LCP cost (~3.0s throttled) is the 131KB
  display font — accepted at the floor.
- No horizontal overflow at 375 (checked programmatically both themes).
- Focus-visible rings on every interactive element; selection colour and
  `theme-color` themed both modes; form keeps real error (`?demo=error`),
  success (`?demo=sent`) and empty states.
- Impeccable mechanical detector: 0 findings. Dark mode designed to the same
  floor, not inverted as an afterthought.

## Files touched

- `apps/web/app/page.tsx` — full rewrite (SEO metadata, JSON-LD, server action
  wiring, signed-in redirect all preserved; JSON-LD now escapes `<`).
- `apps/web/app/globals.css` — `.landing` scope (Newsreader, selection,
  `land-rise` keyframes + reduced-motion guard).
- `apps/web/components/consent/cookie-consent.tsx` — backdrop a11y fix.
