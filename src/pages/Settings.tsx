import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { ApiError, api, type AccountSecurity } from '../api/client';
import {
  akahuConnect,
  akahuDisconnect,
  akahuRefreshInstitutions,
  akahuStatus,
  akahuSync,
  akahuSyncTransactions,
  type AkahuConnectionStatus,
  type AkahuInstitution,
} from '../api/akahuClient';
import { CategoryManager } from '../components/CategoryManager';
import { SecurityPanel } from '../components/SecurityPanel';
import { BusinessDetailsPanel } from '../components/BusinessDetailsPanel';
import { BusinessPlanCard } from '../components/business/BusinessPlanNote';
import { AdPrefsPanel } from '../components/AdPrefsPanel';
import { AccountProfileCard } from '../components/settings/AccountProfileCard';
import { AccountSignInCard } from '../components/settings/AccountSignInCard';
import { AccountDataCard } from '../components/settings/AccountDataCard';
import { AccountUsageModeCard } from '../components/settings/AccountUsageModeCard';
import { AccountDeleteCard } from '../components/settings/AccountDeleteCard';
import { AssetClassSettings } from '../components/settings/AssetClassSettings';
import {
  beginPageRead,
  commitPageRead,
  invalidateAfterAkahuLinkChange,
  invalidateAfterExternalSync,
  portfolioSyncChanged,
  readPageCache,
  txnSyncChanged,
} from '../lib/pageDataCache';

type SettingsTab = 'account' | 'security' | 'business' | 'categories' | 'connections';

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // Akahu OAuth returns to /settings?akahu=… — open Connections so the handler mounts
  const tab: SettingsTab =
    searchParams.get('akahu') || tabParam === 'connections'
      ? 'connections'
      : tabParam === 'categories'
        ? 'categories'
        : tabParam === 'security'
        ? 'security'
        : tabParam === 'business'
          ? 'business'
          : 'account';

  const setTab = (next: SettingsTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="settings-layout settings-page">
      <aside className="settings-side-nav" aria-label="Settings sections">
        <h2 className="settings-side-title page-title">Settings</h2>
        <nav className="settings-side-links">
          <button
            type="button"
            className={tab === 'account' ? 'settings-side-link active' : 'settings-side-link'}
            onClick={() => setTab('account')}
            aria-current={tab === 'account' ? 'page' : undefined}
          >
            Account
          </button>
          <button
            type="button"
            className={tab === 'security' ? 'settings-side-link active' : 'settings-side-link'}
            onClick={() => setTab('security')}
            aria-current={tab === 'security' ? 'page' : undefined}
          >
            Security
          </button>
          <button
            type="button"
            className={tab === 'business' ? 'settings-side-link active' : 'settings-side-link'}
            onClick={() => setTab('business')}
            aria-current={tab === 'business' ? 'page' : undefined}
          >
            Business
          </button>
          <button
            type="button"
            className={tab === 'categories' ? 'settings-side-link active' : 'settings-side-link'}
            onClick={() => setTab('categories')}
            aria-current={tab === 'categories' ? 'page' : undefined}
          >
            Categories &amp; assets
          </button>
          <button
            type="button"
            className={tab === 'connections' ? 'settings-side-link active' : 'settings-side-link'}
            onClick={() => setTab('connections')}
            aria-current={tab === 'connections' ? 'page' : undefined}
          >
            Connections
          </button>
        </nav>
      </aside>
      <div className="settings-main stack">
        {tab === 'account' ? (
          <AccountPanel />
        ) : tab === 'security' ? (
          <SecurityPanel />
        ) : tab === 'business' ? (
          <>
            <BusinessDetailsPanel />
            <BusinessPlanCard />
          </>
        ) : tab === 'categories' ? (
          <CategoriesPanel />
        ) : (
          <ConnectionsPanel searchParams={searchParams} setSearchParams={setSearchParams} />
        )}
      </div>
    </div>
  );
}

function AccountPanel() {
  // Password and connected sign-ins decide how the email and delete forms confirm it's you.
  const [security, setSecurity] = useState<AccountSecurity | null>(null);
  useEffect(() => {
    let live = true;
    api.auth
      .security()
      .then((s) => {
        if (live) setSecurity(s);
      })
      .catch(() => {
        // Rows fall back to asking for the password, which the server requires anyway.
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <AccountProfileCard />
      <AccountSignInCard security={security} />
      <AccountUsageModeCard />
      <AccountDataCard />
      <AdPrefsPanel />
      <AccountDeleteCard hasPassword={security?.hasPassword ?? null} />
    </>
  );
}

function CategoriesPanel() {
  const { refresh } = useAssetClassPrefs();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <AssetClassSettings />

      <section className="panel">
        <h2>Transaction categories</h2>
        <p className="page-lead">
          The categories used on the Budget page and in budget plans.
        </p>

        <CategoryManager />
      </section>
    </>
  );
}

function ConnectionsPanel({
  searchParams,
  setSearchParams,
}: {
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  const [akahu, setAkahu] = useState<AkahuConnectionStatus | null>(
    () => readPageCache<AkahuConnectionStatus>('settings:akahu') ?? null,
  );
  const [akahuBusy, setAkahuBusy] = useState(false);
  const [akahuMsg, setAkahuMsg] = useState<string | null>(null);
  const [akahuError, setAkahuError] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<AkahuInstitution[]>(
    () => readPageCache<AkahuConnectionStatus>('settings:akahu')?.institutions ?? [],
  );


  const loadAkahu = useCallback(async () => {
    const stamp = beginPageRead('settings:akahu');
    try {
      const st = await akahuStatus();
      if (!commitPageRead(stamp, st)) return;
      setAkahu(st);
      setInstitutions(st.institutions ?? []);
    } catch (err) {
      setAkahuError(err instanceof ApiError ? err.message : 'Could not load Akahu status');
    }
  }, []);

  useEffect(() => {
    void loadAkahu();
  }, [loadAkahu]);

  useEffect(() => {
    const flag = searchParams.get('akahu');
    if (!flag) return;
    const message = searchParams.get('message');
    if (flag === 'connected') {
      invalidateAfterAkahuLinkChange();
      setAkahuMsg('Connected to Akahu. Your accounts are ready to sync.');
      void loadAkahu();
      void (async () => {
        try {
          await akahuSync();
          await akahuSyncTransactions();
          const fresh = await akahuRefreshInstitutions();
          setInstitutions(fresh.institutions ?? []);
        } catch {
          /* status already shows connected */
        }
      })();
    } else if (flag === 'revoked') {
      invalidateAfterAkahuLinkChange();
      setAkahuMsg('Akahu was disconnected. You can connect again anytime.');
      void loadAkahu();
    } else if (flag === 'error') {
      setAkahuError(message || 'Akahu connect failed');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('akahu');
    next.delete('message');
    if (!next.get('tab')) next.set('tab', 'connections');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadAkahu]);

  const onConnect = async () => {
    setAkahuBusy(true);
    setAkahuMsg(null);
    setAkahuError(null);
    try {
      const r = await akahuConnect();
      if (r.authorizeUrl) {
        invalidateAfterAkahuLinkChange();
        window.location.href = r.authorizeUrl;
        return;
      }
      setAkahuError('No authorize URL returned');
    } catch (err) {
      setAkahuError(err instanceof ApiError ? err.message : 'Could not start Akahu Connect');
    } finally {
      setAkahuBusy(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm('Disconnect your Akahu link? Synced data stays in the local database.')) {
      return;
    }
    setAkahuBusy(true);
    setAkahuMsg(null);
    setAkahuError(null);
    try {
      const r = await akahuDisconnect();
      invalidateAfterAkahuLinkChange();
      setAkahuMsg(r.message || (r.disconnected ? 'Disconnected from Akahu.' : 'Nothing to disconnect.'));
      await loadAkahu();
      setInstitutions([]);
    } catch (err) {
      setAkahuError(err instanceof ApiError ? err.message : 'Could not disconnect');
    } finally {
      setAkahuBusy(false);
    }
  };

  const onRefreshInstitutions = async () => {
    setAkahuBusy(true);
    setAkahuError(null);
    try {
      const r = await akahuRefreshInstitutions();
      setInstitutions(r.institutions ?? []);
      setAkahuMsg('Institution list refreshed from Akahu.');
      await loadAkahu();
    } catch (err) {
      setAkahuError(err instanceof ApiError ? err.message : 'Could not refresh institutions');
    } finally {
      setAkahuBusy(false);
    }
  };

  const onSyncNow = async () => {
    setAkahuBusy(true);
    setAkahuError(null);
    try {
      const portfolio = await akahuSync();
      const txns = await akahuSyncTransactions();
      if (portfolioSyncChanged(portfolio) || txnSyncChanged(txns)) invalidateAfterExternalSync();
      setAkahuMsg(
        `Synced: ${portfolio.cashAccountsUpserted ?? 0} cash, ` +
          `${portfolio.stocksUpserted ?? 0} stocks, ${portfolio.cryptoUpserted ?? 0} crypto, ` +
          `KS ${portfolio.kiwisaverBalanceSynced ? 'yes' : 'no'}; ` +
          `txns +${txns.inserted ?? 0}/~${txns.updated ?? 0}` +
          (txns.categorised ? `, ${txns.categorised} categorised from past transactions.` : '.'),
      );
      await loadAkahu();
      try {
        const inst = await akahuRefreshInstitutions();
        setInstitutions(inst.institutions ?? []);
      } catch {
        /* optional */
      }
    } catch (err) {
      setAkahuError(err instanceof ApiError ? err.message : 'Sync failed');
    } finally {
      setAkahuBusy(false);
    }
  };

  return (
    <>
      <section className="panel" id="connect-accounts">
        <div className="panel-heading">
          <h2>Connect accounts</h2>
        </div>
        <p className="page-lead">
          Connect your NZ banks and investments through Akahu. Your passwords stay with Akahu and
          are never shared with this app.
        </p>

        {akahu == null ? (
          <p className="muted">Loading account connections…</p>
        ) : !akahu.canSync && !akahu.oauthReady ? (
          <p className="muted">
            {akahu.sharedTokenOwnerOnly
              ? 'Akahu Personal App token is linked to the first account only. This account stays empty for bank sync until Full App OAuth is configured (or add holdings manually).'
              : 'Account linking is not available right now. You can still use an empty portfolio and add data manually.'}
          </p>
        ) : !akahu.configured && !akahu.oauthReady ? (
          <p className="muted">Account linking is not available right now.</p>
        ) : (
          <>
            {akahu.mode === 'personal' && akahu.canSync ? (
              <p className="muted small">
                Open Akahu to connect or manage your accounts, then come back here and sync.
              </p>
            ) : akahu.oauthReady && !akahu.oauthConnected ? (
              <p className="muted small">
                Choose the banks and investments you want to connect in Akahu (your data only).
              </p>
            ) : null}

            {institutions.length > 0 ? (
              <div className="akahu-institutions">
                <h3>Connected accounts</h3>
                <ul className="akahu-institution-list">
                  {institutions.map((inst) => (
                    <li key={inst.connectionId}>
                      <span className="akahu-inst-name">{inst.name}</span>
                      <span className="muted small">
                        {inst.accountCount} account{inst.accountCount === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {akahuError ? <p className="auth-error" role="alert">{akahuError}</p> : null}
            {akahuMsg ? <p className="auth-info" role="status">{akahuMsg}</p> : null}

            <div className="row gap">
              {akahu.mode === 'personal' ? (
                <a
                  className="btn primary"
                  href="https://my.akahu.nz"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Akahu to link accounts
                </a>
              ) : akahu.oauthReady ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={akahuBusy}
                  onClick={() => void onConnect()}
                >
                  {akahuBusy ? 'Working…' : akahu.oauthConnected ? 'Connect another account' : 'Connect'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={akahuBusy}
                onClick={() => void onSyncNow()}
              >
                {akahuBusy ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={akahuBusy}
                onClick={() => void onRefreshInstitutions()}
              >
                Refresh
              </button>
              {akahu.oauthConnected ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={akahuBusy}
                  onClick={() => void onDisconnect()}
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </>
  );
}
