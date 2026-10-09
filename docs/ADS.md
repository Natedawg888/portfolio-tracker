# Ads (KAN-72)

Ads earn revenue from the free app. They are **off** unless `ADS_ENABLED=true`.

## Where they show

| Window | Ads |
| --- | --- |
| 1520px wide or more and 680px tall or more | One 160×600 banner each side of the content, fixed in the empty side margins |
| Anything smaller (phones, tablets, narrower or short windows) | One banner fixed to the bottom of the screen: 320×50 under 768px wide, 728×90 from 768px; the page keeps room at the end so nothing is covered |
| Sign in, sign up, shared invoices, `/privacy` | None |

- Every slot is labelled "Advertisement" and "Not advice from KoruLedger", in a dashed frame, so an ad
  can't be mistaken for app content (FMC Act wording, KAN-54).
- Slots sit below modals and the phone nav drawer.
- The AdSense script loads after first paint, only when a slot is shown, so it never slows page loads
  or page switches.
- Blocked (ad blocker, offline) or unfilled slots are removed: no errors, no empty boxes, no reserved
  space left behind.
- Plans (KAN-50) are not built yet, so every signed-in user sees ads. When plans arrive, Plus / Pro
  should skip `<PageAds />` (and therefore the script) in `src/components/Layout.tsx`.

## Privacy

- Ads never receive financial data. Each ad unit is given the site root as its page URL
  (`data-page-url`), so the network never sees which page is open or anything on it.
- Ads are **non-personalised** by default (`requestNonPersonalizedAds = 1`). A one-time prompt (shown
  only once an ad has actually shown) and Settings → Account → Ads let the user opt in or back out;
  the choice is kept in that browser and applies from the next page load.
- `/privacy#advertising` names Google AdSense, what it collects and how to opt out (NZ Privacy Act
  2020). The rest of the privacy policy is still to be written.

## Setup

1. Apply for Google AdSense with the production domain and wait for approval.
2. Create ad units: two 160×600 (left, right) and one responsive / fixed banner for the bottom.
3. Set `ADSENSE_CLIENT_ID`, `ADSENSE_SLOT_LEFT`, `ADSENSE_SLOT_RIGHT`, `ADSENSE_SLOT_BOTTOM`, then
   `ADS_ENABLED=true`. Turn ads off again with `ADS_ENABLED=false` and a restart.
4. Add `ads.txt` at the site root with the line AdSense gives you.
5. **Block categories** in AdSense → Brand safety → Blocking controls: gambling & betting, payday /
   short-term loans, get-rich-quick and crypto schemes, adult / sexual content. The privacy page says
   these are blocked, so do this before switching ads on.
6. Content-Security-Policy: the app does not send one yet. When one is added, allow only
   `pagead2.googlesyndication.com`, `*.googlesyndication.com`, `*.doubleclick.net`,
   `*.google.com` / `*.gstatic.com` and `adservice.google.com` (script-src, frame-src, img-src,
   connect-src) for ads.

## Tests

`npm run test:ads`: kill switch, AdSense / placeholder modes, bad ids, which placement for which
window size, banner sizes, pages without ads, personalisation choice; API is public, uncached and
returns only ad config.
