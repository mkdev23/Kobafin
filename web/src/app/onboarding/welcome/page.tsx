import Link from "next/link";

export default function WelcomePage() {
  return (
    <div className="page">
      <div className="center">
        <div>Welcome to</div>
        <div className="h1">KobaFin</div>
        <div className="logoMark">
          <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
            <path
              d="M32 8c13.25 0 24 10.75 24 24S45.25 56 32 56 8 45.25 8 32c0-6.6 2.67-12.58 6.98-16.9"
              fill="none"
              stroke="#0a57e8"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M26 20c7.2 0 13 5.8 13 13 0 7.2-5.8 13-13 13-7.2 0-13-5.8-13-13"
              fill="none"
              stroke="#0a57e8"
              strokeWidth="10"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div className="p">Your path to financial security</div>
        <div className="p">
          Your path to financial security. Start saving for your future, no matter how small your income.
        </div>

        <div className="dots">
          <div className="dot is-on" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
        </div>

        <Link href="/onboarding/signup" className="btn btn--primary btn--full">
          Sign up for free
        </Link>
        <Link href="/onboarding/login" className="btn btn--ghost btn--full">
          Log in
        </Link>

        <div className="smalllinks">
          Terms of Service &middot; <a href="#">Privacy Policy</a> &middot; <a href="#">Contact Us</a>
        </div>
      </div>
    </div>
  );
}
