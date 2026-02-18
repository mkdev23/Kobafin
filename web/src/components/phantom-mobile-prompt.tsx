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
    <>
      <div className="smalllinks">Or open in the Phantom app</div>
      <button
        type="button"
        onClick={openInPhantom}
        className="btn btn--primary btn--full"
      >
        Open in Phantom
      </button>
    </>
  );
}
