import { Suspense } from "react";
import LuloDepositClient from "./LuloDepositClient";

export default function LuloDepositPage() {
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
      <LuloDepositClient />
    </Suspense>
  );
}
