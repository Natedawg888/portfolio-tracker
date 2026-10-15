/**
 * Shared frame for the public legal pages (privacy policy, terms of use): brand link
 * home, one h1, last-updated line, and a footer linking both documents.
 */
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLockup } from '../BrandLockup';

export const LEGAL_CONTACT_EMAIL = 'koruledger@gmail.com';
export const LEGAL_UPDATED = '15 October 2026';

export function ContactEmail() {
  return <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;
}

export function LegalLayout({ title, docTitle, intro, children }: { title: string; docTitle: string; intro: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title;
    document.title = docTitle;
    return () => {
      document.title = previous;
    };
  }, [docTitle]);

  return (
    <div className="legal-page">
      <a className="home-skip" href="#legal-main">
        Skip to main content
      </a>
      <header className="legal-topbar">
        <Link className="legal-brand" to="/">
          <BrandLockup size="sm" />
        </Link>
      </header>
      <main id="legal-main" tabIndex={-1} className="legal-main">
        <article className="legal-doc">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {LEGAL_UPDATED}</p>
          <div className="legal-intro">{intro}</div>
          {children}
        </article>
      </main>
      <footer className="legal-footer">
        <p>KoruLedger · a personal record, not financial advice</p>
        <nav aria-label="Legal">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms of use</Link>
        </nav>
      </footer>
    </div>
  );
}
