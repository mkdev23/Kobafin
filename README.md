# KOBAFIN (Web PoC + API)

This repo contains:

- `backend/` – Fastify + Prisma API
- `web/` – Next.js web PoC (the UX from your screenshots) wired to the API

## Backend (Fastify)

### 1) Install

```bash
cd backend
npm install
```

### 2) Configure env

Create `backend/.env`:

```bash
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/kobafin?schema=public"
JWT_SECRET="use-a-long-random-string"
SOLANA_RPC="https://api.testnet.solana.com"
```

### 3) DB migrate + generate

```bash
npx prisma generate
npx prisma migrate dev
```

### 4) Run API

```bash
npm run dev
```

Default API base is `http://localhost:3001`.

## Web (Next.js)

### 1) Install

```bash
cd web
npm install
```

### 2) Configure env

Create `web/.env.local`:

```bash
NEXT_PUBLIC_API_BASE="http://localhost:3001"
```

### 3) Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Notes

- Auth is “Sign in with Solana” (Phantom) using the backend `/v1/auth/nonce` + `/v1/auth/verify` flow.
- Deposits in the UI call `/v1/deposits/mock` (PoC simulation).
- Pot detail screen reads deposits from `/v1/pots/:potId/deposits`.
