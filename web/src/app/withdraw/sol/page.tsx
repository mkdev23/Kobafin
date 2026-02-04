import { Suspense } from "react";
import Client from "./Client";

export default function Page() {
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
      <Client />
    </Suspense>
  );
}
