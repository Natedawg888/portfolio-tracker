/**
 * Terms of use (KAN-14). Public, no ads. New Zealand law; consumer rights that
 * cannot be excluded are preserved. Privacy is covered by the privacy policy.
 */
import { Link } from 'react-router-dom';
import { ContactEmail, LegalLayout } from '../components/legal/LegalLayout';

export function Terms() {
  return (
    <LegalLayout
      title="Terms of use"
      docTitle="Terms of use · Portfolio Tracker"
      intro={
        <p>
          These terms apply when you use Portfolio Tracker, run by KoruLedger (“we”, “us”). By creating an account or
          using the app you agree to them. Questions: <ContactEmail />.
        </p>
      }
    >
      <section aria-labelledby="t-service">
        <h2 id="t-service">1. What the app is</h2>
        <p>
          Portfolio Tracker is a personal record of your finances in New Zealand dollars: accounts, holdings, KiwiSaver,
          budget, debts, bills, invoices and tax estimates. It shows figures from what you enter, what you connect and
          public price sources.
        </p>
      </section>

      <section aria-labelledby="t-advice">
        <h2 id="t-advice">2. Not financial, tax or legal advice</h2>
        <p>
          Nothing in the app is financial advice, a recommendation to buy, sell or hold anything, or tax or legal
          advice. We are not a financial adviser. Calculations such as take-home pay, tax, projections, payoff dates and
          the economic cycle view are estimates for information only. Check important decisions with Inland Revenue, your
          provider or a qualified adviser.
        </p>
      </section>

      <section aria-labelledby="t-account">
        <h2 id="t-account">3. Your account</h2>
        <ul>
          <li>You must be 16 or older to create an account.</li>
          <li>Give accurate details, keep your password and sign-in methods secure, and tell us if you think someone else has access.</li>
          <li>An account is for one person. You are responsible for what happens in it.</li>
          <li>You can delete your account at any time in Settings, or by emailing us.</li>
        </ul>
      </section>

      <section aria-labelledby="t-data">
        <h2 id="t-data">4. Your information</h2>
        <p>
          What you enter stays yours. You let us store and process it only to run the app for you, as described in the{' '}
          <Link to="/privacy">privacy policy</Link>, which explains how we meet our obligations under the{' '}
          <strong>Privacy Act 2020</strong>.
        </p>
        <p>
          If you enter information about other people, such as invoice clients or people in your debts, you are
          responsible for having the right to use it and for meeting any Privacy Act obligations you have to them.
        </p>
      </section>

      <section aria-labelledby="t-accuracy">
        <h2 id="t-accuracy">5. Accuracy and other services</h2>
        <p>
          Figures depend on what you enter and on other services. Bank and KiwiSaver data comes through Akahu and your
          providers, and prices come from public sources. They can be delayed, wrong or unavailable; when a price
          cannot be fetched the app shows that rather than guessing. Your use of Akahu, Google, Apple or Microsoft is
          also covered by their own terms.
        </p>
      </section>

      <section aria-labelledby="t-invoices">
        <h2 id="t-invoices">6. Invoices you send</h2>
        <p>
          You are responsible for the content of invoices you create or send through the app, including GST, and for
          having the right to email the people you send them to. Invoice emails are sent on your behalf, with replies
          going to you.
        </p>
      </section>

      <section aria-labelledby="t-use">
        <h2 id="t-use">7. Acceptable use</h2>
        <p>Do not use the app to:</p>
        <ul>
          <li>break the law or anyone’s rights, or send spam or misleading invoices;</li>
          <li>access or try to access another person’s account or data;</li>
          <li>attack, overload, probe or disrupt the service, or get around its security or limits;</li>
          <li>upload malware or content you have no right to share;</li>
          <li>scrape or copy the service by automated means, other than through features we provide.</li>
        </ul>
        <p>We may suspend or close an account that breaks these terms, and will tell you why unless the law prevents it.</p>
      </section>

      <section aria-labelledby="t-availability">
        <h2 id="t-availability">8. Changes to the service</h2>
        <p>
          We may change, pause or stop features or the whole service. If we plan to close the service we will give
          reasonable notice so you can copy what you need and delete your account.
        </p>
      </section>

      <section aria-labelledby="t-liability">
        <h2 id="t-liability">9. Liability</h2>
        <p>
          The app is provided as it is and as available. To the extent the law allows, we are not liable for loss arising
          from decisions you make using the app, from inaccurate figures, or from other services being unavailable, and
          our total liability to you is limited to NZ$100.
        </p>
        <p>
          Nothing in these terms limits rights you have under the Consumer Guarantees Act 1993, the Fair Trading Act 1986
          or other laws that cannot be excluded. If you use the app for a business, you agree the Consumer Guarantees
          Act does not apply to that use, to the extent the law allows.
        </p>
      </section>

      <section aria-labelledby="t-law">
        <h2 id="t-law">10. Law and changes to these terms</h2>
        <p>
          These terms are governed by New Zealand law, and New Zealand courts have jurisdiction. We may update these terms
          and will change the date at the top; continuing to use the app after a change means you accept it. Questions:{' '}
          <ContactEmail />.
        </p>
      </section>
    </LegalLayout>
  );
}
