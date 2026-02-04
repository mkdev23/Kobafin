"use client";

import { useEffect, useMemo, useState } from "react";

const DISCLOSURE_KEY = "kb_disclosures_v1";

export const DISCLOSURE_ITEMS = [
  "Crypto assets are volatile.",
  "Only USDC earns yield in V1.",
  "Yield is variable and not guaranteed.",
  "Portfolio value may fluctuate.",
  "No auto-rebalancing in V1.",
];

export function useDisclosureAcceptance() {
  const [accepted, setAccepted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DISCLOSURE_KEY);
      setAccepted(raw === "true");
    } catch {
      setAccepted(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  const updateAccepted = (next: boolean) => {
    setAccepted(next);
    try {
      window.localStorage.setItem(DISCLOSURE_KEY, next ? "true" : "false");
    } catch {
      // ignore
    }
  };

  return { accepted, setAccepted: updateAccepted, loaded };
}

export function DisclosuresCard({
  accepted,
  onToggle,
  title = "Required acknowledgements",
  compact,
}: {
  accepted: boolean;
  onToggle: (next: boolean) => void;
  title?: string;
  compact?: boolean;
}) {
  const items = useMemo(() => DISCLOSURE_ITEMS, []);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="text-sm font-semibold">{title}</div>
      <ul className={`mt-2 text-xs text-slate-900 ${compact ? "space-y-1" : "space-y-2"}`}>
        {items.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
      <label className="mt-3 flex items-start gap-2 text-xs text-slate-900">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>I understand and acknowledge these disclosures.</span>
      </label>
    </div>
  );
}

