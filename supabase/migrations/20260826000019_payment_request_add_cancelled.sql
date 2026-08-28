-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — add a 'cancelled' payment-request status
--
-- Part of the ledger-protection rule: a contractor "withdrawing" a still-pending
-- payment request must KEEP the row (audit trail), not delete it. That withdrawal
-- becomes a status change requested → cancelled. This migration only adds the enum
-- value; the trigger/policy changes that use it live in the next migration, because
-- a new enum value added inside a transaction cannot be used in that same
-- transaction. Supabase applies each migration file in its own transaction, so the
-- value is committed here before 20260826000020 references it.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.payment_request_status add value if not exists 'cancelled';
