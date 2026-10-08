import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AssetClassToggles } from '../components/AssetClassToggles';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import { useAuth } from '../auth/AuthContext';
import { ApiError, api } from '../api/client';
import {
  defaultAssetClassPrefs,
  type AssetClassPrefs,
} from '../lib/assetClassPrefs';
import {
  defaultValueSearchPrefs,
  type ValueSearchPrefs,
} from '../lib/valueSearchPrefs';
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
import {
  CATEGORY_TYPES,
  CATEGORY_TYPE_LABELS,
  normalizeCategoryType,
  type CategoryType,
} from '../lib/categoryTypes';
import { CategoryTypeToggle } from '../components/CategoryTypeToggle';
import { SecurityPanel } from '../components/SecurityPanel';
import { BusinessDetailsPanel } from '../components/BusinessDetailsPanel';
import {
  beginPageRead,
  commitPageRead,
  invalidateAfterAkahuLinkChange,
  invalidateAfterExternalSync,
  invalidateFinancial,
  portfolioSyncChanged,
  readPageCache,
  txnSyncChanged,
} from '../lib/pageDataCache';

type SettingsTab = 'account' | 'security' | 'business' | 'categories';

type TxCategory = {
  id: string;
  name: string;
  parentId: string | null;
  colour: string | null;
  type: CategoryType;
  isIncome: boolean;
  sortOrder: number;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // Akahu OAuth returns to /settings?akahu=… — open Categories tab so the handler mounts
  const tab: SettingsTab =
    searchParams.get('akahu') || tabParam === 'categories'
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
            Categories / assets
          </button>
        </nav>
      </aside>
      <div className="settings-main stack">
        {tab === 'account' ? (
          <AccountPanel />
        ) : tab === 'security' ? (
          <SecurityPanel />
        ) : tab === 'business' ? (
          <BusinessDetailsPanel />
        ) : (
          <CategoriesPanel searchParams={searchParams} setSearchParams={setSearchParams} />
        )}
      </div>
    </div>
  );
}

function AccountPanel() {
  const { user, setUser, refresh } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [email, setEmail] = useState(user?.email ?? '');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passError, setPassError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
    setEmail(user?.email ?? '');
  }, [user?.firstName, user?.lastName, user?.email]);

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    setProfileError(null);
    try {
      const res = await api.auth.updateProfile({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
      });
      setUser(res.user);
      setProfileMsg('Name saved.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not save profile');
    } finally {
      setProfileBusy(false);
    }
  };

  const onAvatarPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileError('Choose an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setProfileError('Image must be under 8 MB.');
      return;
    }
    setProfileBusy(true);
    setProfileMsg(null);
    setProfileError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await api.auth.uploadAvatar(dataUrl);
      setUser(res.user);
      setProfileMsg('Profile picture updated.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not upload picture');
    } finally {
      setProfileBusy(false);
    }
  };

  const onRemoveAvatar = async () => {
    setProfileBusy(true);
    setProfileMsg(null);
    setProfileError(null);
    try {
      const res = await api.auth.removeAvatar();
      setUser(res.user);
      setProfileMsg('Profile picture removed.');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Could not remove picture');
    } finally {
      setProfileBusy(false);
    }
  };

  const onChangeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailBusy(true);
    setEmailMsg(null);
    setEmailError(null);
    try {
      const res = await api.auth.changeEmail({
        currentPassword: emailPassword,
        email: email.trim(),
      });
      setUser(res.user);
      setEmailPassword('');
      setEmailMsg(res.message || 'Email updated.');
      await refresh();
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : 'Could not change email');
    } finally {
      setEmailBusy(false);
    }
  };

  const onChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPassBusy(true);
    setPassMsg(null);
    setPassError(null);
    if (newPassword !== confirmPassword) {
      setPassError('New password and confirmation do not match.');
      setPassBusy(false);
      return;
    }
    try {
      const res = await api.auth.changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassMsg(res.message || 'Password updated.');
    } catch (err) {
      setPassError(err instanceof ApiError ? err.message : 'Could not change password');
    } finally {
      setPassBusy(false);
    }
  };

  const onDeleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    setDeleteBusy(true);
    setDeleteError(null);
    if (deleteConfirm.trim() !== 'DELETE') {
      setDeleteError('Type DELETE in capitals to confirm.');
      setDeleteBusy(false);
      return;
    }
    try {
      await api.auth.deleteAccount({
        password: deletePassword,
        confirm: 'DELETE',
      });
      setUser(null);
      setDeletePassword('');
      setDeleteConfirm('');
      navigate('/login', { replace: true });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete account');
    } finally {
      setDeleteBusy(false);
    }
  };

  const initials = (() => {
    const f = (user?.firstName || '').trim();
    const l = (user?.lastName || '').trim();
    if (f && l) return (f[0] + l[0]).toUpperCase();
    const name = (user?.displayName || '').trim() || [f, l].filter(Boolean).join(' ');
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    return (user?.email || '?').slice(0, 2).toUpperCase();
  })();

  return (
    <>
      <section className="panel">
        <h2>Account</h2>
        <p className="page-lead">
          Profile picture, name, email, and password for this local account. Changes require
          your current password where noted.
        </p>

        <div className="account-avatar-row">
          <div className="account-avatar-preview" aria-hidden>
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="account-avatar-img" />
            ) : (
              <span className="account-avatar-fallback">{initials}</span>
            )}
          </div>
          <div className="account-avatar-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={(ev) => void onAvatarPick(ev)}
            />
            <button
              type="button"
              className="btn small"
              disabled={profileBusy}
              onClick={() => fileRef.current?.click()}
            >
              Upload picture
            </button>
            {user?.avatarUrl ? (
              <button
                type="button"
                className="btn small ghost"
                disabled={profileBusy}
                onClick={() => void onRemoveAvatar()}
              >
                Remove
              </button>
            ) : null}
            <p className="muted small">JPEG, PNG, WebP, or GIF · max 8 MB</p>
          </div>
        </div>

        <form className="auth-form account-form" onSubmit={onSaveProfile}>
          <div className="row gap wrap-row">
            <label className="field grow">
              <span>First name</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={40}
                placeholder="First name"
                disabled={profileBusy}
                autoComplete="given-name"
              />
            </label>
            <label className="field grow">
              <span>Last name</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={40}
                placeholder="Last name"
                disabled={profileBusy}
                autoComplete="family-name"
              />
            </label>
          </div>
          <label className="field">
            <span>Email (read-only here)</span>
            <input type="email" value={user?.email ?? ''} disabled readOnly />
          </label>
          {profileError ? <p className="auth-error" role="alert">{profileError}</p> : null}
          {profileMsg ? <p className="auth-info" role="status">{profileMsg}</p> : null}
          <button type="submit" className="btn primary" disabled={profileBusy}>
            {profileBusy ? 'Saving…' : 'Save name'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h3>Change email</h3>
        <p className="muted small">Requires your current password.</p>
        <form className="auth-form account-form" onSubmit={onChangeEmail}>
          <label className="field">
            <span>New email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={emailBusy}
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              required
              disabled={emailBusy}
              autoComplete="current-password"
            />
          </label>
          {emailError ? <p className="auth-error" role="alert">{emailError}</p> : null}
          {emailMsg ? <p className="auth-info" role="status">{emailMsg}</p> : null}
          <button type="submit" className="btn primary" disabled={emailBusy}>
            {emailBusy ? 'Updating…' : 'Update email'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h3>Change password</h3>
        <p className="muted small">Min 8 characters with a letter and a number.</p>
        <form className="auth-form account-form" onSubmit={onChangePassword}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={passBusy}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={passBusy}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={passBusy}
              autoComplete="new-password"
            />
          </label>
          {passError ? <p className="auth-error" role="alert">{passError}</p> : null}
          {passMsg ? <p className="auth-info" role="status">{passMsg}</p> : null}
          <button type="submit" className="btn primary" disabled={passBusy}>
            {passBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section className="panel account-danger-zone">
        <h3>Delete account</h3>
        <p className="muted small">
          Permanently removes this local account, your sessions, profile picture, preferences, and
          finance data scoped to you. Other users&apos; data is not touched. Shared app data{' '}
          (transaction categories, GoMining settings, quote cache) stays until per-user isolation
          covers those tables — see docs/AUTH.md.
        </p>
        {!deleteOpen ? (
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              setDeleteOpen(true);
              setDeleteError(null);
            }}
          >
            Delete account…
          </button>
        ) : (
          <form className="auth-form account-form" onSubmit={onDeleteAccount}>
            <p className="auth-error" role="status">
              This cannot be undone. Type <strong>DELETE</strong> and enter your password to
              confirm.
            </p>
            <label className="field">
              <span>Type DELETE to confirm</span>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                required
                disabled={deleteBusy}
                autoComplete="off"
                placeholder="DELETE"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                required
                disabled={deleteBusy}
                autoComplete="current-password"
              />
            </label>
            {deleteError ? (
              <p className="auth-error" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className="row gap">
              <button
                type="submit"
                className="btn danger"
                disabled={deleteBusy || deleteConfirm.trim() !== 'DELETE' || !deletePassword}
              >
                {deleteBusy ? 'Deleting…' : 'Permanently delete account'}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={deleteBusy}
                onClick={() => {
                  setDeleteOpen(false);
                  setDeletePassword('');
                  setDeleteConfirm('');
                  setDeleteError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}

function CategoriesPanel({
  searchParams,
  setSearchParams,
}: {
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  const { prefs, valueSearch, loading, save, refresh } = useAssetClassPrefs();
  const [draft, setDraft] = useState<AssetClassPrefs>(prefs);
  const [vsDraft, setVsDraft] = useState<ValueSearchPrefs>(valueSearch);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [akahu, setAkahu] = useState<AkahuConnectionStatus | null>(
    () => readPageCache<AkahuConnectionStatus>('settings:akahu') ?? null,
  );
  const [akahuBusy, setAkahuBusy] = useState(false);
  const [akahuMsg, setAkahuMsg] = useState<string | null>(null);
  const [akahuError, setAkahuError] = useState<string | null>(null);
  const [institutions, setInstitutions] = useState<AkahuInstitution[]>(
    () => readPageCache<AkahuConnectionStatus>('settings:akahu')?.institutions ?? [],
  );

  const [categories, setCategories] = useState<TxCategory[]>(
    () => readPageCache<TxCategory[]>('categories') ?? [],
  );
  const [catBusy, setCatBusy] = useState(false);
  const [catMsg, setCatMsg] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState<CategoryType>('spending');

  useEffect(() => {
    setDraft(prefs);
  }, [prefs]);

  useEffect(() => {
    setVsDraft(valueSearch);
  }, [valueSearch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadCategories = useCallback(async () => {
    const stamp = beginPageRead('categories');
    try {
      const rows = await api.budgets.categories();
      if (!commitPageRead(stamp, rows)) return;
      setCategories(rows);
    } catch (err) {
      setCatError(err instanceof ApiError ? err.message : 'Could not load categories');
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

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
    if (!next.get('tab')) next.set('tab', 'categories');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, loadAkahu]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await save(draft, vsDraft);
      setMsg('Asset class & Value Search preferences saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save preferences');
    } finally {
      setBusy(false);
    }
  };

  const resetDefaults = () => {
    setDraft(defaultAssetClassPrefs());
    setVsDraft(defaultValueSearchPrefs());
    setMsg(null);
    setError(null);
  };

  const onAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    setCatBusy(true);
    setCatMsg(null);
    setCatError(null);
    try {
      const createdType = newCatType;
      await api.budgets.createCategory({ name, type: createdType });
      setNewCatName('');
      setNewCatType('spending');
      setCatMsg(`Added “${name}” (${CATEGORY_TYPE_LABELS[createdType].toLowerCase()}).`);
      invalidateFinancial('categories', 'spending');
      await loadCategories();
    } catch (err) {
      setCatError(err instanceof ApiError ? err.message : 'Could not add category');
    } finally {
      setCatBusy(false);
    }
  };

  const onDeleteCategory = async (cat: TxCategory) => {
    if (
      !window.confirm(
        `Remove category “${cat.name}”? Transactions keep their history but lose this category tag; related budget plans are deleted.`,
      )
    ) {
      return;
    }
    setCatBusy(true);
    setCatMsg(null);
    setCatError(null);
    try {
      await api.budgets.deleteCategory(cat.id);
      setCatMsg(`Removed “${cat.name}”.`);
      invalidateFinancial('categories', 'spending', 'dashboard');
      await loadCategories();
    } catch (err) {
      setCatError(err instanceof ApiError ? err.message : 'Could not remove category');
    } finally {
      setCatBusy(false);
    }
  };

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

  const catsByType = (t: CategoryType) =>
    categories.filter((c) => normalizeCategoryType(c.type, c.isIncome) === t);

  return (
    <>
      <section className="panel">
        <h2>Asset categories</h2>
        <p className="page-lead">
          Choose which asset classes appear in Portfolio, Dashboard, and nav. Turning a class off
          hides it in the UI; holdings and balances stay in the local database.
        </p>
        {loading ? <p className="muted">Loading preferences…</p> : null}
        <form className="auth-form" onSubmit={onSubmit}>
          <AssetClassToggles value={draft} onChange={setDraft} disabled={busy || loading} />
          <div className="asset-toggles" style={{ marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Value Search tools</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Extra tools on Value Search — independent of asset-class holdings toggles.
            </p>
            <ul className="asset-toggle-list" role="list">
              <li>
                <button
                  type="button"
                  className={
                    vsDraft.showCurrencyExchanger ? 'asset-toggle on' : 'asset-toggle off'
                  }
                  role="switch"
                  aria-checked={vsDraft.showCurrencyExchanger}
                  disabled={busy || loading}
                  onClick={() =>
                    setVsDraft((prev) => ({
                      ...prev,
                      showCurrencyExchanger: !prev.showCurrencyExchanger,
                    }))
                  }
                >
                  <span className="asset-toggle-text">
                    <span className="asset-toggle-label">Currency exchanger</span>
                    <span className="asset-toggle-blurb">
                      Frankfurter → NZD on Value Search (not gated by Forex holdings)
                    </span>
                  </span>
                  <span className="asset-toggle-track" aria-hidden>
                    <span className="asset-toggle-knob" />
                  </span>
                </button>
              </li>
            </ul>
          </div>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {msg ? <p className="auth-info" role="status">{msg}</p> : null}
          <div className="row gap">
            <button type="submit" className="btn primary" disabled={busy || loading}>
              {busy ? 'Saving…' : 'Save preferences'}
            </button>
            <button type="button" className="btn ghost" disabled={busy || loading} onClick={resetDefaults}>
              Reset to all on
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Transaction categories</h2>
        <p className="page-lead">
          Add or remove categories by type (spending, income, transfer out, transfer in) for the Budget page and budget plans.
        </p>

        <form className="auth-form account-form" onSubmit={onAddCategory}>
          <CategoryTypeToggle
            value={newCatType}
            onChange={setNewCatType}
            disabled={catBusy}
            label="Type (set when creating)"
          />
          <div className="row gap wrap-row" style={{ marginTop: '0.75rem' }}>
            <label className="field grow">
              <span>New category name</span>
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                maxLength={80}
                placeholder="e.g. Pets"
                disabled={catBusy}
                required
              />
            </label>
            <div className="field field-align-end">
              <span className="sr-only">Add</span>
              <button type="submit" className="btn primary" disabled={catBusy || !newCatName.trim()}>
                {catBusy ? 'Adding…' : `Add ${CATEGORY_TYPE_LABELS[newCatType].toLowerCase()} category`}
              </button>
            </div>
          </div>
        </form>

        {catError ? <p className="auth-error" role="alert">{catError}</p> : null}
        {catMsg ? <p className="auth-info" role="status">{catMsg}</p> : null}

        <div className="txn-cat-columns txn-cat-columns-4">
          {CATEGORY_TYPES.map((t) => {
            const rows = catsByType(t);
            return (
              <div key={t}>
                <h3>{CATEGORY_TYPE_LABELS[t]}</h3>
                <ul className="txn-cat-list">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <span>{c.name}</span>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={catBusy}
                        onClick={() => void onDeleteCategory(c)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  {rows.length === 0 ? (
                    <li className="muted">No {CATEGORY_TYPE_LABELS[t].toLowerCase()} categories.</li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

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
