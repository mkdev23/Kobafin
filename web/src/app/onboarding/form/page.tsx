"use client";

import Link from "next/link";
import { useState } from "react";
import { DisclosuresCard, useDisclosureAcceptance } from "@/components/disclosures";

export default function SignupFormPage() {
  const { accepted, setAccepted } = useDisclosureAcceptance();
  const [err, setErr] = useState("");

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Sign up</div>
      </div>

      <div className="form">
        <div className="label">Full name *</div>
        <input className="input" placeholder="Joe Doe" />

        <div className="label">NIN *</div>
        <input className="input" placeholder="1234567890" inputMode="numeric" />

        <div className="label">Password *</div>
        <input className="input" type="password" placeholder="Password should be longer than six characters" />

        <div className="label">Confirm Password *</div>
        <input className="input" type="password" placeholder="Password should be longer than six characters" />

        <DisclosuresCard accepted={accepted} onToggle={setAccepted} title="Required acknowledgements" compact />

        <Link
          href="/home"
          className="btn btn--primary btn--full"
          onClick={(e) => {
            if (!accepted) {
              e.preventDefault();
              setErr("Please acknowledge the disclosures to continue.");
            } else {
              setErr("");
            }
          }}
        >
          Continue
        </Link>
        {err ? (
          <div className="p" style={{ color: "#dc2626" }}>
            {err}
          </div>
        ) : null}

        <div className="smalllinks">
          By signing up you agree to our <a href="#">Terms of Condition</a> and <a href="#">Privacy Policy</a>.
        </div>

        <div className="smalllinks">
          Already have an account? <Link href="/onboarding/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}

