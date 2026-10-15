/**
 * Household (KAN-77): create a household, invite people by link, manage roles, leave,
 * transfer ownership, see the activity log, and share items (HouseholdShared).
 * Households are part of Plus (checked on the server).
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { HouseholdView } from '../types';
import { LEGAL_CONTACT_EMAIL } from '../components/legal/LegalLayout';
import { HouseholdShared } from '../components/household/HouseholdShared';
import { showQuietToast } from '../lib/quietToast';
import { useMoneyHidden } from '../lib/privacy';

const ROLE_LABEL = { owner: 'Owner', adult: 'Adult', viewer: 'Viewer' } as const;
const ROLE_HELP = {
  owner: 'Manages members and invites.',
  adult: 'Can edit what the household shares.',
  viewer: 'Can see what the household shares, but not change it.',
} as const;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function Household() {
  // Re-render when Hide amounts changes; formatNzd then masks every figure.
  useMoneyHidden();
  const [view, setView] = useState<HouseholdView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'adult' | 'viewer'>('adult');
  const [lastLink, setLastLink] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const navigate = useNavigate();
  const ids = { name: useId(), email: useId(), role: useId() };

  const load = useCallback(() => {
    api.household.get().then(setView).catch((e: unknown) => setError(errText(e, 'Could not load your household.')));
  }, []);
  useEffect(load, [load]);

  async function act<T>(fn: () => Promise<T>, note: string, after?: (r: T) => void, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'plan' in (r as object)) setView(r as unknown as HouseholdView);
      else load();
      after?.(r);
      setMsg(note);
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  const hh = view?.household ?? null;
  const owner = hh?.myRole === 'owner';

  return (
    <div className="stack bills-page warranties-page household-page">
      <header>
        <h2 className="page-title">Household</h2>
        <p className="muted small">Share budgets and finances with a partner, family or flatmates, while the rest stays private.</p>
      </header>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {msg ? <p className="banner" role="status">{msg}</p> : null}
      {!view && !error ? <p className="muted">Loading…</p> : null}

      {view && !hh ? (
        view.plan.householdFeature ? (
          <section className="panel" aria-labelledby="hh-create-title">
            <h3 id="hh-create-title">Start a household</h3>
            <p className="muted small">You’ll be the owner. Invite people next; they need their own KoruLedger account and keep their finances private.</p>
            <form
              className="hh-row"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void act(() => api.household.create(name), 'Household created.', () => setName(''));
              }}
            >
              <label htmlFor={ids.name} className="sr-only">
                Household name
              </label>
              <input id={ids.name} value={name} maxLength={60} placeholder="e.g. The Smiths" onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
                Create household
              </button>
            </form>
          </section>
        ) : (
          <section className="panel" aria-labelledby="hh-plus-title">
            <h3 id="hh-plus-title">Households are part of KoruLedger Plus</h3>
            <p>
              With Plus you can start a household and invite others. One plan covers everyone in it. If someone has invited you,
              open the link in their invite to join.
            </p>
            <p className="muted small">
              To get Plus, email <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
            </p>
          </section>
        )
      ) : null}

      {hh ? (
        <>
          {!hh.active ? (
            <p className="banner warn" role="status">
              The owner’s plan no longer includes households. Everyone can still see it and leave; changes need Plus again.
            </p>
          ) : null}
          <section className="panel" aria-labelledby="hh-members-title">
            <div className="hh-head">
              <h3 id="hh-members-title">{hh.name}</h3>
              {owner ? (
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={busy || !hh.active}
                  onClick={() => {
                    const n = window.prompt('Rename household', hh.name);
                    if (n && n.trim() && n !== hh.name) void act(() => api.household.rename(n), 'Renamed.');
                  }}
                >
                  Rename
                </button>
              ) : null}
            </div>
            <p className="muted small">
              You’re {hh.myRole === 'owner' ? 'the owner' : `${hh.myRole === 'adult' ? 'an adult' : 'a viewer'}`}: {ROLE_HELP[hh.myRole].toLowerCase()}
            </p>
            <ul className="hh-members">
              {hh.members.map((m) => (
                <li key={m.userId}>
                  <div className="hh-member-who">
                    <strong>
                      {m.name}
                      {m.isMe ? ' (you)' : ''}
                    </strong>
                    <span className="muted small">{m.email}</span>
                  </div>
                  {owner && m.role !== 'owner' ? (
                    <div className="hh-member-actions">
                      <select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        disabled={busy || !hh.active}
                        onChange={(e) => void act(() => api.household.setRole(m.userId, e.target.value as 'adult' | 'viewer'), `${m.name} is now ${e.target.value === 'adult' ? 'an adult' : 'a viewer'}.`)}
                      >
                        <option value="adult">Adult</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      {m.role === 'adult' ? (
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy || !hh.active}
                          onClick={() => void act(() => api.household.transfer(m.userId), `${m.name} is now the owner.`, undefined, `Make ${m.name} the owner? You’ll become an adult member.`)}
                        >
                          Make owner
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="link-btn"
                        disabled={busy || !hh.active}
                        onClick={() => void act(() => api.household.removeMember(m.userId), `${m.name} was removed.`, undefined, `Remove ${m.name} from the household?`)}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="hh-role">{ROLE_LABEL[m.role]}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <HouseholdShared key={hh.id} active={hh.active} onNote={(m) => showQuietToast(m, { kind: 'info', ttlMs: 4000 })} />

          {owner ? (
            <section className="panel" aria-labelledby="hh-invite-title">
              <h3 id="hh-invite-title">Invite someone</h3>
              <form
                className="hh-row"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  const email = inviteEmail;
                  void act(() => api.household.invite(email, inviteRole), 'Invite created.', (r) => {
                    setLastLink({ link: r.invite.link, emailed: r.invite.emailed, email });
                    setInviteEmail('');
                  });
                }}
              >
                <label htmlFor={ids.email} className="sr-only">
                  Their email
                </label>
                <input id={ids.email} type="email" value={inviteEmail} placeholder="Their email" onChange={(e) => setInviteEmail(e.target.value)} />
                <label htmlFor={ids.role} className="sr-only">
                  Role
                </label>
                <select id={ids.role} value={inviteRole} onChange={(e) => setInviteRole(e.target.value === 'viewer' ? 'viewer' : 'adult')}>
                  <option value="adult">Adult</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit" className="btn primary" disabled={busy || !inviteEmail.trim() || !hh.active}>
                  Create invite
                </button>
              </form>
              <p className="muted small">The link works once, for that email address only, for 7 days.</p>
              {lastLink ? (
                <div className="hh-link" role="status">
                  <p>
                    {lastLink.emailed ? `Emailed to ${lastLink.email}. You can also send them this link:` : `Send ${lastLink.email} this link:`}
                  </p>
                  <div className="hh-row">
                    <input readOnly value={lastLink.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void navigator.clipboard?.writeText(lastLink.link).then(() => setMsg('Link copied.'))}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
              {hh.invites.length ? (
                <ul className="hh-invites">
                  {hh.invites.map((i) => (
                    <li key={i.id}>
                      <span>
                        {i.email} · {ROLE_LABEL[i.role]} · {i.expired ? 'expired' : `until ${when(i.expiresAt)}`}
                      </span>
                      <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.household.revokeInvite(i.id), 'Invite cancelled.')}>
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="panel" aria-labelledby="hh-activity-title">
            <h3 id="hh-activity-title">Activity</h3>
            <ul className="hh-activity">
              {hh.activity.map((a) => (
                <li key={a.id}>
                  <span>
                    <strong>{a.actorName}</strong> {a.action}
                    {a.detail ? `: ${a.detail}` : ''}
                  </span>
                  <span className="muted small">{when(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-labelledby="hh-leave-title">
            <h3 id="hh-leave-title">{owner ? 'Delete household' : 'Leave household'}</h3>
            <p className="muted small">
              {owner
                ? 'Everyone keeps their own finances. To leave instead, make another adult the owner first.'
                : 'You keep all your own finances.'}
            </p>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() =>
                owner
                  ? void act(() => api.household.remove(), 'Household deleted.', () => navigate('/household'), `Delete “${hh.name}” for everyone?`)
                  : void act(() => api.household.leave(), 'You left the household.', undefined, `Leave “${hh.name}”?`)
              }
            >
              {owner ? 'Delete household' : 'Leave household'}
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
