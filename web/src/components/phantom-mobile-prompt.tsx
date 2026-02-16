"use client";

import { useEffect, useState } from "react";
import { shouldShowPhantomDeepLink, openInPhantom } from "@/lib/phantom-deeplink";

export function PhantomMobilePrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(shouldShowPhantomDeepLink());
  }, []);

  if (!show) return null;

  return (
    <div className="phantom-mobile-prompt">
      <div className="smalllinks" style={{ marginBottom: "12px", textAlign: "center" }}>
        For the best experience on mobile, use Phantom app
      </div>
      <button
        type="button"
        onClick={openInPhantom}
        className="btn btn--secondary btn--full"
        style={{ marginBottom: "12px" }}
      >
        Open in Phantom App
      </button>
    </div>
  );
}
