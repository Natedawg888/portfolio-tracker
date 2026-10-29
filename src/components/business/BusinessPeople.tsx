/**
 * Who can open this business's books (KAN-129). The owner invites an accountant or a viewer by
 * email, changes their role, removes them, and cancels invites; anyone else sees who has access
 * and can leave. Reuses the household list styles (hh-*).
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { errorText } from './BusinessUi';
import { showQuietToast } from '../../lib/quietToast';
import { formatInvoiceDate } from '../../pages/invoicesView';
import { aucklandToday } from '../../lib/debtModel';
import type { BusinessMemberRole, BusinessMembersView } from '../../types';

const ROLE_LABEL: Record<BusinessMemberRole, string> = { accountant: 'Accountant', viewer: 'Viewer' };
const when = (iso: string) => formatInvoiceDate(aucklandToday(new Date(iso)));

export function BusinessPeople({ businessId, businessName, myUserId }: { businessId: string; businessName: string; myUserId: string | null }) {
  const navigate = useNavigate();
  const ids = { email: useId(), role: useId() };
  const [view, setView] = useState<BusinessMembersView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BusinessMemberRole>('accountant');
  const [lastLink, setLastLink] = useState<{ link: string; emailed: boolean; email: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.business
      .members(businessId)
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(errorText(e, 'Could not load who has access.')));
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function act<T>(fn: () => Promise<T>, note: string, after?: (r: T) => void, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      showQuietToast(note);
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return error ? (
      <section className="panel warranty-card" aria-label="People with access">
        <p className="auth-error" role="alert">{error}</p>
      </section>
    ) : null;
  }

  const owner = view.myRole === 'owner';
  const name = businessName || 'this business';

  return (
    <section className="panel warranty-card" aria-labelledby="biz-people">
      <div className="rental-card-head">
        <h3 id="biz-people">People with access</h3>
      </div>
      <p className="muted small">
        {owner
          ? 'Let your accountant, or someone who only needs to look, into this business’s books. They see this business only, never your personal finances, and you can remove them at any time.'
          : `${view.owner.name} owns ${name} and decides who has access. You see this business only.`}
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <ul className="hh-members">
        <li>
          <div className="hh-member-who">
            <strong>
              {view.owner.name}
              {owner ? ' (you)' : ''}
            </strong>
          </div>
          <span className="hh-role">Owner</span>
        </li>
        {view.members.map((m) => {
          const isMe = m.userId === myUserId;
          return (
            <li key={m.userId}>
              <div className="hh-member-who">
                <strong>
                  {m.name}
                  {isMe ? ' (you)' : ''}
                </strong>
                {m.email ? <span className="muted small">{m.email}</span> : null}
              </div>
              {owner ? (
                <div className="hh-member-actions">
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => {
                      const next = e.target.value === 'viewer' ? 'viewer' : 'accountant';
                      void act(() => api.business.setMemberRole(businessId, m.userId, next), `${m.name} is now ${next === 'accountant' ? 'an accountant' : 'a viewer'}.`, setView);
                    }}
                  >
                    <option value="accountant">Accountant</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.business.removeMember(businessId, m.userId).then(() => api.business.members(businessId)),
                        `${m.name} no longer has access.`,
                        setView,
                        `Remove ${m.name}’s access to ${name}?`,
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ) : isMe ? (
                <div className="hh-member-actions">
                  <span className="hh-role">{ROLE_LABEL[m.role]}</span>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => api.business.removeMember(businessId, m.userId),
                        `You left ${name}.`,
                        () => navigate('/business', { replace: true }),
                        `Leave ${name}? You’ll need a new invite to come back.`,
                      )
                    }
                  >
                    Leave
                  </button>
                </div>
              ) : (
                <span className="hh-role">{ROLE_LABEL[m.role]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {owner ? (
        <>
          <form
            className="hh-row"
            aria-label="Invite someone"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const to = email;
              void act(() => api.business.invite(businessId, to, role), 'Invite created.', (r) => {
                setView(r);
                setLastLink({ link: r.invite.link, emailed: r.invite.emailed, email: to });
                setEmail('');
              });
            }}
          >
            <label htmlFor={ids.email} className="sr-only">
              Their email
            </label>
            <input id={ids.email} type="email" value={email} placeholder="Their email" onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor={ids.role} className="sr-only">
              Role
            </label>
            <select id={ids.role} value={role} onChange={(e) => setRole(e.target.value === 'viewer' ? 'viewer' : 'accountant')}>
              <option value="accountant">Accountant</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit" className="btn primary" disabled={busy || !email.trim()}>
              Invite
            </button>
          </form>
          <p className="muted small">
            An accountant can read and edit the books; a viewer can only read them. The link works once, for that email address only, for 7
            days.
          </p>
          {lastLink ? (
            <div className="hh-link" role="status">
              <p>{lastLink.emailed ? `Emailed to ${lastLink.email}. You can also send them this link:` : `Send ${lastLink.email} this link:`}</p>
              <div className="hh-row">
                <input readOnly value={lastLink.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(lastLink.link).then(() => showQuietToast('Link copied.'))}>
                  Copy
                </button>
              </div>
            </div>
          ) : null}
          {view.invites.length ? (
            <ul className="hh-invites" aria-label="Invites waiting">
              {view.invites.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.email} · {ROLE_LABEL[i.role]} · until {when(i.expiresAt)}
                  </span>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.revokeInvite(businessId, i.id), 'Invite cancelled.', setView)}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {view.activity.length ? (
        <details className="business-people-activity">
          <summary className="small">Recent changes</summary>
          <ul className="hh-activity">
            {view.activity.map((a, i) => (
              <li key={`${a.createdAt}-${i}`}>
                <span>
                  {a.actorName} {a.action}
                </span>
                <span className="muted small">{when(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
