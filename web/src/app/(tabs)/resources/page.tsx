"use client";

import Image from "next/image";
import { useState } from "react";

type Resource = { title: string; desc: string; img: string };

function ResourceCard({
  title,
  desc,
  img,
  onClick,
}: {
  title: string;
  desc: string;
  img: string;
  onClick: () => void;
}) {
  return (
    <div className="card" role="button" tabIndex={0} onClick={onClick} style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 12, padding: 12 }}>
        <div style={{ width: 84, height: 64, borderRadius: 12, overflow: "hidden", background: "#f3f4f6" }}>
          <Image src={img} alt="" width={84} height={64} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div>
          <div style={{ fontWeight: 900 }}>{title}</div>
          <div className="p">{desc}</div>
        </div>
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const [active, setActive] = useState<Resource | null>(null);
  const resources: Resource[] = [
    {
      title: "Savings basics",
      desc: "Start here: how to set goals and automate deposits.",
      img: "/assets/high%20returns%20image.jpeg",
    },
    {
      title: "Stablecoins 101",
      desc: "USDC, USDT, and what they mean for savings products.",
      img: "/assets/usdc.png",
    },
    {
      title: "Lulo inspiration",
      desc: "Reference visuals used in the original concept boards.",
      img: "/assets/Luloinvest.jpeg",
    },
  ];

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Resources</div>
        <div className="p">Guides and learning modules to help you save smarter.</div>
      </div>

      <div className="potlist">
        {resources.map((r) => (
          <ResourceCard key={r.title} title={r.title} desc={r.desc} img={r.img} onClick={() => setActive(r)} />
        ))}
      </div>

      <div className={`modal ${active ? "is-open" : ""}`} aria-hidden={!active}>
        <div className="modal__backdrop" onClick={() => setActive(null)} />
        <div className="modal__panel" role="dialog" aria-modal="true" aria-labelledby="resourceTitle">
          <div className="modal__header">
            <div className="modal__title" id="resourceTitle">
              {active?.title || "Modal"}
            </div>
            <button className="iconbtn" onClick={() => setActive(null)} aria-label="Close">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="modal__body">
            <div className="p">{active?.desc}</div>
            <div className="p">(Prototype content)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
