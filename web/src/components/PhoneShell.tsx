import React from "react";

export function PhoneShell({
  children,
  className = "",
  topbar,
  footer,
}: {
  children: React.ReactNode;
  className?: string;
  topbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const frameClassName = `kb-frame ${footer ? "kb-frame--split" : ""} ${className}`;
  return (
    <div className="min-h-dvh">
      <div className="kb-bg" />
      <div className="kb-shell">
        {topbar}
        <div className={frameClassName}>{children}</div>
        {footer}
      </div>
    </div>
  );
}
