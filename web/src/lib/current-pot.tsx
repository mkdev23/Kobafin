"use client";

import { useEffect, useState } from "react";

const KEY = "kobafin_current_pot_id";

export function setCurrentPotId(potId: string) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, potId);
}

export function useCurrentPot() {
  const [potId, setPotIdState] = useState<string>("");

  useEffect(() => {
    const v = localStorage.getItem(KEY) || "";
    setPotIdState(v);
  }, []);

  const setPotId = (v: string) => {
    localStorage.setItem(KEY, v);
    setPotIdState(v);
  };

  // Provide both names because some pages referenced currentPotId.
  return {
    potId,
    currentPotId: potId,
    setPotId,
    setCurrentPotId: setPotId,
  };
}
