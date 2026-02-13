# KobaFin V1.5 (Web + API + Signer + Agent + CRE Workflow Scaffold)

This repository contains the KobaFin savings app plus a V1.5 risk-governance scaffold:

- `web/` Next.js frontend
- `backend/src/index.ts` main Fastify API
- `backend/signerService.ts` policy signer service (`POST /update_policy`)
- `agent/agentServer.ts` advisory agent API (`POST /propose`)
- `cre/workflow.ts` Chainlink CRE workflow logic (scheduled orchestration)
- `cre/config.yaml` CRE workflow config

## Important Status

The CRE workflow code is present and type-checked, but this repo was not bootstrapped with a generated CRE project yet.  
If your installed Chainlink CRE CLI expects project metadata, run `cre init` once in this directory and map it to the existing `cre/workflow.ts` and `cre/config.yaml`.

## How CRE And AI Are Used

- CRE role: orchestration layer
  - schedule trigger (cron)
  - fetch prices/state over HTTP
  - call agent API
  - apply hard policy clamp
  - submit final update to signer service
  - write on-chain audit marker
- AI role: advisory only
  - agent proposes weights and risk state
  - hard floors and bounds are enforced in `backend/policyClamp.ts`
  - agent cannot bypass safety guarantees

## Prerequisites

- Node.js 20+
- npm
- Solana CLI
- Anchor CLI
- Devnet SOL for testing

## 1) Backend Setup

```bash
cd backend
npm install
```

Create `backend/.env` (example):

```bash
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/kobafin?schema=public"
JWT_SECRET="replace-with-long-random-string"
SOLANA_RPC="https://api.devnet.solana.com"
KOBA_ESCROW_PROGRAM_ID="8igAph8Ypy6YZh1QLhzzkvVkzGybzjCyBawAtHpWtVLX"

# signer key: set one of the following
SOLANA_KEYPAIR_PATH="/home/mukub/.config/solana/id.json"
# SIGNER_SECRET_KEY_B58="..."
# SIGNER_SECRET_KEY_JSON="[1,2,3,...]"

SIGNER_PORT="3010"
```

Run prisma:

```bash
npx prisma generate
npx prisma migrate dev
```

## 2) Run Services Locally

Open separate terminals.

Terminal A (main API):

```bash
cd backend
npm run dev
```

Terminal B (signer service):

```bash
cd backend
npx tsx signerService.ts
```

Terminal C (agent service):

```bash
cd backend
npx tsx ../agent/agentServer.ts
```

Terminal D (web app):

```bash
cd web
npm install
npm run dev
```

Set `web/.env.local`:

```bash
NEXT_PUBLIC_API_BASE="http://localhost:3001"
```

## 3) Health Checks

```bash
curl http://localhost:3001/health
curl http://localhost:3010/health
curl http://localhost:3020/health
```

## 4) Test Policy Update

```bash
curl -X POST http://localhost:3010/update_policy \
  -H "Content-Type: application/json" \
  -d '{"pod_id":"low","target_allocations_bps":{"usdc":7000,"btc":1500,"eth":1000,"sol":500},"usdc_in_lulo_bps":7000,"risk_state":"NORMAL"}'
```

## 5) Anchor Program (Devnet)

```bash
solana config set --url https://api.devnet.solana.com
solana balance

cd anchor/kobafin_escrow
RUSTUP_TOOLCHAIN=nightly anchor build
RUSTUP_TOOLCHAIN=nightly anchor deploy --provider.cluster devnet
```

After deploy, ensure program id is aligned in:

- `anchor/kobafin_escrow/programs/kobafin_escrow/src/lib.rs`
- `anchor/kobafin_escrow/Anchor.toml`
- `backend/.env` (`KOBA_ESCROW_PROGRAM_ID`)

## 6) CRE Bootstrap (If Needed)

If your CRE CLI requires initialization metadata in this repository:

```bash
cd /mnt/c/users/mukub/projects/kobafin
cre init
```

Then point CRE to:

- workflow entrypoint: `cre/workflow.ts`
- handler: `run`
- config: `cre/config.yaml`

CLI command names can vary by CRE version. Use:

```bash
cre --help
cre init --help
```

and select the equivalent run/validate commands for your installed version.

## 7) Current V1.5 Files

- `cre/workflow.ts`
- `cre/config.yaml`
- `backend/policyClamp.ts`
- `backend/signerService.ts`
- `agent/agentServer.ts`

These are TypeScript-compilable scaffolds for policy-governed orchestration and signer execution.
