/**
 * Settings → Account → Business account.
 * Personal and Both (and not themselves a linked business) create or link up to five
 * business accounts. A linked business sees who it is linked to and can switch back.
 * Switching replaces the session, so the dashboard is a full page load.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError, api, createLinkedBusiness, getAccountLinks, linkExistingBusiness, switchAccount, unlinkAccount } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { clearPageCache } from '../../lib/pageDataCache';
import { refreshAccountLinks } from '../../lib/useAccountLinks';
import {
  BUSINESS_ACCOUNT_EMPTY_COPY,
  BUSINESS_ACCOUNT_SECTION_ID,
  DASHBOARD_AFTER_SWITCH,
  accountLinkErrorCopy,
  businessAccountSection,
  linkedAccountTitle,
  linkedOwnerLine,
  readyCopy,
  showBackToPersonal,
  showCreateAndLink,
  readBusinessName,
  selfUnlinkName,
  showSelfUnlink,
  showUnlink,
  switchAccountErrorCopy,
  unlinkConfirmCopy,
  unlinkControlDisabled,
} from '../../lib/accountLinksView';
import type { AccountLinksResponse } from '../../types/accountLinks';
import { AccountTypePill } from '../AccountTypePill';

type Panel = { kind: 'idle' } | { kind: 'create' } | { kind: 'link' } | { kind: 'ready'; accountId: string; name: string };
type UnlinkTarget = { id: string; name: string; returnFocus: HTMLElement | null; reload: boolean };

export function BusinessAccountCard() {
  const { user } = useAuth();
  const location = useLocation();
  const sectionRef = useRef<HTMLElement>(null);
  const section = businessAccountSection(user?.activeAccount);
  const [links, setLinks] = useState<AccountLinksResponse | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [panel, setPanel] = useState<Panel>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlink, setUnlink] = useState<UnlinkTarget | null>(null);
  const [selfBusinessName, setSelfBusinessName] = useState<string | null>(null);

  useEffect(() => {
    if (!section) return;
    let live = true;
    getAccountLinks()
      .then((next) => {
        if (!live) return;
        setLinks(next);
        setLoad('ready');
      })
      .catch(() => {
        if (!live) return;
        setLoad('error');
      });
    return () => {
      live = false;
    };
  }, [section, reload]);

  useEffect(() => {
    if (section !== 'linked') return;
    let live = true;
    api.business
      .list()
      .then((res) => {
        if (!live) return;
        const row = res.businesses.find((business) => business.isDefault) ?? res.businesses[0];
        setSelfBusinessName(row?.name?.trim() || null);
      })
      .catch(() => {
        if (live) setSelfBusinessName(null);
      });
    return () => {
      live = false;
    };
  }, [section]);

  useEffect(() => {
    if (location.hash !== `#${BUSINESS_ACCOUNT_SECTION_ID}`) return;
    const el = sectionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  }, [location.hash, section, load]);

  const goToAccount = useCallback(async (accountId: string) => {
    setSwitching(accountId);
    setError(null);
    try {
      await switchAccount({ accountId });
      clearPageCache();
      refreshAccountLinks();
      window.location.assign(DASHBOARD_AFTER_SWITCH);
    } catch (err) {
      setError(switchAccountErrorCopy(err instanceof ApiError ? err.code : undefined));
      setSwitching(null);
    }
  }, []);

  if (!user || !section) return null;

  const open = (next: Panel) => {
    setError(null);
    setPanel(next);
  };

  return (
    <section
      ref={sectionRef}
      id={BUSINESS_ACCOUNT_SECTION_ID}
      className="panel account-card business-account-card"
      aria-labelledby="business-account-title"
      tabIndex={-1}
    >
      {section === 'linked' ? (
        <>
          <LinkedBusinessBody
            line={linkedOwnerLine(links?.owner ?? null)}
            ownerId={links?.owner?.id ?? user.activeAccount.ownerId}
            // TODO: canSwitchToOwner — hide Back to personal until GET /api/account/links sets it true.
            canSwitch={showBackToPersonal(links)}
            canUnlink={showSelfUnlink(links?.current)}
            switching={unlinkControlDisabled(switching !== null)}
            error={error}
            onBack={(id) => void goToAccount(id)}
            onUnlink={(returnFocus) => {
              const current = links?.current;
              if (!current) return;
              setError(null);
              setUnlink({
                id: current.id,
                name: selfUnlinkName(readBusinessName(current) || selfBusinessName),
                returnFocus,
                reload: true,
              });
            }}
          />
          {load === 'error' && !links?.owner && !user.activeAccount.ownerId ? (
            <p className="muted small">
              Couldn’t load the personal account.{' '}
              <button
                type="button"
                className="business-account-text-link"
                onClick={() => {
                  setLoad('loading');
                  setReload((n) => n + 1);
                }}
              >
                Try again
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="account-card-head">
            <h2 id="business-account-title">Business account</h2>
          </div>
          {load === 'loading' ? <p className="muted small">Loading…</p> : null}
          {load === 'error' ? (
            <p className="muted small">
              Couldn’t load business accounts.{' '}
              <button
                type="button"
                className="business-account-text-link"
                onClick={() => {
                  setLoad('loading');
                  setReload((n) => n + 1);
                }}
              >
                Try again
              </button>
            </p>
          ) : null}
          {load === 'ready' && links ? (
            <OwnerBody
              links={links}
              panel={panel}
              busy={busy}
              switching={switching}
              error={unlink ? null : error}
              onOpen={open}
              onError={setError}
              onBusy={setBusy}
              onLinks={setLinks}
              onSwitch={(id) => void goToAccount(id)}
              onUnlink={(target) => setUnlink(target)}
            />
          ) : null}
        </>
      )}
      {unlink ? (
        <UnlinkDialog
          name={unlink.name}
          busy={busy}
          error={error}
          returnFocus={unlink.returnFocus}
          onCancel={() => {
            if (busy) return;
            setError(null);
            setUnlink(null);
          }}
          onConfirm={() => {
            const target = unlink;
            setBusy(true);
            setError(null);
            unlinkAccount(target.id)
              .then((res) => {
                refreshAccountLinks();
                if (target.reload) {
                  clearPageCache();
                  window.location.reload();
                  return;
                }
                setLinks(res.links);
                setUnlink(null);
              })
              .catch((err: unknown) => {
                setError(accountLinkErrorCopy(err instanceof ApiError ? err.code : undefined));
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </section>
  );
}

function LinkedBusinessBody({
  line,
  ownerId,
  canSwitch,
  canUnlink,
  switching,
  error,
  onBack,
  onUnlink,
}: {
  line: string;
  ownerId: string | null;
  canSwitch: boolean;
  canUnlink: boolean;
  switching: boolean;
  error: string | null;
  onBack: (accountId: string) => void;
  onUnlink: (returnFocus: HTMLElement) => void;
}) {
  return (
    <>
      <h2 id="business-account-title" className="business-account-linked-line">
        {line}
      </h2>
      {canSwitch || canUnlink ? (
        <div className="account-actions">
          {canSwitch ? (
            <button
              type="button"
              className="btn primary"
              disabled={!ownerId || switching}
              onClick={() => {
                if (ownerId) onBack(ownerId);
              }}
            >
              {switching ? 'Switching…' : 'Back to personal'}
            </button>
          ) : null}
          {canUnlink ? (
            <button
              type="button"
              className="business-account-text-link is-danger"
              disabled={switching}
              onClick={(e) => onUnlink(e.currentTarget)}
            >
              Unlink
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function OwnerBody({
  links,
  panel,
  busy,
  switching,
  error,
  onOpen,
  onError,
  onBusy,
  onLinks,
  onSwitch,
  onUnlink,
}: {
  links: AccountLinksResponse;
  panel: Panel;
  busy: boolean;
  switching: string | null;
  error: string | null;
  onOpen: (panel: Panel) => void;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
  onLinks: (links: AccountLinksResponse) => void;
  onSwitch: (accountId: string) => void;
  onUnlink: (target: UnlinkTarget) => void;
}) {
  const linked = links.linked;
  const room = showCreateAndLink(linked.length);

  return (
    <>
      {linked.length > 0 && panel.kind !== 'ready' ? (
        <ul className="business-account-list">
          {linked.map((account) => {
            const name = linkedAccountTitle(account);
            return (
              <li key={account.id} className="business-account-row">
                <span className="business-account-name" title={name}>
                  {name}
                </span>
                <AccountTypePill type="business" />
                <button
                  type="button"
                  className="business-account-text-link"
                  disabled={switching !== null}
                  aria-label={`Switch to ${name}`}
                  onClick={() => onSwitch(account.id)}
                >
                  {switching === account.id ? 'Switching…' : 'Switch to it'}
                </button>
                {showUnlink(account) ? (
                  <button
                    type="button"
                    className="business-account-text-link is-danger"
                    aria-label={`Unlink ${name}`}
                    disabled={unlinkControlDisabled(switching !== null)}
                    onClick={(e) => {
                      onError(null);
                      onUnlink({
                        id: account.id,
                        name: linkedAccountTitle(account),
                        returnFocus: e.currentTarget,
                        reload: false,
                      });
                    }}
                  >
                    Unlink
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : panel.kind === 'idle' ? (
        <p className="business-account-lead">{BUSINESS_ACCOUNT_EMPTY_COPY}</p>
      ) : null}

      {panel.kind === 'ready' ? (
        <ReadyBlock
          name={panel.name}
          switching={switching === panel.accountId}
          onSwitch={() => onSwitch(panel.accountId)}
          onStay={() => onOpen({ kind: 'idle' })}
        />
      ) : null}

      {panel.kind === 'create' ? (
        <CreateForm
          busy={busy}
          error={error}
          onCancel={() => onOpen({ kind: 'idle' })}
          onSubmit={(businessName) => {
            if (!businessName || businessName.length > 120) {
              onError(accountLinkErrorCopy('INVALID_BUSINESS_NAME'));
              return;
            }
            onBusy(true);
            onError(null);
            createLinkedBusiness({ businessName })
              .then((res) => {
                onLinks(res.links);
                refreshAccountLinks();
                onOpen({ kind: 'ready', accountId: res.account.id, name: linkedAccountTitle(res.account) });
              })
              .catch((err: unknown) => {
                onError(accountLinkErrorCopy(err instanceof ApiError ? err.code : undefined));
              })
              .finally(() => onBusy(false));
          }}
        />
      ) : null}

      {panel.kind === 'link' ? (
        <LinkForm
          busy={busy}
          error={error}
          onCancel={() => onOpen({ kind: 'idle' })}
          onSubmit={(email, password) => {
            onBusy(true);
            onError(null);
            linkExistingBusiness({ email, password })
              .then((res) => {
                onLinks(res.links);
                refreshAccountLinks();
                onOpen({ kind: 'idle' });
              })
              .catch((err: unknown) => {
                onError(accountLinkErrorCopy(err instanceof ApiError ? err.code : undefined));
              })
              .finally(() => onBusy(false));
          }}
        />
      ) : null}

      {room && panel.kind === 'idle' ? (
        <div className="business-account-actions">
          {linked.length === 0 ? null : <p className="sr-only">Add another business account</p>}
          <button type="button" className="btn primary" onClick={() => onOpen({ kind: 'create' })}>
            Create business account
          </button>
          <button type="button" className="business-account-text-link" onClick={() => onOpen({ kind: 'link' })}>
            Link an existing one
          </button>
        </div>
      ) : null}

      {error && (panel.kind === 'idle' || panel.kind === 'ready') ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function ReadyBlock({
  name,
  switching,
  onSwitch,
  onStay,
}: {
  name: string;
  switching: boolean;
  onSwitch: () => void;
  onStay: () => void;
}) {
  return (
    <div className="business-account-ready">
      <p>{readyCopy(name)}</p>
      <div className="account-actions">
        <button type="button" className="btn primary" disabled={switching} onClick={onSwitch}>
          {switching ? 'Switching…' : 'Switch to it'}
        </button>
        <button type="button" className="business-account-text-link" onClick={onStay}>
          Stay here
        </button>
      </div>
    </div>
  );
}

function CreateForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (businessName: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const fieldId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const businessName = name.trim().replace(/\s+/g, ' ');
    if (!businessName || businessName.length > 120) {
      onSubmit('');
      return;
    }
    onSubmit(businessName);
  };
  return (
    <form className="account-inline-form" onSubmit={submit}>
      <label className="field" htmlFor={fieldId}>
        <span>Business name</span>
        <input
          id={fieldId}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          disabled={busy}
          autoComplete="organization"
          spellCheck={false}
        />
      </label>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="account-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" className="business-account-text-link" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LinkForm({
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailId = useId();
  const passwordId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    const secret = password;
    setPassword('');
    if (!trimmed || !secret) return;
    onSubmit(trimmed, secret);
  };
  return (
    <form className="account-inline-form" onSubmit={submit}>
      <label className="field" htmlFor={emailId}>
        <span>Email</span>
        <input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={busy}
          spellCheck={false}
        />
      </label>
      <label className="field" htmlFor={passwordId}>
        <span>Password</span>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          disabled={busy}
        />
      </label>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="account-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Linking…' : 'Link'}
        </button>
        <button
          type="button"
          className="business-account-text-link"
          disabled={busy}
          onClick={() => {
            setPassword('');
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function UnlinkDialog({
  name,
  busy,
  error,
  returnFocus,
  onConfirm,
  onCancel,
}: {
  name: string;
  busy: boolean;
  error: string | null;
  returnFocus: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  const returnFocusRef = useRef(returnFocus);
  const titleId = useId();
  useEffect(() => {
    onCancelRef.current = onCancel;
    busyRef.current = busy;
    returnFocusRef.current = returnFocus;
  }, [onCancel, busy, returnFocus]);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = returnFocusRef.current;
      if (back?.isConnected) back.focus();
      else document.getElementById(BUSINESS_ACCOUNT_SECTION_ID)?.focus();
    };
  }, []);

  const copy = unlinkConfirmCopy(name);
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal-dialog business-account-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p id={titleId} className="business-account-dialog-copy">
          {copy}
        </p>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="account-actions">
          <button type="button" className="btn danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Unlinking…' : 'Unlink'}
          </button>
          <button type="button" className="business-account-text-link" ref={cancelRef} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
