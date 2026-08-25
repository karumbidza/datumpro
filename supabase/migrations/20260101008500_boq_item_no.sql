-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — preserve original BOQ item numbers
--
-- Imported bills carry their own item references (e.g. 1.1, 1.6, A2.3.1). We keep
-- them verbatim so a priced bill reads exactly like the client's spreadsheet,
-- instead of being re-numbered positionally. Null = fall back to the positional
-- number the builder derives (manually-added items, older rows).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.boq_items add column item_no text;
