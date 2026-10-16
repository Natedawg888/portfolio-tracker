import { api } from '../../api/client';

/** Settings → Account → Your data: download everything stored for this account. */
export function AccountDataCard() {
  return (
    <section className="panel account-card" aria-labelledby="account-data-title">
      <div className="account-card-head">
        <h2 id="account-data-title">Your data</h2>
        <p className="muted small">
          A file with everything stored for your account: profile, settings and all your money records. Passwords and
          security keys are left out. Photos and receipts are listed by name but not included.
        </p>
      </div>
      <div className="account-actions account-data-actions">
        <a className="btn small" href={api.auth.exportUrl()} download>
          Download a copy
        </a>
        <span className="muted small">JSON file</span>
      </div>
    </section>
  );
}
