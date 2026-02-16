# KobaFin V1.5 (Web + API + Signer + Agent + CRE Workflow Scaffold)

This repository contains the KobaFin savings app plus a V1.5 risk-governance scaffold:

- `web/` Next.js frontend
- `backend/src/index.ts` main Fastify API
- `backend/signerService.ts` policy signer service (`POST /update_policy`)
- `agent/agentServer.ts` advisory agent API (`POST /propose`)
- `cre/workflow.ts` Chainlink CRE workflow logic (scheduled orchestration)
- `cre/config.json` CRE runtime config
- `project.yaml` CRE target settings (`staging-settings` / `production-settings`)

## Important Status

CRE simulation in this repo now requires:
- `project.yaml` target entries with `user-workflow` + `workflow-artifacts`
- `cre/package.json` with `@chainlink/cre-sdk`
- one-time `bun x cre-setup` inside `cre/`

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
- Bun runtime
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
SIGNER_ALLOW_OFFCHAIN_POLICY="true"
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
npm run dev:signer
```

Terminal C (agent service):

```bash
cd backend
npm run dev:agent
```

Agent supports deterministic mode or LLM mode via env:

```bash
# Optional: LLM-backed agent
AGENT_MODE="auto" # auto | llm | rules
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-4.1-mini"
OPENAI_BASE_URL="https://api.openai.com/v1"
AGENT_TIMEOUT_MS="12000"
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
NEXT_PUBLIC_SOLANA_CHAIN="devnet" # devnet | testnet | mainnet-beta
```

Terminal E (optional smoke test):

```bash
cd backend
npm run smoke:v15
```

## 3) Health Checks

```bash
curl http://localhost:3001/health
curl http://localhost:3010/health
curl http://localhost:3020/health
```

Governance snapshot endpoint (used by CRE):

```bash
curl -H "x-internal-key: $INTERNAL_API_KEY" http://localhost:3001/v1/governance/pods
```

## 4) Test Policy Update

```bash
curl -X POST http://localhost:3010/update_policy \
  -H "Content-Type: application/json" \
  -d '{"pod_id":"low","target_allocations_bps":{"usdc":7000,"btc":1500,"eth":1000,"sol":500},"usdc_in_lulo_bps":7000,"risk_state":"NORMAL"}'
```

If your currently deployed escrow program does not yet include `update_policy`, signer can run in safe fallback mode (`SIGNER_ALLOW_OFFCHAIN_POLICY=true`) and return `simulated: true`.

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

## 6) CRE Setup

```bash
cd cre
bun install
PATH=/snap/bin:$PATH bun x cre-setup
```

Then set runtime endpoints in `cre/config.json`:
- `govBackendBaseUrl`
- `agentBaseUrl`
- `signerBaseUrl`
- Chainlink feed URLs (`chainlinkSolanaBtcUsdUrl`, `chainlinkSolanaEthUsdUrl`, `chainlinkSolanaSolUsdUrl`)

## 7) Proof Of Real CRE Execution

`smoke:v15` proves service wiring, but it is not a CRE-triggered run.  
For hackathon evidence, run CRE directly after login.

1. Install CRE CLI (WSL):

```bash
curl -sSL https://cre.chain.link/install.sh | bash
```

2. Login:

```bash
~/.cre/bin/cre login
```

3. Run a CRE simulation using this workflow:

```bash
cd /mnt/c/users/mukub/projects/kobafin
PATH=/snap/bin:$PATH ~/.cre/bin/cre workflow simulate ./cre --non-interactive --trigger-index 0 --engine-logs -e backend/.env
```

4. Capture evidence in logs:
- backend log should show `governance_pods_requested` / `governance_pods_response` with `creRunId`
- agent log should show `agent_propose` with same `creRunId`
- signer log should show `signer_update_policy_received` and tx result with same `creRunId`
- signer response should contain on-chain `signature` when fallback is off and program supports `update_policy`

## 8) Current V1.5 Files

- `cre/workflow.ts`
- `cre/config.json`
- `project.yaml`
- `backend/policyClamp.ts`
- `backend/signerService.ts`
- `agent/agentServer.ts`

These are TypeScript-compilable scaffolds for policy-governed orchestration and signer execution.
