/**
 * KiwiSaver — Sharesies via Akahu + bank-held manual/CSV.
 * Honest labels (Akahu vs Manual). Never scrape. Never invent balances.
 *
 * Phase 1 is presentation only: a short header, Sync now for Akahu, and one
 * balance block. The full balance card is Phase 2. The history chart and
 * holdings stay as they are until later phases.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, formatNzd, formatAuckland } from '../api/client';
import { akahuStatus, akahuSync } from '../api/akahuClient';
import {
  formatPortfolioSyncMsg,
  maybeAutoSyncPortfolio,
} from '../lib/akahuTxnAutoSync';
import { showQuietToast } from '../lib/quietToast';
import {
  beginPageRead,
  commitPageRead,
  invalidateAfterExternalSync,
  invalidateAfterKiwiSaverEdit,
  portfolioSyncChanged,
  readPageCache,
} from '../lib/pageDataCache';
import { AssetLineChart, type LineSeries } from '../components/AssetLineChart';
import { InfoTip } from '../components/InfoTip';
import type {
  KiwiSaverAccount,
  KiwiSaverFundAllocation,
  KiwiSaverHistoryResponse,
} from '../types';
import { HoldingIcon } from '../components/HoldingIcon';
import {
  KIWISAVER_READONLY_NOTE,
  kiwiSaverHeaderParts,
  kiwiSaverSchemeLabel,
  kiwiSaverSyncNote,
  showKiwiSaverSchemePicker,
  showKiwiSaverSyncButton,
} from './kiwisaverView';

function formatPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fundTicker(f: KiwiSaverFundAllocation): string {
  if (f.symbol) {
    const parts = f.symbol.split('.');
    return parts[parts.length - 1] || f.symbol;
  }
  return (f.fundName || '?').slice(0, 4).toUpperCase();
}

function isAkahuAccount(a: KiwiSaverAccount): boolean {
  return a.dataSource === 'akahu' || !!a.externalId?.startsWith('akahu:');
}

function parseFundMixLines(raw: string): KiwiSaverFundAllocation[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: KiwiSaverFundAllocation[] = [];
  for (const line of lines) {
    const parts = line.split(/[,|]/).map((p) => p.trim());
    if (!parts[0]) continue;
    const allocationPct =
      parts[1] !== undefined && parts[1] !== '' ? Number(parts[1]) : null;
    const balanceNzd =
      parts[2] !== undefined && parts[2] !== '' ? Number(parts[2]) : null;
    out.push({
      fundName: parts[0],
      allocationPct: allocationPct != null && Number.isFinite(allocationPct) ? allocationPct : null,
      balanceNzd: balanceNzd != null && Number.isFinite(balanceNzd) ? balanceNzd : null,
    });
  }
  return out;
}

function FundCard({ fund }: { fund: KiwiSaverFundAllocation }) {
  const value = fund.balanceNzd;
  const ret = fund.returnsNzd;
  const cost =
    value != null && ret != null && Number.isFinite(value) && Number.isFinite(ret)
      ? value - ret
      : null;
  const pct =
    cost != null && cost > 0 && ret != null ? (ret / cost) * 100 : null;

  return (
    <article className="holding-card">
      <header className="holding-card-head">
        <HoldingIcon
          ticker={fundTicker(fund)}
          assetClass="stock"
          iconUrl={fund.logo}
        />
        <div className="holding-card-titles">
          <h4 className="holding-card-name">{fund.fundName}</h4>
          <span className="holding-card-ticker muted small">
            {fund.symbol ?? '—'}
            {fund.allocationPct != null ? ` · ${fund.allocationPct}%` : ''}
          </span>
        </div>
      </header>
      <div className="holding-card-amount">
        {value != null ? formatNzd(value) : '—'}
      </div>
      <dl className="holding-card-stats">
        <div>
          <dt>Cost</dt>
          <dd>{cost != null ? formatNzd(cost) : '—'}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{value != null ? formatNzd(value) : '—'}</dd>
        </div>
        <div>
          <dt>Return</dt>
          <dd
            className={
              pct == null ? undefined : pct >= 0 ? 'return-pos' : 'return-neg'
            }
          >
            {pct == null ? '—' : formatPct(pct)}
          </dd>
        </div>
        <div>
          <dt>Earnings</dt>
          <dd
            className={
              ret == null ? undefined : ret >= 0 ? 'return-pos' : 'return-neg'
            }
          >
            {ret == null ? '—' : formatNzd(ret)}
          </dd>
        </div>
      </dl>
      {fund.shares != null && (
        <p className="muted small holding-card-meta">
          {fund.shares.toLocaleString('en-NZ', { maximumFractionDigits: 4 })} units
        </p>
      )}
    </article>
  );
}

type ManualForm = {
  id: string | null;
  provider: string;
  schemeName: string;
  name: string;
  balanceNzd: string;
  amountInvestedNzd: string;
  returnsNzd: string;
  observedAt: string;
  notes: string;
  fundMixText: string;
};

const emptyForm = (): ManualForm => ({
  id: null,
  provider: '',
  schemeName: '',
  name: '',
  balanceNzd: '',
  amountInvestedNzd: '',
  returnsNzd: '',
  observedAt: new Date().toISOString().slice(0, 10),
  notes: '',
  fundMixText: '',
});

type KiwiSaverBundle = {
  accounts: KiwiSaverAccount[];
  selectedId: string | null;
  history: KiwiSaverHistoryResponse | null;
  akahuConfigured: boolean | null;
  akahuConnected: boolean | null;
};

const KIWISAVER_KEY = 'kiwisaver';

export function KiwiSaver() {
  const initialKs = readPageCache<KiwiSaverBundle>(KIWISAVER_KEY);
  const [accounts, setAccounts] = useState<KiwiSaverAccount[]>(initialKs?.accounts ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialKs?.selectedId ?? null);
  const [history, setHistory] = useState<KiwiSaverHistoryResponse | null>(initialKs?.history ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [akahuConfigured, setAkahuConfigured] = useState<boolean | null>(initialKs?.akahuConfigured ?? null);
  const [akahuConnected, setAkahuConnected] = useState<boolean | null>(initialKs?.akahuConnected ?? null);
  const [loading, setLoading] = useState(initialKs == null);
  const [syncing, setSyncing] = useState(false);
  const akahuRef = useRef(initialKs?.akahuConfigured ?? null);
  const akahuConnectedRef = useRef(initialKs?.akahuConnected ?? null);
  const accountsRef = useRef(accounts);
  useEffect(() => {
    akahuRef.current = akahuConfigured;
  }, [akahuConfigured]);
  useEffect(() => {
    akahuConnectedRef.current = akahuConnected;
  }, [akahuConnected]);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ManualForm>(emptyForm);
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  const load = useCallback(async (preferAccountId?: string | null) => {
    const stamp = beginPageRead(KIWISAVER_KEY);
    const list = (await api.kiwisaver.list()) as KiwiSaverAccount[];
    const pick =
      (preferAccountId && list.find((a) => a.id === preferAccountId)?.id) ||
      selectedId && list.find((a) => a.id === selectedId)?.id ||
      list.find((a) => isAkahuAccount(a))?.id ||
      list[0]?.id ||
      null;
    const hist = (await api.kiwisaver.history(pick ?? undefined)) as KiwiSaverHistoryResponse;
    const bundle: KiwiSaverBundle = {
      accounts: list,
      selectedId: pick,
      history: hist,
      akahuConfigured: akahuRef.current,
      akahuConnected: akahuConnectedRef.current,
    };
    if (!commitPageRead(stamp, bundle)) return;
    setAccounts(list);
    setSelectedId(pick);
    setHistory(hist);
  }, [selectedId]);

  const reloadAfterEdit = useCallback(async (preferAccountId?: string | null) => {
    invalidateAfterKiwiSaverEdit();
    await load(preferAccountId);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (readPageCache<KiwiSaverBundle>(KIWISAVER_KEY) == null) setLoading(true);
      setError(null);
      try {
        const st = await akahuStatus().catch(() => null);
        const configured = st?.configured ?? false;
        const connected = st?.connected === true;
        akahuRef.current = configured;
        akahuConnectedRef.current = connected;
        if (!cancelled) {
          setAkahuConfigured(configured);
          setAkahuConnected(connected);
        }

        try {
          const outcome = await maybeAutoSyncPortfolio();
          if (!cancelled && outcome.ran && outcome.result.ok && portfolioSyncChanged(outcome.result)) {
            invalidateAfterExternalSync();
          }
          if (!cancelled && outcome.ran) {
            if (outcome.result.ok) {
              setMsg(formatPortfolioSyncMsg(outcome.result));
            } else {
              showQuietToast(outcome.result.error ?? 'Akahu sync paused — showing last data.', {
                kind: 'warn',
              });
            }
          }
        } catch {
          if (!cancelled) {
            showQuietToast('Akahu sync paused — showing last KiwiSaver data.', { kind: 'warn' });
          }
        }

        if (!cancelled) await load(null);
      } catch (e) {
        if (!cancelled) {
          // Prefer quiet toast when we already have accounts; avoid blanking the page.
          if (accountsRef.current.length > 0) {
            showQuietToast('Could not refresh KiwiSaver — showing last data.', { kind: 'warn' });
          } else {
            setError((e as Error).message);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  async function selectAccount(id: string) {
    setSelectedId(id);
    const stamp = beginPageRead(KIWISAVER_KEY);
    try {
      const hist = (await api.kiwisaver.history(id)) as KiwiSaverHistoryResponse;
      const bundle: KiwiSaverBundle = {
        accounts,
        selectedId: id,
        history: hist,
        akahuConfigured: akahuRef.current,
        akahuConnected: akahuConnectedRef.current,
      };
      if (!commitPageRead(stamp, bundle)) return;
      setHistory(hist);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const hasAkahuAccount = accounts.some(isAkahuAccount);
  const showSync = showKiwiSaverSyncButton({
    hasAkahuScheme: hasAkahuAccount,
    akahuConnected: akahuConnected === true,
  });
  const showManualEntry = !loading && !hasAkahuAccount;

  async function onSyncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await akahuSync();
      if (result.ok && portfolioSyncChanged(result)) invalidateAfterExternalSync();
      if (result.ok) {
        setMsg(formatPortfolioSyncMsg(result));
        await load(selectedId);
      } else {
        showQuietToast(result.error ?? 'Akahu sync paused — showing last data.', { kind: 'warn' });
      }
    } catch {
      showQuietToast('Akahu sync paused — showing last KiwiSaver data.', { kind: 'warn' });
    } finally {
      setSyncing(false);
    }
  }
  const bankAccounts = accounts.filter((a) => !isAkahuAccount(a) && a.provider !== 'sharesies');
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  function startEdit(a: KiwiSaverAccount) {
    setForm({
      id: a.id,
      provider: a.provider,
      schemeName: a.schemeName ?? '',
      name: a.name,
      balanceNzd: String(a.balanceNzd),
      amountInvestedNzd: a.amountInvestedNzd != null ? String(a.amountInvestedNzd) : '',
      returnsNzd: a.returnsNzd != null ? String(a.returnsNzd) : '',
      observedAt: (a.observedAt ?? new Date().toISOString()).slice(0, 10),
      notes: a.notes ?? '',
      fundMixText: (a.fundMix ?? [])
        .map((f) =>
          [f.fundName, f.allocationPct ?? '', f.balanceNzd ?? ''].join(','),
        )
        .join('\n'),
    });
  }

  async function onSaveManual(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const provider = form.provider.trim();
      if (!provider) throw new Error('Provider / bank name is required');
      if (provider.toLowerCase() === 'sharesies') {
        throw new Error('Use Akahu Refresh for Sharesies — not the bank-held form.');
      }
      const balanceNzd = Number(form.balanceNzd);
      if (!Number.isFinite(balanceNzd) || balanceNzd < 0) {
        throw new Error('Balance NZD must be a non-negative number');
      }
      const body: Record<string, unknown> = {
        provider,
        schemeName: form.schemeName.trim() || null,
        name:
          form.name.trim() ||
          `${provider}${form.schemeName.trim() ? ` ${form.schemeName.trim()}` : ''} KiwiSaver`,
        balanceNzd,
        observedAt: form.observedAt
          ? `${form.observedAt}T12:00:00.000Z`
          : new Date().toISOString(),
        notes:
          form.notes.trim() ||
          'Manual bank-held KiwiSaver (IRD/Akahu bank KS not available).',
        connectionStatus: 'manual',
        fundMix: parseFundMixLines(form.fundMixText),
      };
      if (form.returnsNzd.trim() !== '') {
        body.returnsNzd = Number(form.returnsNzd);
      }
      if (form.amountInvestedNzd.trim() !== '') {
        body.amountInvestedNzd = Number(form.amountInvestedNzd);
      }

      if (form.id) {
        await api.kiwisaver.update(form.id, body);
        setMsg(`Updated manual bank KiwiSaver: ${body.name}`);
        await reloadAfterEdit(form.id);
      } else {
        const created = (await api.kiwisaver.create(body)) as KiwiSaverAccount;
        setMsg(`Added manual bank KiwiSaver: ${created.name}`);
        await reloadAfterEdit(created.id);
      }
      setForm(emptyForm());
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete manual KiwiSaver “${name}”? This cannot be undone.`)) return;
    setMsg(null);
    try {
      await api.kiwisaver.remove(id);
      setMsg(`Deleted ${name}`);
      if (form.id === id) setForm(emptyForm());
      await reloadAfterEdit(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function onSelectCsv(file: File | null) {
    if (!file) {
      setCsvText('');
      setCsvFileName(null);
      return;
    }
    setCsvFileName(file.name);
    setCsvText(await file.text());
  }

  async function onImportBankCsv(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      if (!csvText.trim()) throw new Error('Choose a CSV file first');
      const r = await api.kiwisaver.importBankCsv(csvText, csvFileName ?? undefined);
      if (!r.ok) {
        setMsg(r.message + (r.errors?.[0] ? ` (${r.errors[0].message})` : ''));
      } else {
        setMsg(
          r.message +
            (r.errors?.length ? ` · ${r.errors.length} row warning(s)` : ''),
        );
        setCsvText('');
        setCsvFileName(null);
        await reloadAfterEdit(r.accountIds?.[0] ?? null);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const chartSeries: LineSeries[] = useMemo(() => {
    const points = (history?.points ?? []).map((p) => ({
      at: p.at,
      value: p.balanceNzd,
    }));
    if (!points.length) return [];
    return [
      {
        key: 'kiwisaver',
        label: selected ? selected.name : 'KiwiSaver',
        colour: 'var(--ks-chart, #1b4332)',
        points,
      },
    ];
  }, [history, selected]);

  const headerParts = kiwiSaverHeaderParts(
    selected
      ? {
          name: selected.name,
          schemeName: selected.schemeName,
          provider: selected.provider,
          observedAt: selected.observedAt,
          pir: selected.pir,
        }
      : null,
    formatAuckland,
  );
  const hasSyncedPart = headerParts.some((part) => part.kind === 'synced');
  const syncTip = (
    <InfoTip label="About KiwiSaver sync">
      {KIWISAVER_READONLY_NOTE} {kiwiSaverSyncNote({ hasAkahuAccount, akahuConfigured })}
    </InfoTip>
  );

  if (error) {
    return (
      <div className="panel warn kiwisaver-page">
        <h2 className="page-title">KiwiSaver</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="stack kiwisaver-page">
      <header className="ks-header" aria-labelledby="kiwisaver-title" aria-busy={loading || syncing}>
        <div className="ks-header-main">
          <h2 id="kiwisaver-title" className="page-title">KiwiSaver</h2>
          <p className="muted small ks-header-line" aria-live="polite">
            {headerParts.length === 0 && loading ? 'Loading…' : null}
            {headerParts.map((part, index) => (
              <span key={part.kind}>
                {index > 0 ? ' · ' : null}
                {part.text}
                {part.kind === 'synced' ? syncTip : null}
              </span>
            ))}
            {!hasSyncedPart ? syncTip : null}
          </p>
        </div>
        {showSync ? (
          <div className="ks-header-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => void onSyncNow()}
              disabled={syncing}
              aria-busy={syncing}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        ) : null}
      </header>

      {!loading && accounts.length === 0 ? (
        <section className="panel">
          <p className="muted">
            No KiwiSaver yet — refresh Sharesies via Akahu, or add a bank-held scheme below.
          </p>
        </section>
      ) : null}

      {showKiwiSaverSchemePicker(accounts.length) ? (
        <section className="panel" aria-labelledby="ks-schemes-heading">
          <h3 id="ks-schemes-heading">Schemes</h3>
          <div className="ks-schemes" role="group" aria-label="KiwiSaver schemes">
            {accounts.map((a) => {
              const isSelected = selected?.id === a.id;
              const label = kiwiSaverSchemeLabel({ name: a.name, schemeName: a.schemeName }) ?? a.name;
              return (
                <div key={a.id} className="ks-scheme">
                  <button
                    type="button"
                    className="ks-scheme-pick"
                    aria-pressed={isSelected}
                    aria-label={`${label}${a.provider ? `, ${a.provider}` : ''}${isSelected ? ', selected' : ''}`}
                    onClick={() => void selectAccount(a.id)}
                  >
                    <span className="ks-scheme-name">{label}</span>
                    <span className="muted small">
                      {a.provider}
                      {a.dataSourceLabel ? ` · ${a.dataSourceLabel}` : ''}
                    </span>
                    {isSelected ? <span className="ks-scheme-selected">Selected</span> : null}
                  </button>
                  {!isAkahuAccount(a) ? (
                    <>
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label={`Edit ${a.name}`}
                        onClick={() => startEdit(a)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        aria-label={`Delete ${a.name}`}
                        onClick={() => void onDelete(a.id, a.name)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/*
        Phase 2 balance card placeholder.
        The full balance card lands in Phase 2. Until then this is the only
        place balance, "You've put in", and returns ($ and %) appear — the
        old Detail section repeated the scheme cards, so it is gone. Residual
        and notes stay here so that information is not dropped.
      */}
      {selected ? (
        <section className="panel ks-balance" aria-label="Balance">
          <p className="hero-value sm">{formatNzd(selected.balanceNzd)}</p>
          {selected.dataSourceLabel ? (
            <p className="muted small ks-balance-source">{selected.dataSourceLabel}</p>
          ) : null}
          <div className="ks-metrics">
            <div className="ks-metric">
              <span className="ks-metric-label">You've put in</span>
              <span className="ks-metric-value">
                {selected.amountInvestedNzd != null
                  ? formatNzd(selected.amountInvestedNzd)
                  : '—'}
              </span>
              <span className="muted small">
                {selected.amountInvestedNzd != null
                  ? selected.dataSource === 'akahu'
                    ? 'balance − Akahu returns'
                    : 'balance − returns (or entered invested)'
                  : 'Unavailable (need balance + returns/invested)'}
              </span>
            </div>
            <div className="ks-metric">
              <span className="ks-metric-label">Returns</span>
              <span
                className={
                  'ks-metric-value' +
                  (selected.returnsNzd == null
                    ? ''
                    : selected.returnsNzd >= 0
                      ? ' return-pos'
                      : ' return-neg')
                }
              >
                {selected.returnsNzd == null
                  ? '—'
                  : `${selected.returnsNzd > 0 ? '+' : ''}${formatNzd(selected.returnsNzd)}`}
                {selected.returnPct != null ? ` (${formatPct(selected.returnPct)})` : ''}
              </span>
              <span className="muted small">
                {selected.returnsNzd != null
                  ? selected.dataSource === 'akahu'
                    ? 'Akahu meta.breakdown.returns'
                    : 'Manual / CSV'
                  : 'Unavailable'}
              </span>
            </div>
          </div>
          {selected.residualNzd != null && (
            <p className="banner" style={{ marginTop: '0.75rem' }}>
              Residual vs fund mix: {formatNzd(selected.residualNzd)}
              {selected.residualNote ? ` — ${selected.residualNote}` : ''}
            </p>
          )}
          {selected.notes && <p className="muted small">{selected.notes}</p>}
          {accounts.length === 1 && !isAkahuAccount(selected) ? (
            <div className="row gap ks-balance-actions">
              <button
                type="button"
                className="btn ghost"
                aria-label={`Edit ${selected.name}`}
                onClick={() => startEdit(selected)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn ghost"
                aria-label={`Delete ${selected.name}`}
                onClick={() => void onDelete(selected.id, selected.name)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h3>Balance history</h3>
        <p className="muted small">
          {selected
            ? `Recorded balances for ${selected.name}.`
            : 'Recorded balances for the selected scheme.'}{' '}
          One point per sync or save.
        </p>
        {chartSeries.length > 0 ? (
          <>
            <AssetLineChart
              series={chartSeries}
              title={selected ? `${selected.name} (NZD)` : 'KiwiSaver balance (NZD)'}
              emptyHint="No history points yet"
              height={(history?.points?.length ?? 0) <= 3 ? 180 : 220}
              resolution="day"
              fullWidth
            />
            {(history?.points?.length ?? 0) < 2 && (
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                Only one point so far — more appear after the next sync or save.
              </p>
            )}
          </>
        ) : (
          <p className="muted">{history?.message ?? 'History unavailable'}</p>
        )}
      </section>

      <section className="panel">
        <h3>Holdings / funds</h3>
        {selected?.fundMix?.length ? (
          <div className="holding-cards">
            {selected.fundMix.map((f, i) => (
              <FundCard key={f.fundId ?? f.symbol ?? `${f.fundName}-${i}`} fund={f} />
            ))}
          </div>
        ) : (
          <p className="muted">
            {selected
              ? selected.dataSource === 'akahu'
                ? 'No fund mix from Akahu yet — refresh to pull portfolio[].'
                : 'No fund mix on this manual scheme — add via form or CSV fund columns.'
              : 'Select a scheme to see fund mix.'}
          </p>
        )}
      </section>

      {showManualEntry ? (
        <section className="panel">
          <h3>Add / update bank-held KiwiSaver (manual)</h3>
          <p className="muted small">
            For schemes at ANZ, Westpac, ASB, BNZ, Kiwibank, etc. Labels as <strong>Manual</strong> —
            not Akahu. Optional invested or returns (if you enter invested only, returns = balance −
            invested). History point recorded on save.
            {bankAccounts.length > 0
              ? ` ${bankAccounts.length} bank-held scheme(s) on file.`
              : ''}
          </p>
          <form className="form-grid" onSubmit={(e) => void onSaveManual(e)}>
          <h4 className="span-2" style={{ margin: 0 }}>
            {form.id ? 'Update scheme' : 'New scheme'}
          </h4>
          <label>
            Provider / bank *
            <input
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              required
              placeholder="e.g. ANZ, Westpac, Kiwibank"
            />
          </label>
          <label>
            Scheme name
            <input
              value={form.schemeName}
              onChange={(e) => setForm({ ...form, schemeName: e.target.value })}
              placeholder="e.g. Growth, Balanced"
            />
          </label>
          <label>
            Display name
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Optional — defaults from provider + scheme"
            />
          </label>
          <label>
            Balance (NZD) *
            <input
              type="number"
              step="any"
              min={0}
              value={form.balanceNzd}
              onChange={(e) => setForm({ ...form, balanceNzd: e.target.value })}
              required
              placeholder="12500.50"
            />
          </label>
          <label>
            Amount invested (NZD, optional)
            <input
              type="number"
              step="any"
              min={0}
              value={form.amountInvestedNzd}
              onChange={(e) => setForm({ ...form, amountInvestedNzd: e.target.value })}
              placeholder="unknown"
            />
          </label>
          <label>
            Returns (NZD, optional)
            <input
              type="number"
              step="any"
              value={form.returnsNzd}
              onChange={(e) => setForm({ ...form, returnsNzd: e.target.value })}
              placeholder="unknown"
            />
          </label>
          <label>
            As of (date)
            <input
              type="date"
              value={form.observedAt}
              onChange={(e) => setForm({ ...form, observedAt: e.target.value })}
            />
          </label>
          <label className="span-2">
            Notes
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Statement Oct 2026"
            />
          </label>
          <label className="span-2">
            Fund mix (optional — one per line: fundName, allocationPct, balanceNzd)
            <textarea
              rows={3}
              value={form.fundMixText}
              onChange={(e) => setForm({ ...form, fundMixText: e.target.value })}
              placeholder={'Growth Fund, 60, 7500\nCash, 40, 5000'}
            />
          </label>
          <div className="row gap span-2">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : form.id ? 'Update scheme' : 'Add scheme'}
            </button>
            {form.id && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setForm(emptyForm())}
                disabled={saving}
              >
                Cancel edit
              </button>
            )}
          </div>
          </form>
        </section>
      ) : null}

      {showManualEntry && (
        <section className="panel">
          <h3>Import bank-held CSV</h3>
        <p className="muted small">
          Upserts by <code>provider</code> + <code>scheme_name</code>. Does not touch Akahu
          Sharesies rows. Labelled <strong>Manual (CSV)</strong>.
        </p>
        <p className="muted small">
          Columns:{' '}
          <code>
            provider, scheme_name, balance_nzd, amount_invested_nzd, returns_nzd, observed_at,
            notes, fund_name, fund_allocation_pct, fund_balance_nzd
          </code>
          . Required: <code>balance_nzd</code> plus <code>provider</code> or{' '}
          <code>scheme_name</code> or <code>name</code>. Multiple fund rows for the same scheme
          are merged. See <code>docs/IMPORT_FORMATS.md</code>.
        </p>
        <form className="form-grid" onSubmit={(e) => void onImportBankCsv(e)}>
          <label className="span-2">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onSelectCsv(e.target.files?.[0] ?? null)}
            />
            {csvFileName && <span className="muted small">Selected: {csvFileName}</span>}
          </label>
          <button
            type="submit"
            className="btn primary"
            disabled={saving || !csvText.trim()}
          >
            {saving ? 'Importing…' : 'Import CSV'}
          </button>
          </form>
        </section>
      )}

      {msg && <p className="banner">{msg}</p>}
    </div>
  );
}
