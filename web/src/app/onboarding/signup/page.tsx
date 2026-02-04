import Link from "next/link";

export default function SignupPage() {
  return (
    <div className="page">
      <div className="section">
        <div className="h1">Sign up</div>
      </div>

      <div className="form">
        <div className="label">Phone number *</div>
        <input className="input" placeholder="+ 232 00 000 000" />

        <Link href="/onboarding/verify" className="btn btn--primary btn--full">
          Sign up
        </Link>

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
