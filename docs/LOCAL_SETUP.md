# Local setup — VS Code + Claude Code (terminal)

How to run DatumPro locally and continue development with Claude Code in your
terminal. (For deployment, see the README; for the design rationale, see
`ARCHITECTURE.md`.)

## Prerequisites

```bash
# Node 20+  (check: node -v)
corepack enable                          # enables pnpm (this is a pnpm monorepo)

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
# alt: curl -fsSL https://claude.ai/install.sh | bash

# GitHub CLI (so `git push` uses your account) — recommended
#   macOS: brew install gh   |   Windows: winget install GitHub.cli
```

Install **VS Code** and use its integrated terminal (`` Ctrl+` ``) to run `claude`.

## Authenticate

```bash
claude          # first run → /login (Anthropic account)
gh auth login   # GitHub HTTPS auth for pushing
```

## Clone & run

```bash
git clone https://github.com/karumbidza/datumpro.git
cd datumpro
pnpm install
```

Create **`apps/web/.env.local`** (gitignored — never commit it):

```
NEXT_PUBLIC_SUPABASE_URL=https://tpuewautmatwvmabomov.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your sb_publishable_… key>
NEXT_PUBLIC_APP_URL=http://localhost:3000

# server-only — bypasses RLS, never expose/commit
SUPABASE_SECRET_KEY=<your sb_secret_… key>
```

> Get both keys from Supabase → **Settings → API**. The publishable key is safe to
> ship to the browser (protected by RLS); the secret key is server-only.

Apply the schema (first time): Supabase → **SQL Editor** → paste
`supabase/bootstrap.sql` → **Run**. Then set Auth → **URL Configuration**:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**`

Run the web app:

```bash
pnpm --filter @datumpro/web dev          # http://localhost:3000
```

Click the loop: sign in (magic link) → create organisation → create project →
open it → **New site report**.

## Claude Code in this repo

```bash
cd datumpro
claude
```
- It auto-loads `.mcp.json` and will prompt you to **authorize the Supabase MCP**
  (browser OAuth). Approve it → Claude can then run SQL / apply migrations / inspect
  the schema directly. Manage with `/mcp`.
- A fresh local session doesn't carry prior chat memory — everything needed is in
  the repo. To get Claude up to speed: *"read docs/ARCHITECTURE.md and the recent
  commits; we're building the next slice."*

## Useful commands

```bash
pnpm --filter @datumpro/shared test      # domain/permission unit tests
pnpm --filter @datumpro/web build        # production build check
pnpm --filter @datumpro/web exec tsc --noEmit   # typecheck
pnpm db:start && pnpm db:reset           # OPTIONAL local Supabase (needs Docker)
```

## Build slices

1. ✅ Foundation — tenancy + projects + RLS + access + web shell.
2. ✅ Monitoring (2a) — site reports + web UI. **2b:** offline Expo + PowerSync.
3. Requests & approvals.
4. Finance — budget/BOQ, invoices, POP, variations, Paynow.
5. Hardening — notifications, Sentry, CI, reporting.
