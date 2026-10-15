/**
 * Household page, phase 2 (KAN-77): what the household shares (net worth, budgets, bills,
 * goals, recent transactions on shared accounts with who made them) and what you share.
 * Adults and the owner can change shared budgets, goals and bills, and split shared spending
 * (phase 3, HouseholdSplits); viewers only see them.
 * Amounts follow Hide amounts through formatNzd.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { api, formatNzd } from '../../api/client';
import type { HouseholdDashboard, HouseholdShareKind, HouseholdShareable, HouseholdSplitsView } from '../../types';
import { longDate } from '../../pages/warrantiesView';
import { SettleUp, SplitEditor, SplitLine } from './HouseholdSplits';

const KIND_TITLES: Record<HouseholdShareKind, string> = {
  budget: 'Budgets',
  bill: 'Bills',
  goal: 'Goals',
  holding: 'Holdings',
  account: 'Bank accounts',
};
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** A number field that saves on submit; used for adult edits of shared items. */
function AmountEdit({ label, value, onSave }: { label: string; value: number | null; onSave: (n: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value == null ? '' : String(value));
  const [busy, setBusy] = useState(false);
  const id = useId();
  if (!open) {
    return (
      <button type="button" className="link-btn hh-edit" onClick={() => setOpen(true)}>
        Change {label.toLowerCase()}
      </button>
    );
  }
  return (
    <form
      className="hh-amount-edit"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) return;
        setBusy(true);
        void onSave(n).finally(() => {
          setBusy(false);
          setOpen(false);
        });
      }}
    >
      <label htmlFor={id}>{label} (NZD)</label>
      <input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={text} autoFocus onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn primary" disabled={busy}>
        Save
      </button>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

export function HouseholdShared({ active, onNote }: { active: boolean; onNote: (msg: string) => void }) {
  const [dash, setDash] = useState<HouseholdDashboard | null>(null);
  const [mine, setMine] = useState<HouseholdShareable | null>(null);
  const [splits, setSplits] = useState<HouseholdSplitsView | null>(null);
  const [splitting, setSplitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.household.dashboard().then(setDash).catch((e: unknown) => setError(errText(e, 'Could not load what’s shared.')));
    api.household.shareable().then(setMine).catch(() => {});
    api.household.splits().then(setSplits).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function edit(fn: () => Promise<unknown>, note: string) {
    setError(null);
    try {
      await fn();
      onNote(note);
      load();
    } catch (e) {
      setError(errText(e, 'Could not save.'));
    }
  }

  /** Splits and payments: errors are shown by the caller (the split editor shows its own). */
  async function changeSplits(fn: () => Promise<HouseholdSplitsView>, note: string) {
    const v = await fn();
    setSplits(v);
    setSplitting(null);
    onNote(note);
    api.household.dashboard().then(setDash).catch(() => {});
  }
  async function changeSplitsQuietly(fn: () => Promise<HouseholdSplitsView>, note: string) {
    setError(null);
    try {
      await changeSplits(fn, note);
    } catch (e) {
      setError(errText(e, 'Could not save.'));
    }
  }
  const splitById = new Map((splits?.splits ?? []).map((s) => [s.id, s]));

  const empty =
    dash &&
    dash.budgets.length + dash.bills.length + dash.goals.length + dash.netWorth.holdings.length + dash.netWorth.accounts.length === 0;

  return (
    <>
      <section className="panel" aria-labelledby="hh-shared-title">
        <h3 id="hh-shared-title">Shared with the household</h3>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {!dash && !error ? <p className="muted">Loading…</p> : null}
        {empty ? <p className="muted small">Nothing is shared yet. Choose what to share below.</p> : null}
        {dash && !empty ? (
          <div className="hh-shared">
            {dash.netWorth.holdings.length + dash.netWorth.accounts.length > 0 ? (
              <div className="hh-block">
                <h4>Shared net worth</h4>
                <p className="hh-figure">{formatNzd(dash.netWorth.totalNzd)}</p>
                <ul className="hh-rows">
                  {dash.netWorth.accounts.map((a) => (
                    <li key={`a${a.id}`}>
                      <span>
                        {a.name} <span className="muted small">· {a.owner}</span>
                      </span>
                      <span className="money">{formatNzd(a.balanceNzd)}</span>
                    </li>
                  ))}
                  {dash.netWorth.holdings.map((h) => (
                    <li key={`h${h.id}`}>
                      <span>
                        {h.name} <span className="muted small">· {h.owner}</span>
                      </span>
                      <span className="money">{formatNzd(h.valueNzd)}</span>
                    </li>
                  ))}
                </ul>
                {dash.netWorth.unvalued ? <p className="muted small">{dash.netWorth.unvalued} shared holding(s) have no value right now and are left out.</p> : null}
              </div>
            ) : null}

            {dash.budgets.length ? (
              <div className="hh-block">
                <h4>Shared budgets this month</h4>
                <p className="muted small">Spending counts transactions on shared accounts only.</p>
                <ul className="hh-rows">
                  {dash.budgets.map((b) => (
                    <li key={b.id} className="hh-row-wrap">
                      <span>
                        {b.name} <span className="muted small">· {b.owner}</span>
                      </span>
                      <span className="money">
                        {formatNzd(b.spentNzd)} spent{b.plannedNzd != null ? ` of ${formatNzd(b.plannedNzd)}` : ' · no plan'}
                      </span>
                      {b.remainingNzd != null ? <span className={'small' + (b.remainingNzd < 0 ? ' hh-over' : ' muted')}>{b.remainingNzd < 0 ? `${formatNzd(-b.remainingNzd)} over` : `${formatNzd(b.remainingNzd)} left`}</span> : null}
                      {dash.canEdit ? (
                        <AmountEdit label="This month’s plan" value={b.plannedNzd} onSave={(n) => edit(() => api.household.setBudgetPlan(b.id, n), `${b.name} plan updated.`)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {dash.bills.length ? (
              <div className="hh-block">
                <h4>Bills due in the next month</h4>
                <ul className="hh-rows">
                  {dash.bills.map((b) => (
                    <li key={b.id} className="hh-row-wrap">
                      <span>
                        {b.name} <span className="muted small">· {b.owner} · due {longDate(b.nextDue)}</span>
                      </span>
                      <span className="money">{formatNzd(b.amountNzd)}</span>
                      {dash.canEdit ? <AmountEdit label="Amount" value={b.amountNzd} onSave={(n) => edit(() => api.household.updateBill(b.id, { amountNzd: n }), `${b.name} updated.`)} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {dash.goals.length ? (
              <div className="hh-block">
                <h4>Joint goals</h4>
                <ul className="hh-rows">
                  {dash.goals.map((g) => {
                    const pct = g.targetNzd > 0 ? Math.min(100, (g.currentAmountNzd / g.targetNzd) * 100) : 0;
                    return (
                      <li key={g.id} className="hh-row-wrap">
                        <span>
                          {g.name} <span className="muted small">· {g.owner}</span>
                        </span>
                        <span className="money">
                          {formatNzd(g.currentAmountNzd)} of {formatNzd(g.targetNzd)}
                        </span>
                        <span className="hh-goal-bar" role="img" aria-label={`${Math.round(pct)}% of ${g.name}`}>
                          <span style={{ width: `${pct}%` }} />
                        </span>
                        {dash.canEdit && g.amountSource === 'manual' ? (
                          <AmountEdit label="Amount saved" value={g.currentAmountNzd} onSave={(n) => edit(() => api.household.updateGoal(g.id, { currentAmountNzd: n }), `${g.name} updated.`)} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {dash.transactions.length ? (
              <div className="hh-block">
                <h4>Recent spending on shared accounts</h4>
                <ul className="hh-rows">
                  {dash.transactions.slice(0, 20).map((t) => {
                    const split = t.splitId ? splitById.get(t.splitId) ?? null : null;
                    const canSplit = !!splits?.canEdit && active && t.amountNzd < 0;
                    const name = t.description || 'Transaction';
                    return (
                      <li key={t.id} className="hh-row-wrap">
                        <span>
                          {name}{' '}
                          <span className="muted small">
                            · {t.member} · {longDate(t.date)}
                          </span>
                        </span>
                        <span className="money">{formatNzd(t.amountNzd)}</span>
                        {split ? <SplitLine split={split} /> : null}
                        {canSplit && splitting !== t.id ? (
                          <button type="button" className="link-btn hh-edit hh-split-btn" aria-label={`${split ? 'Change split' : 'Split'}: ${name}`} onClick={() => setSplitting(t.id)}>
                            {split ? 'Change split' : 'Split'}
                          </button>
                        ) : null}
                        {canSplit && splitting === t.id && splits ? (
                          <SplitEditor
                            totalNzd={-t.amountNzd}
                            members={splits.members}
                            existing={split}
                            onCancel={() => setSplitting(null)}
                            onSave={(method, shares) =>
                              changeSplits(
                                () => (split ? api.household.updateSplit(split.id, method, shares) : api.household.createSplit(t.id, method, shares)),
                                `${name} is split.`,
                              )
                            }
                            onRemove={split ? () => changeSplitsQuietly(() => api.household.removeSplit(split.id), `${name} is no longer split.`) : null}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {!dash.canEdit ? <p className="muted small">You can see what’s shared, but only adults can change it.</p> : null}
          </div>
        ) : null}
      </section>

      {splits && (splits.splits.length + splits.settlements.length > 0 || dash?.transactions.some((t) => t.amountNzd < 0)) ? (
        <SettleUp
          view={splits}
          onRecord={(p, note) => changeSplitsQuietly(() => api.household.recordSettlement(p), note)}
          onRemove={(id) => changeSplitsQuietly(() => api.household.removeSettlement(id), 'Payment removed.')}
        />
      ) : null}

      <section className="panel" aria-labelledby="hh-mine-title">
        <h3 id="hh-mine-title">What you share</h3>
        <p className="muted small">Everything is private unless you tick it here. Others in the household can see what you share; adults can change shared budgets, bills and goals.</p>
        {mine ? (
          <div className="hh-share-groups">
            {(Object.keys(KIND_TITLES) as HouseholdShareKind[]).map((kind) =>
              mine[kind].length ? (
                <fieldset key={kind} className="hh-share-group">
                  <legend>{KIND_TITLES[kind]}</legend>
                  {mine[kind].map((item) => (
                    <label key={item.id} className="hh-share-item">
                      <input
                        type="checkbox"
                        checked={item.shared}
                        disabled={!active && !item.shared}
                        onChange={(e) =>
                          void api.household
                            .setShared(kind, item.id, e.target.checked)
                            .then((m) => {
                              setMine(m);
                              onNote(e.target.checked ? `${item.name} is shared.` : `${item.name} is private again.`);
                              api.household.dashboard().then(setDash).catch(() => {});
                            })
                            .catch((err: unknown) => setError(errText(err, 'Could not change sharing.')))
                        }
                      />
                      <span>
                        {item.name}
                        <span className="muted small"> · {item.detail}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null,
            )}
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </section>
    </>
  );
}
