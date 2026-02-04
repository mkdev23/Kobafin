export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") || "http://localhost:3001";

export type StrategyId = "low" | "med" | "high";

export type Strategy = {
  id: StrategyId;
  name: string;
  allocations: Record<string, number>;
  execution?: Record<string, unknown>;
  strategyKey?: string;
  riskTier?: string;
  luloMode?: string;
};

export type User = {
  id: string;
  walletAddress: string | null;
  recoveryMode?: boolean;
  recoveryLockedUntil?: string | null;
  recoveryUpdatedAt?: string | null;
};

export type Pot = {
  id: string;
  userId: string;
  name: string;
  strategyId: StrategyId;
  strategyKey?: string | null;
  riskTier?: string | null;
  goalUsd?: number | null;
  isLocked?: boolean | null;
  createdAt: string;
  // Optional dashboard enrichment (computed from on-chain vault PDAs)
  balanceSol?: number;
  balanceUsd?: number;
  cashUsd?: number;
  investedUsd?: number;
  totalUsd?: number;
};

export type LuloRates = {
  regular?: Record<string, number>;
  protected?: Record<string, number>;
};

export type DepositStatus =
  | "MOCK_SETTLED"
  | "SOL_CONFIRMED"
  | "WITHDRAW_CONFIRMED"
  | "FEE_CONFIRMED"
  | `SOL_PENDING:${number}`
  | `WITHDRAW_PENDING:${number}`
  | "USDC_CONFIRMED"
  | `USDC_PENDING:${number}`
  | "ALLOC_PENDING"
  | "ALLOC_SENT"
  | "ALLOC_CONFIRMED";

export type Deposit = {
  id: string;
  userId: string;
  potId: string;
  netUsdc: number;
  amountLamports?: string | null;
  status: DepositStatus;
  txSignature?: string | null;
  createdAt: string;
};

type ApiOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const method = opts.method ?? (opts.body ? "POST" : "GET");

  const headers: Record<string, string> = {
    ...(opts.headers || {}),
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}
