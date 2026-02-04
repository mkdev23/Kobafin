import Link from "next/link";

type PotLike = {
  id: string;
  // mock fields
  title?: string;
  subtitle?: string;
  color?: string;
  durationMonths?: number;
  targetUsd?: number;
  apr?: number;
  // backend fields
  name?: string;
  strategyId?: string;
  balanceUsd?: number;
  balanceSol?: number;
};

export function PotCard({ pot, href }: { pot: PotLike; href?: string }) {
  const bg = pot.color === "dark" ? "bg-slate-900" : "bg-[var(--kb-blue)]";
  const title = pot.name || pot.title || "Pot";
  const subtitle = pot.subtitle || (pot.strategyId ? `${pot.strategyId.toUpperCase()} strategy` : "");
  const content = (
    <div className={`rounded-2xl ${bg} p-4 text-white`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-white/80">{subtitle}</div> : null}
        </div>
        {pot.durationMonths ? (
          <div className="rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold">
            {pot.durationMonths} mo
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-end justify-between">
        <div>
          {typeof pot.balanceUsd === "number" ? (
            <div className="text-2xl font-semibold">$ {pot.balanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          ) : typeof pot.targetUsd === "number" ? (
            <div className="text-2xl font-semibold">$ {pot.targetUsd.toLocaleString()}</div>
          ) : (
            <div className="text-2xl font-semibold">{pot.apr ?? 10}%</div>
          )}
          <div className="mt-0.5 text-xs text-white/75">
            {typeof pot.balanceUsd === "number" ? "Balance" : typeof pot.targetUsd === "number" ? "Target" : "Estimated APR"}
          </div>
        </div>
        <div className="text-xs text-white/80">View</div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
