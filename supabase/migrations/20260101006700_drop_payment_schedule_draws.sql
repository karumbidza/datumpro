-- Retire the payment-schedule (draws) model entirely — superseded by task-based
-- payment requests. All draw code removed from web + mobile first.
drop function if exists public.submit_payment_claim cascade;
drop function if exists public.reject_payment_claim cascade;
drop table if exists public.payment_schedule cascade;
alter table public.contractor_payment_requests drop column if exists schedule_id;
