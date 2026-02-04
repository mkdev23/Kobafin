"use client";

export default function MorePage() {
  return (
    <div className="page">
      <div className="section" style={{ padding: 0 }}>
        <div style={{ background: "var(--kb-blue)", color: "#fff", padding: "18px 14px", fontWeight: 900 }}>
          Page Title
        </div>
        <div className="center" style={{ color: "rgba(17,24,39,.55)" }}>
          <div style={{ fontSize: 44, opacity: 0.45 }}>+</div>
          <div style={{ fontWeight: 800 }}>Drag Widgets Into Column</div>
        </div>
      </div>
    </div>
  );
}
