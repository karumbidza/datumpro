# Runbook — Email deliverability (SPF, DKIM, DMARC)

DatumPro sends transactional email (invitations, password resets, notifications)
through **Resend**. For those emails to reach the inbox — not spam, and not get
silently dropped by government/enterprise mail filters — the sending domain needs
three DNS records. **These are DNS changes at your domain host; they can't be set
from the app.**

> Sending domain: use a domain you control DNS for — e.g. `quillstonecapital.com`
> (or a subdomain like `mail.quillstonecapital.com`). The app's `RESEND_FROM_EMAIL`
> must be an address **on that verified domain** (e.g. `noreply@quillstonecapital.com`).

---

## What each record is for

- **SPF** (Sender Policy Framework) — a DNS record listing which servers are
  allowed to send mail *for your domain*. Receiving servers reject/junk mail from
  senders not on the list. It authorises Resend to send as you.
- **DKIM** (DomainKeys Identified Mail) — Resend signs every message with a private
  key; the matching **public key** lives in your DNS. Receivers verify the
  signature, proving the message really came from you and wasn't tampered with.
- **DMARC** (Domain-based Message Authentication) — a policy that tells receivers
  what to do when SPF/DKIM fail (nothing / quarantine / reject) and where to send
  reports. It's what stops others **spoofing** your domain, and most enterprise
  filters expect it to exist.

SPF + DKIM prove authenticity; DMARC sets the enforcement policy and gives you
visibility. You want all three.

---

## Steps

### 1. Add & verify the domain in Resend
1. Resend dashboard → **Domains** → **Add Domain** → enter your sending domain.
2. Resend generates the exact **SPF** and **DKIM** records for *your* domain (the
   DKIM key is unique per domain — copy the values Resend shows; they can't be
   guessed here).
3. Add each record at your DNS host **exactly** as Resend lists it. Typically:
   - an **MX** + **TXT (SPF)** record on a `send.` subdomain (bounce handling), and
   - a **TXT/CNAME (DKIM)** record like `resend._domainkey` with the public key.
4. Back in Resend, click **Verify**. DNS can take minutes to a few hours to
   propagate; the domain shows **Verified** once the records resolve.

### 2. Add a DMARC record
Create this TXT record (this one is standard — safe to use as-is):

```
Host/Name:  _dmarc.quillstonecapital.com
Type:       TXT
Value:      v=DMARC1; p=none; rua=mailto:dmarc@quillstonecapital.com; fo=1
```

- Start at **`p=none`** (monitor only — nothing is rejected yet) and watch the
  aggregate reports sent to the `rua` address for a week or two.
- Once you confirm all legitimate mail passes, tighten to **`p=quarantine`**, then
  **`p=reject`** for full anti-spoofing protection.
- Make sure `dmarc@quillstonecapital.com` (or wherever `rua` points) is a real
  inbox.

### 3. Point the app at the verified domain
- Set `RESEND_FROM_EMAIL` to an address on the verified domain, e.g.
  `DatumPro <noreply@quillstonecapital.com>`.
- Set `RESEND_API_KEY` to your Resend key.
- (The app already warns at boot if only one of these is set — see `lib/env.server.ts`.)

### 4. Verify it works
- Trigger a real email (invite yourself, or run a password reset).
- Open the received message → **Show original / headers** and confirm
  `SPF: pass`, `DKIM: pass`, `DMARC: pass`.
- Optional: send a test to **https://www.mail-tester.com** for a 10/10 score and a
  checklist of anything still missing.

---

## Notes
- If you send from a **subdomain** (e.g. `mail.quillstonecapital.com`), put the
  DMARC record on the subdomain too, or rely on the organisational DMARC at the
  root — but the `From` domain, SPF domain and DKIM `d=` should align for DMARC to
  pass (**alignment**).
- Keep the number of `include:` mechanisms in SPF under 10 (the DNS-lookup limit);
  Resend's single include is fine.
- Re-verify after any DNS migration or host change.
