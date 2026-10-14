/**
 * Public home page at "/" for signed-out visitors (signed-in users get the Dashboard).
 * Links to the existing sign-in and create-account pages only. The preview uses
 * example figures; every privacy and feature line here is backed by the app's code.
 */
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HomeTopBar } from '../components/home/HomeTopBar';
import { PreviewCard } from '../components/home/PreviewCard';

const PAGE_TITLE = 'Portfolio Tracker · your whole financial picture in NZD';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="home-feature-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}

const FEATURES: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Net worth across everything',
    text: 'Bank accounts, KiwiSaver, shares, crypto, metals, property and more, added up in NZD on one screen.',
    icon: <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />,
  },
  {
    title: 'A budget that knows the date',
    text: 'See which day of the month it is next to how much of each plan you’ve already used.',
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4m6-4v4" />
      </>
    ),
  },
  {
    title: 'Debts with a finish line',
    text: 'Track what you owe and see when each debt is paid off at your current repayments.',
    icon: <path d="M5 21V4m0 1h11l-2 4 2 4H5" />,
  },
  {
    title: 'KiwiSaver and PAYE built in',
    text: 'Follow your KiwiSaver balance and work out take-home pay with New Zealand tax codes, ACC and student loan.',
    icon: (
      <>
        <path d="M12 3 4 7v5c0 4.5 3.4 7.6 8 9 4.6-1.4 8-4.5 8-9V7l-8-4z" />
        <path d="M9 12h6" />
      </>
    ),
  },
  {
    title: 'Live prices, never guessed',
    text: 'Shares, crypto, metals and foreign currency use live prices. If one can’t be fetched, you see that instead of a guess.',
    icon: <path d="M3 17l5-5 4 4 8-9m0 0h-5m5 0v5" />,
  },
  {
    title: 'Bills, invoices and warranties',
    text: 'Spot recurring bills, send invoices and keep track of what’s still under warranty.',
    icon: (
      <>
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M15 3v4h4M10 12h6m-6 4h6" />
      </>
    ),
  },
];

/** Only claims confirmed against the code: Akahu reads only, no provider passwords, no invented prices. */
const PRIVACY_POINTS: { title: string; text: string }[] = [
  {
    title: 'Bank connections are read-only',
    text: 'Accounts connect through Akahu, and the app only reads balances and transactions. It has no way to move money.',
  },
  {
    title: 'No bank or KiwiSaver passwords stored',
    text: 'You sign in to your bank on Akahu’s side, and KiwiSaver comes in through Akahu or a file you export. Your own password is stored hashed.',
  },
  {
    title: 'Missing numbers stay missing',
    text: 'Prices come from real sources. If one can’t be fetched it shows as unavailable, and history keeps its gaps instead of filling them in.',
  },
];

function CallToAction() {
  return (
    <div className="home-cta-buttons">
      <Link className="btn primary home-btn-lg" to="/register">
        Create your account
      </Link>
      <Link className="btn home-btn-outline home-btn-lg" to="/login">
        I already have an account
      </Link>
    </div>
  );
}

function Padlock() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </g>
    </svg>
  );
}

export function Home() {
  useEffect(() => {
    const previous = document.title;
    document.title = PAGE_TITLE;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="home-page" id="top">
      <a className="home-skip" href="#main">
        Skip to main content
      </a>
      <HomeTopBar />
      <main id="main" tabIndex={-1}>
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero-text">
            <p className="home-badge">Made for New Zealand · all in NZD</p>
            <h1 id="home-title">Everything you own, in one honest number.</h1>
            <p className="home-lead">
              Bank accounts, KiwiSaver, shares, crypto, property and your monthly budget in one place, valued at live
              prices where they exist, and never guessed.
            </p>
            <CallToAction />
            <p className="home-padlock">
              <Padlock />
              Bank connections are read-only through Akahu
            </p>
          </div>
          <PreviewCard />
        </section>

        <section id="features" className="home-section" aria-labelledby="features-title">
          <h2 id="features-title">One place for the whole picture</h2>
          <ul className="home-features">
            {FEATURES.map((f) => (
              <li key={f.title} className="panel home-feature">
                <Icon>{f.icon}</Icon>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="privacy" className="home-section home-privacy" aria-labelledby="privacy-title">
          <h2 id="privacy-title">Your numbers, kept honest</h2>
          <p className="home-section-lead">
            Portfolio Tracker shows what is really there: balances from your bank, prices from real sources, and an empty
            space where something isn’t known.
          </p>
          <ul className="home-checklist">
            {PRIVACY_POINTS.map((p) => (
              <li key={p.title}>
                <svg className="home-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5 12.5 10 17 19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section home-closing" aria-labelledby="closing-title">
          <h2 id="closing-title">See your net worth in a few minutes</h2>
          <p className="home-section-lead">Create an account, add what you own, and the total adds itself up.</p>
          <CallToAction />
        </section>
      </main>
      <footer className="home-footer">
        <p>Portfolio Tracker · a personal record, not financial advice</p>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy policy</Link>
        </nav>
      </footer>
    </div>
  );
}
