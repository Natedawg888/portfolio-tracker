/**
 * Privacy policy (KAN-14), written for the New Zealand Privacy Act 2020. Public, no ads.
 * Every statement describes what the code does; update this page when that changes.
 * The #advertising section is linked from Settings and the ad banners (KAN-72).
 */
import { Link } from 'react-router-dom';
import { ContactEmail, LegalLayout } from '../components/legal/LegalLayout';

export function Privacy() {
  return (
    <LegalLayout
      title="Privacy policy"
      docTitle="Privacy policy · KoruLedger"
      intro={
        <p>
          This policy applies to KoruLedger (“we”, “us”, “the app”). It explains what personal information the app
          collects, why, where it is kept, who it is shared with, and your rights under the New Zealand{' '}
          <strong>Privacy Act 2020</strong> and its information privacy principles. Questions or requests: <ContactEmail />.
        </p>
      }
    >
      <nav className="legal-toc" aria-label="On this page">
        <h2 id="contents">Contents</h2>
        <ol>
          <li><a href="#collect">What we collect</a></li>
          <li><a href="#use">How we use it</a></li>
          <li><a href="#share">Who we share it with</a></li>
          <li><a href="#overseas">Where it is stored</a></li>
          <li><a href="#security">How we protect it</a></li>
          <li><a href="#retention">How long we keep it</a></li>
          <li><a href="#rights">Your rights</a></li>
          <li><a href="#cookies">Cookies and browser storage</a></li>
          <li><a href="#advertising">Advertising</a></li>
          <li><a href="#breaches">Privacy breaches</a></li>
          <li><a href="#changes">Changes and contact</a></li>
        </ol>
      </nav>

      <section id="collect" aria-labelledby="collect-h">
        <h2 id="collect-h">1. What we collect</h2>
        <p>We collect information you give us, information you ask us to bring in, and a small amount of technical information.</p>
        <h3>Your account</h3>
        <ul>
          <li>Email address, first and last name, and a profile picture if you add one.</li>
          <li>
            Your password, stored only as a one-way hash. If you sign in with Google, Apple or Microsoft, we keep the
            name and email they share and an ID that links that account to yours, never your password for that service.
          </li>
          <li>
            Two-factor sign-in details if you turn them on: an encrypted authenticator secret, hashed backup codes, and
            passkeys (we keep only a public key; the private key stays on your device or in your passkey manager).
          </li>
          <li>Your settings and preferences, such as which asset classes you track and your ad choice.</li>
        </ul>
        <h3>Your financial information</h3>
        <ul>
          <li>
            What you enter or import: bank accounts and transactions, budgets, income, holdings (shares, crypto, metals,
            property and others), KiwiSaver balances, debts, savings goals, donations, bills, warranties, rental
            properties and the rooms you let, and pay details used for take-home pay calculations.
          </li>
          <li>Files you upload: receipts, warranty documents, property photos and your profile picture.</li>
          <li>
            Bank and KiwiSaver data from <strong>Akahu</strong>, only if you connect it: account names and numbers,
            balances and transactions. The connection is read-only; the app cannot move money.
          </li>
          <li>Public crypto wallet addresses you add. We never ask for or store seed phrases or private keys.</li>
          <li>
            Shopping lists, and the supermarket prices you record. If you turn on price sharing, the item name, store,
            price and date are also added to a shared price table (see <a href="#share">who we share it with</a>).
          </li>
        </ul>
        <h3>Information about other people</h3>
        <p>
          Some features hold details about other people that you choose to enter, such as invoice clients (name, email,
          address), people you owe or who owe you, tenants or boarders in rooms you let (a display name, rent, dates
          and bond; no contact details), and payees in your transactions. Please only enter what you are
          entitled to use, and tell them if the law requires it.
        </p>
        <h3>Technical information</h3>
        <ul>
          <li>
            A sign-in history for your account: when you signed in or changed security settings, how (for example
            password or passkey) and a coarse device label such as “Chrome on Windows”.
          </li>
          <li>
            Server logs: for each request, the address requested, the result, the time taken and your IP address. Logs
            do not contain what you send or your cookies.
          </li>
        </ul>
        <p>We do not collect bank or KiwiSaver provider passwords. You sign in to your bank on Akahu’s side.</p>
      </section>

      <section id="use" aria-labelledby="use-h">
        <h2 id="use-h">2. How we use it</h2>
        <ul>
          <li>To run your account and show you your own figures: net worth, budget, income, debts, tax estimates and the rest.</li>
          <li>To fetch live prices and exchange rates for what you hold, and to sync accounts you have connected.</li>
          <li>To send invoices and reminders you ask us to send.</li>
          <li>To keep your account secure: sign-in, two-factor checks, rate limits, and spotting misuse.</li>
          <li>To fix problems and keep the service running.</li>
        </ul>
        <p>
          We use your information only for these purposes or ones directly related to them. We do not sell it, and we do
          not use your financial information for advertising.
        </p>
      </section>

      <section id="share" aria-labelledby="share-h">
        <h2 id="share-h">3. Who we share it with</h2>
        <p>We share personal information only with services that help run the app, and only what each one needs:</p>
        <ul>
          <li><strong>Railway</strong> hosts the app, its database and uploaded files.</li>
          <li><strong>Akahu</strong>, if you connect bank or KiwiSaver accounts, to retrieve your balances and transactions.</li>
          <li><strong>Google, Apple or Microsoft</strong>, if you choose to sign in with them.</li>
          <li>
            <strong>Resend</strong>, when you email an invoice: the recipients’ addresses, the invoice and its PDF. Replies go
            to your own email address. Also when you change your account email: a confirmation link to the new address and a
            notice to the old one.
          </li>
          <li>
            <strong>Public blockchain services</strong> (such as PublicNode, Blockstream and Solana’s public endpoint),
            which receive the public wallet addresses you add so balances can be read.
          </li>
          <li>
            <strong>Members of your household</strong>, if you create or join one: your name, email address and role, and the
            household activity log (who joined, left or changed what). Your own finances stay private unless you share them.
            An invite is sent to the email address the owner enters.
          </li>
          <li>
            <strong>Other KoruLedger users</strong>, only if you turn on price sharing for shopping lists: the item names,
            stores, prices and dates you record, so everyone can compare supermarkets. Shared prices are stored without your
            name, email or account id, other users never see who recorded them, and an item name is only suggested to others
            once at least two people have used it. Your lists stay private. You can remove the prices you have shared at
            any time on the Shopping lists page.
          </li>
          <li>
            <strong>Google AdSense</strong> shows ads. It receives what your browser sends it, not your financial
            information. See <a href="#advertising">Advertising</a>.
          </li>
        </ul>
        <p>
          Price, exchange-rate and economic data providers (for example Yahoo Finance, CoinGecko, Frankfurter and Stats
          NZ) are sent only the symbols or series being looked up, never who you are. An invoice you share by link can
          be opened by anyone with that link until you turn sharing off.
        </p>
        <p>We may also disclose information when the law requires it, or to prevent a serious threat to someone’s safety.</p>
      </section>

      <section id="overseas" aria-labelledby="overseas-h">
        <h2 id="overseas-h">4. Where it is stored</h2>
        <p>
          Your information is stored on servers outside New Zealand, run by Railway. Some of the services above,
          including Google and Resend, are also based overseas, mostly in the United States. Under information privacy
          principle 12 we only use overseas providers that protect personal information in ways comparable to the
          Privacy Act. By using the app you acknowledge that your information is stored and processed overseas.
        </p>
      </section>

      <section id="security" aria-labelledby="security-h">
        <h2 id="security-h">5. How we protect it</h2>
        <ul>
          <li>Connections use HTTPS. Sign-in cookies cannot be read by scripts on the page.</li>
          <li>Passwords and backup codes are hashed; authenticator secrets are encrypted.</li>
          <li>Each person’s financial records are kept separate and only shown to that account.</li>
          <li>Optional two-factor sign-in and passkeys, and a list of signed-in devices you can sign out.</li>
        </ul>
        <p>No system is perfectly secure. Please use a strong password and turn on two-factor sign-in.</p>
      </section>

      <section id="retention" aria-labelledby="retention-h">
        <h2 id="retention-h">6. How long we keep it</h2>
        <ul>
          <li>Your account and financial records are kept until you delete them or your account.</li>
          <li>Sign-in history is kept for 180 days.</li>
          <li>Shared supermarket prices are kept until you remove them or delete your account; comparisons only use recent ones.</li>
          <li>Sign-in sessions last up to 30 days (24 hours if you untick “Keep me signed in”); trusted devices for 30 days.</li>
          <li>Server logs are kept by our hosting provider for a limited time.</li>
        </ul>
        <p>
          When you delete your account (Settings → Account), we delete your profile, financial records, uploaded files,
          connected-account tokens, sessions, security settings and any supermarket prices you shared. If you share a
          household with others, your name is removed from its activity log, but splits and payments you were part of stay
          for the other members (shown as “Former member”) because they affect what they owe. Public prices and exchange
          rates the app looked up are not linked to you and stay. Deleting your account here does not end your consent
          with Akahu; you can do that at <a href="https://my.akahu.nz" target="_blank" rel="noreferrer">my.akahu.nz</a>.
          If you signed up with Google, Apple or Microsoft and have no password, email us and we will delete your account.
        </p>
      </section>

      <section id="rights" aria-labelledby="rights-h">
        <h2 id="rights-h">7. Your rights</h2>
        <p>Under the Privacy Act 2020 you can:</p>
        <ul>
          <li>
            ask for a copy of the personal information we hold about you (principle 6). You can download most of it
            yourself under Settings → Account → Your data;
          </li>
          <li>ask us to correct it (principle 7). You can change most of it yourself in the app;</li>
          <li>ask us to delete it.</li>
        </ul>
        <p>
          Email <ContactEmail />. We may need to confirm it is you before acting. We will respond as soon as we can and
          within 20 working days. If you are not satisfied with our response, you can complain to the{' '}
          <a href="https://www.privacy.org.nz" target="_blank" rel="noreferrer">
            Office of the Privacy Commissioner
          </a>
          .
        </p>
      </section>

      <section id="cookies" aria-labelledby="cookies-h">
        <h2 id="cookies-h">8. Cookies and browser storage</h2>
        <p>The app’s own cookies are needed to sign you in. We do not use them for tracking.</p>
        <ul>
          <li>a sign-in cookie that keeps you signed in;</li>
          <li>a trusted-device cookie, if you choose to skip two-factor checks on that device for 30 days;</li>
          <li>a cookie listing other accounts you have added to this browser, so you can switch between them;</li>
          <li>a short-lived cookie that protects sign-in with Google, Apple or Microsoft.</li>
        </ul>
        <p>
          Your browser also keeps some preferences on your device, such as light or dark theme, display choices, the
          email you last signed in with and a note that this device has a passkey. These stay on your device and can be
          cleared in your browser. Advertising cookies are described below.
        </p>
      </section>

      <section id="advertising" aria-labelledby="advertising-h">
        <h2 id="advertising-h">9. Advertising</h2>
        <p>
          You may see advertisements: one on each side of the page on wide screens, or one banner at the bottom of the
          screen on phones, tablets and narrower windows. Ads are supplied by <strong>Google AdSense</strong> (Google LLC).
          They are labelled “Advertisement” and are not advice from us or an endorsement of any financial product.
        </p>
        <h3>What we never share</h3>
        <p>
          We do not send the ad network any of your financial information: no balances, holdings, transactions, pay,
          payees, or the content of the page you are looking at. Ads are told only that they are on our site, not which
          page or what is on it.
        </p>
        <h3>What Google collects</h3>
        <p>
          When an ad loads, your browser contacts Google directly. Google receives your IP address, browser and device
          details and the site address, and may use cookies or similar identifiers to show, limit and measure ads and to
          prevent fraud. See{' '}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noreferrer">
            how Google uses information from sites that use its services
          </a>
          .
        </p>
        <h3>Personalised or not</h3>
        <p>
          Ads are <strong>not personalised</strong> unless you choose otherwise. Non-personalised ads are based on general
          context such as rough location, not your browsing history. You can switch to personalised ads, or back, at any
          time under <Link to="/settings?tab=account#ads">Settings → Account → Ads</Link>. You can also manage Google’s ad
          personalisation at{' '}
          <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">
            adssettings.google.com
          </a>{' '}
          or block ads with your browser; the app works the same either way.
        </p>
        <h3>Ads we block</h3>
        <p>We ask the ad network not to show gambling, payday lending, get-rich-quick crypto or adult ads.</p>
      </section>

      <section id="breaches" aria-labelledby="breaches-h">
        <h2 id="breaches-h">10. Privacy breaches</h2>
        <p>
          If a privacy breach happens that has caused, or is likely to cause, serious harm, we will notify the Privacy
          Commissioner and the people affected as soon as practicable, as the Privacy Act requires.
        </p>
      </section>

      <section id="changes" aria-labelledby="changes-h">
        <h2 id="changes-h">11. Changes and contact</h2>
        <p>
          We will update this policy when the app changes how it handles personal information, and change the date at the
          top. Questions, requests or complaints: <ContactEmail />.
          See also our <Link to="/terms">terms of use</Link>.
        </p>
      </section>
    </LegalLayout>
  );
}
