import Link from "next/link";

export default function VerifyPage() {
  return (
    <div className="page">
      <div className="center">
        <div>OTP message</div>
        <div className="h2">Verify phone</div>
        <div className="p">
          We sent OTP code to <b style={{ color: "var(--kb-blue)" }}>+ 232 00 000 000</b>
        </div>
        <div className="p">
          Please verify you are really you by entering the 4-digit code sent to your number.
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              className="input"
              style={{ width: 40, padding: "12px 0", textAlign: "center" }}
              maxLength={1}
              inputMode="numeric"
            />
          ))}
        </div>

        <div className="smalllinks">
          Didn't get OTP? <a href="#">Resend Code</a>
        </div>

        <Link href="/onboarding/form" className="btn btn--primary btn--full">
          Continue
        </Link>

        <div className="smalllinks">
          Already have an account? <Link href="/onboarding/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
