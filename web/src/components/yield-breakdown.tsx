"use client";

type YieldBreakdownProps = {
  title?: string;
  principalUsd?: number | null;
  apy?: number | null;
  cashUsd?: number | null;
  investedUsd?: number | null;
  variant?: "card" | "plain";
};

function money(n: number) {
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

function fmtUsd(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "--";
  return `USD ${money(n)}`;
}

function fmtPct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "--";
  return `${n.toFixed(2)}%`;
}

export function YieldBreakdownCard({
  title = "Yield breakdown",
  principalUsd,
  apy,
  cashUsd,
  investedUsd,
  variant = "card",
}: YieldBreakdownProps) {
  const principal = Number.isFinite(principalUsd ?? NaN) ? Number(principalUsd) : null;
  const cash = Number.isFinite(cashUsd ?? NaN) ? Number(cashUsd) : null;
  const invested = Number.isFinite(investedUsd ?? NaN) ? Number(investedUsd) : null;
  const apyPct = Number.isFinite(apy ?? NaN) ? Number(apy) : null;

  const projectedAnnual =
    principal !== null && apyPct !== null ? (principal * apyPct) / 100 : null;
  const projectedMonthly = projectedAnnual !== null ? projectedAnnual / 12 : null;

  const showSplit = cash !== null || invested !== null;

  const body = (
    <>
      <div className="text-sm font-semibold">{title}</div>
      <div className="stack" style={{ marginTop: 10, gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">USDC principal</div>
          <div className="text-sm font-semibold">{fmtUsd(principal)}</div>
        </div>
        {showSplit ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="label">Cash in vault</div>
              <div className="text-sm font-semibold">{fmtUsd(cash)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="label">Invested in Lulo</div>
              <div className="text-sm font-semibold">{fmtUsd(invested)}</div>
            </div>
          </>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">Current APY</div>
          <div className="text-sm font-semibold">{fmtPct(apyPct)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">Est. annual yield</div>
          <div className="text-sm font-semibold">{fmtUsd(projectedAnnual)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">Est. monthly yield</div>
          <div className="text-sm font-semibold">{fmtUsd(projectedMonthly)}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">Accrued yield</div>
          <div className="text-sm font-semibold">--</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="label">Lifetime yield</div>
          <div className="text-sm font-semibold">--</div>
        </div>
      </div>
      <p className="p" style={{ marginTop: 10 }}>
        Yield is variable and not guaranteed. Accrued and lifetime yield update after Lulo balances sync.
      </p>
    </>
  );

  if (variant === "plain") {
    return <div>{body}</div>;
  }

  return <div className="card">{body}</div>;
}
