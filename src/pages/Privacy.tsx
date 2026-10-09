/**
 * Privacy: advertising (KAN-72). Public, no sign-in, no ads.
 * The rest of the privacy policy is still to be written; this page covers ads only.
 */
import { Link } from 'react-router-dom';

export function Privacy() {
  return (
    <div className="app-shell privacy-page">
      <article className="panel stack">
        <p>
          <Link to="/">← Back</Link>
        </p>
        <h2 className="page-title">Privacy</h2>
        <p className="muted">Last updated 9 October 2026. Written for the New Zealand Privacy Act 2020.</p>

        <section id="advertising">
          <h3>Advertising</h3>
          <p>
            You may see advertisements: one on each side of the page on wide screens, or one banner at the bottom of the screen on phones, tablets and narrower windows. Ads are
            supplied by <strong>Google AdSense</strong> (Google LLC). They are labelled “Advertisement” and are not
            advice from us or an endorsement of any financial product.
          </p>
          <h4>What we never share</h4>
          <p>
            We do not send the ad network any of your financial information: no balances, holdings, transactions,
            pay, payees, or the content of the page you are looking at. Ads are told only that they are on our
            site, not which page or what is on it.
          </p>
          <h4>What Google collects</h4>
          <p>
            When an ad loads, your browser contacts Google directly. Google receives your IP address, browser and
            device details and the site address, and may use cookies or similar identifiers to show, limit and
            measure ads and to prevent fraud. See{' '}
            <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noreferrer">
              how Google uses information from sites that use its services
            </a>
            .
          </p>
          <h4>Personalised or not</h4>
          <p>
            Ads are <strong>not personalised</strong> unless you choose otherwise. Non-personalised ads are based on
            general context such as rough location, not your browsing history. You can switch to personalised ads,
            or back, at any time under <Link to="/settings?tab=account#ads">Settings → Account → Ads</Link>. You can
            also manage Google’s ad personalisation at{' '}
            <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">
              adssettings.google.com
            </a>{' '}
            or block ads with your browser; the app works the same either way.
          </p>
          <h4>Ads we block</h4>
          <p>We ask the ad network not to show gambling, payday lending, get-rich-quick crypto or adult ads.</p>
          <h4>Questions</h4>
          <p>
            You can ask what personal information we hold about you and ask us to correct it. If you’re not happy with
            our answer you can complain to the{' '}
            <a href="https://www.privacy.org.nz" target="_blank" rel="noreferrer">
              Office of the Privacy Commissioner
            </a>
            .
          </p>
        </section>
      </article>
    </div>
  );
}
