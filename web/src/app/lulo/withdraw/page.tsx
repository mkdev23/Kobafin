import { Suspense } from "react";
import LuloWithdrawClient from "./LuloWithdrawClient";

export default function LuloWithdrawPage() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <div className="section">
            <div className="card" style={{ padding: 16 }}>Loading...</div>
          </div>
        </div>
      }
    >
      <LuloWithdrawClient />
    </Suspense>
  );
}
