/**
 * Spending & budgets — transactions from 1 Oct 2026 (Pacific/Auckland).
 * Bank: Akahu sync. Cards not on Akahu (Nexo, GoMining, etc.): first-class manual entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, formatNzd } from '../api/client';
import {
  maybeAutoSyncBankTransactions,
  maybeAutoSyncPortfolio,
} from '../lib/akahuTxnAutoSync';
import { showQuietToast } from '../lib/quietToast';
import type { DebtCreditorKind, DebtPerson, DebtRepayment, IncomeKind, IncomeMonthSummary, IncomeRecord, Transaction, TransactionSource } from '../types';
import {
  CategorySpendChart,
  aggregateCategorySpend,
} from '../components/CategorySpendChart';
import {
  DEFAULT_MONTH,
  SPENDING_FLOOR,
  addMonths,
  budgetOverlapsMonth,
  formatMonthLabel,
  formatMonthLong,
  isBeforeFloorMonth,
  monthEnd,
  monthStart,
  todayAucklandYmd,
  yearMonthKey,
  type YearMonth,
} from '../lib/period';
import {
  isCharityCategoryId,
  linkCharityDonationToPaye,
  unlinkCharityDonationFromPaye,
} from '../lib/charityPayeLink';
import { DividendTracker } from '../components/DividendTracker';
import {
  categoryTypeShortTag,
  categoryTypeCountsAsSpend,
  categoryTypeIsIncome,
  normalizeCategoryType,
  type CategoryType,
} from '../lib/categoryTypes';

type Category = {
  id: string;
  name: string;
  type?: CategoryType;
  isIncome: boolean;
  sortOrder: number;
};

type Budget = {
  id: string;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  amountNzd: number;
  yearMonth?: string | null;
};

type CashAccount = {
  id: string;
  name: string;
  institution: string;
  accountType: string;
  balance: number;
  currency?: string;
  notes?: string | null;
};

/** Match server liquid-cash filter (net-worth Cash / Dashboard). */
const LIQUID_CASH_TYPES = new Set(['cheque', 'savings', 'wallet', 'term_deposit']);
const LIABILITY_CASH_TYPES = new Set(['credit', 'loan']);

function isLiquidCashAccount(a: CashAccount): boolean {
  const t = (a.accountType ?? '').toLowerCase();
  if (LIABILITY_CASH_TYPES.has(t)) return false;
  if (LIQUID_CASH_TYPES.has(t)) return true;
  if (t === 'other' && a.notes && /\bWALLET\b/i.test(a.notes)) return true;
  return false;
}

/** Presets for cards that may not appear in Akahu (crypto cards, etc.). */
const CARD_PRESETS = [
  'Nexo card',
  'GoMining card',
  'Sharesies Spend',
  'Debit card',
  'Kiwibank Debit',
  'Credit card',
  'Other',
] as const;


function debtKindLabel(kind: DebtCreditorKind | string | undefined): string {
  return kind === 'corporation' ? 'Corporation' : 'Person';
}

function sourceLabel(s: string | undefined): string {
  switch (s) {
    case 'akahu':
      return 'Bank (Akahu)';
    case 'bank':
      return 'Bank';
    case 'google_wallet':
      return 'Wallet';
    case 'csv':
      return 'CSV';
    case 'manual':
    default:
      return 'Manual';
  }
}

/** True when charged account looks like a real bank (Kiwibank / Sharesies Spend / cheque / etc.). */
function isBankishAccount(a: CashAccount | undefined): boolean {
  if (!a) return false;
  const hay = `${a.name} ${a.institution} ${a.accountType}`.toLowerCase();
  // Crypto cards / Hatch-Sharesies investment wallets are manual; Spend card is bankish.
  if (/nexo|gomining|crypto/.test(hay)) return false;
  if (/wallet/.test(hay) && !/spend/.test(hay)) return false;
  return /kiwi|bank|cheque|checking|savings|debit|credit|everyday|main|transaction|spend|sharesies/.test(hay)
    || a.accountType === 'transaction'
    || a.accountType === 'cheque'
    || a.accountType === 'savings'
    || a.accountType === 'credit';
}

function incomeCategoryIdFromList(
  categories: Array<{ id: string; slug?: string }>,
  kind: 'cash' | 'crypto',
): string {
  const slug = kind === 'crypto' ? 'cat-income-mining' : 'cat-income';
  const hit = categories.find((c) => (c.slug ?? c.id) === slug || c.id === slug || c.id.startsWith(`${slug}__`));
  return hit?.id ?? slug;
}

export function Spending() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  /** Txns from selected month start through today (Auckland) — for start-of-month cash back-calc. */
  const [flowTxns, setFlowTxns] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTxnModal, setShowTxnModal] = useState(false);

  // Income
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [incomeSummary, setIncomeSummary] = useState<IncomeMonthSummary | null>(null);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [incDate, setIncDate] = useState(todayAucklandYmd);
  const [incAmount, setIncAmount] = useState('');
  const [incKind, setIncKind] = useState<IncomeKind>('cash');
  const [incDesc, setIncDesc] = useState('');
  const [incAccountId, setIncAccountId] = useState('');
  const [incCryptoAsset, setIncCryptoAsset] = useState('');
  const [incCryptoAmount, setIncCryptoAmount] = useState('');
  const [incNotes, setIncNotes] = useState('');
  const [incCategoryId, setIncCategoryId] = useState('cat-income');
  const [planIncomeCategoryId, setPlanIncomeCategoryId] = useState('');
  const [planIncomeAmount, setPlanIncomeAmount] = useState('');
  const [planIncomeSaving, setPlanIncomeSaving] = useState(false);
  const [editingIncomePlanId, setEditingIncomePlanId] = useState<string | null>(null);
  const [editIncomePlanAmount, setEditIncomePlanAmount] = useState('');

  // Manual / Wallet form state
  const [formSource, setFormSource] = useState<'bank' | 'manual' | 'google_wallet'>('bank');
  const [formDate, setFormDate] = useState(todayAucklandYmd);
  const [formDesc, setFormDesc] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formKind, setFormKind] = useState<'debit' | 'credit'>('debit');
  const [formAccountId, setFormAccountId] = useState('');
  const [formCardPreset, setFormCardPreset] = useState<string>('Nexo card');
  const [formCardCustom, setFormCardCustom] = useState('');
  const [importAccountId, setImportAccountId] = useState('');
  const [importing, setImporting] = useState(false);
  const [categorySavingId, setCategorySavingId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<YearMonth>(DEFAULT_MONTH);
  /** Charity receipt / PAYE IR526 popup */
  const [charityModalTxn, setCharityModalTxn] = useState<Transaction | null>(null);
  const [charityReceiptDataUrl, setCharityReceiptDataUrl] = useState<string | null>(null);
  const [charityReceiptName, setCharityReceiptName] = useState<string | null>(null);
  const [charityLinkPaye, setCharityLinkPaye] = useState(true);
  const [charitySaving, setCharitySaving] = useState(false);
  /** Explicit Use BTC / Pays with BTC — off by default; never auto from category. */
  const [formUseBtc, setFormUseBtc] = useState(false);
  const [formBtcHoldingId, setFormBtcHoldingId] = useState('');
  const [btcHoldings, setBtcHoldings] = useState<
    Array<{ id: string; name: string; asset: string; amount: number }>
  >([]);
  const [btcPrimaryId, setBtcPrimaryId] = useState<string | null>(null);

  // Debt / I owe
  const [debtPeople, setDebtPeople] = useState<DebtPerson[]>([]);
  const [debtRepayments, setDebtRepayments] = useState<DebtRepayment[]>([]);
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [personName, setPersonName] = useState('');
  const [personKind, setPersonKind] = useState<DebtCreditorKind>('person');
  const [personNotes, setPersonNotes] = useState('');
  const [personOutstanding, setPersonOutstanding] = useState('');
  const [repayPersonId, setRepayPersonId] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayDate, setRepayDate] = useState(todayAucklandYmd);
  const [repayNotes, setRepayNotes] = useState('');
  const [repayTxnId, setRepayTxnId] = useState('');
  const [showRepayForm, setShowRepayForm] = useState(false);
  const [historyPersonId, setHistoryPersonId] = useState<string | null>(null);
  const [debtSaving, setDebtSaving] = useState(false);

  // Budget plan (monthly planned spend per category)
  const [planCategoryId, setPlanCategoryId] = useState('');
  const [planAmount, setPlanAmount] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPlanAmount, setEditPlanAmount] = useState('');

  const periodFrom = monthStart(selectedMonth);
  const periodTo = monthEnd(selectedMonth);
  const monthLabel = formatMonthLabel(selectedMonth);
  const monthLong = formatMonthLong(selectedMonth);
  const monthKey = yearMonthKey(selectedMonth);
  const canGoPrev = !isBeforeFloorMonth(addMonths(selectedMonth, -1));

  function openAddTransactionForm() {
    setShowTxnModal(true);
  }

  function closeTxnModal() {
    setShowTxnModal(false);
  }

  function openAddIncomeForm() {
    setIncDate(todayAucklandYmd());
    setIncKind('cash');
    setIncAmount('');
    setIncDesc('');
    setIncAccountId(accounts[0]?.id ?? '');
    setIncCryptoAsset('');
    setIncCryptoAmount('');
    setIncNotes('');
    setIncCategoryId(incomeCategoryIdFromList(categories, 'cash'));
    setShowIncomeModal(true);
  }

  function closeIncomeModal() {
    setShowIncomeModal(false);
  }

  const resolvedCardName = useMemo(() => {
    if (formCardPreset === 'Other') return formCardCustom.trim();
    return formCardPreset.trim();
  }, [formCardPreset, formCardCustom]);

  const formAccountSeeded = useRef(false);

  const load = useCallback(async () => {
    const todayYmd = todayAucklandYmd();
    const [cats, buds, list, accts, btc, people, repayments, incomeList, incomeSum] = await Promise.all([
      api.budgets.categories(),
      api.budgets.list(),
      api.accounts.transactions(periodFrom, periodTo),
      api.accounts.list(),
      api.accounts.btcHoldings().catch(() => ({ holdings: [], primaryId: null })),
      api.debts.people().catch(() => []),
      api.debts.repayments({ from: '2026-10-01' }).catch(() => []),
      api.income.list({ month: yearMonthKey(selectedMonth) }).catch(() => []),
      api.income.summary(yearMonthKey(selectedMonth)).catch(() => null),
    ]);
    setCategories(cats as Category[]);
    setBudgets(buds as Budget[]);
    setTxns(list as Transaction[]);
    setDebtPeople(people as DebtPerson[]);
    setDebtRepayments(repayments as DebtRepayment[]);
    setIncomeRecords(incomeList as IncomeRecord[]);
    setIncomeSummary(incomeSum as IncomeMonthSummary | null);
    const cash = (accts as CashAccount[]).slice().sort((a, b) => a.name.localeCompare(b.name));
    setAccounts(cash);
    // Start-of-month cash = current liquid − net liquid flows from month start through today.
    // Never invent: future months (periodFrom > today) leave flowTxns empty → UI shows em dash.
    if (periodFrom > todayYmd) {
      setFlowTxns([]);
    } else if (periodTo >= todayYmd) {
      // Current month: month txn fetch already covers [periodFrom, today] (no future-dated needed).
      setFlowTxns(list as Transaction[]);
    } else {
      // Past month: need flows after periodTo as well to back out from current balances.
      const flows = (await api.accounts.transactions(periodFrom, todayYmd).catch(() => [])) as Transaction[];
      setFlowTxns(flows);
    }
    setBtcHoldings(btc.holdings ?? []);
    setBtcPrimaryId(btc.primaryId ?? null);
    // Seed form defaults via functional updates so `load` identity stays stable.
    // (Previously depending on formAccountId etc. recreated `load` on first paint,
    // cancelled the in-flight auto-sync effect after debounce was marked, and the
    // Budget Transactions table never reloaded newly inserted bank/Spend rows.)
    const firstCash = cash[0];
    const defaultBtc = btc.primaryId || btc.holdings?.[0]?.id || '';
    setFormBtcHoldingId((prev) => prev || defaultBtc || prev);
    setIncAccountId((prev) => prev || firstCash?.id || prev);
    setImportAccountId((prev) => prev || firstCash?.id || prev);
    if (!formAccountSeeded.current && firstCash) {
      formAccountSeeded.current = true;
      setFormAccountId(firstCash.id);
      setFormSource(isBankishAccount(firstCash) ? 'bank' : 'manual');
    }
  }, [periodFrom, periodTo, selectedMonth]);

  const loadRef = useRef(load);
  loadRef.current = load;


  useEffect(() => {
    load().catch((e: Error) => {
      setTxns((prev) => {
        if (Array.isArray(prev) && prev.length > 0) {
          showQuietToast('Could not refresh budget — showing last data.', { kind: 'warn' });
          return prev;
        }
        setError(e.message);
        return prev;
      });
    });
  }, [load]);

  // Silent background Akahu auto-sync once on Budget/Spending open / refresh.
  // Mount-only (loadRef) so month changes reload data without re-hitting Akahu,
  // and so load identity changes never cancel a sync mid-flight.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          maybeAutoSyncBankTransactions(),
          maybeAutoSyncPortfolio(),
        ]);
        if (cancelled) return;
        // Always refresh UI after the attempt settles. Sync may have been
        // debounced while another page's sync already wrote new txns; or this
        // run inserted rows — either way the Transactions table must catch up.
        await loadRef.current();
      } catch {
        showQuietToast('Bank sync paused — showing last transactions.', { kind: 'warn' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  async function onAddTxn(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!formAccountId) {
      setMsg('Choose the charged account (Kiwibank Main / Debit / etc.).');
      return;
    }
    if (formSource !== 'bank' && !resolvedCardName) {
      setMsg('Enter a card name (e.g. Nexo card, GoMining card, Debit card).');
      return;
    }
    if (formSource === 'google_wallet' && !resolvedCardName) {
      setMsg('Card name is required for Google Wallet.');
      return;
    }
    const raw = Number(formAmount);
    if (!Number.isFinite(raw) || raw === 0) {
      setMsg('Enter a non-zero amount in NZD.');
      return;
    }
    // Debits stored as negative for signed amount convention
    const amount = formKind === 'debit' ? -Math.abs(raw) : Math.abs(raw);
    if (formDate < SPENDING_FLOOR) {
      setMsg(`Only transactions on/after ${SPENDING_FLOOR} are accepted.`);
      return;
    }

    if (formUseBtc && btcHoldings.length === 0) {
      setMsg('Use BTC is on but no BTC crypto holding exists — add one under Portfolio first.');
      return;
    }
    if (formUseBtc && !formBtcHoldingId) {
      setMsg('Choose which BTC holding to adjust.');
      return;
    }

    setSaving(true);
    try {
      const source: TransactionSource =
        formSource === 'google_wallet'
          ? 'google_wallet'
          : formSource === 'bank'
            ? 'bank'
            : 'manual';
      const cardName =
        resolvedCardName ||
        (source === 'bank'
          ? accounts.find((a) => a.id === formAccountId)?.name || 'Bank'
          : null);
      const description =
        formDesc.trim() ||
        (source === 'bank' ? cardName || '' : cardName || '(manual)');
      const created = (await api.accounts.createTransaction({
        accountId: formAccountId,
        date: formDate,
        description,
        amount,
        kind: formKind,
        cardName,
        source,
        affectsBtc: formUseBtc,
        btcHoldingId: formUseBtc ? formBtcHoldingId || null : null,
      })) as Transaction & {
        btcLink?: {
          applied?: boolean;
          holdingName?: string;
          btcDelta?: number | null;
          btcNzdRate?: number | null;
        } | null;
      };
      const btcNote =
        formUseBtc && created.btcLink?.applied
          ? ` · BTC ${created.btcLink.btcDelta != null && created.btcLink.btcDelta < 0 ? '−' : '+'}${Math.abs(created.btcLink.btcDelta ?? 0).toFixed(8)} on ${created.btcLink.holdingName ?? 'BTC'} @ ${created.btcLink.btcNzdRate?.toFixed(2) ?? '?'} NZD`
          : formUseBtc
            ? ' · Use BTC'
            : '';
      setMsg(
        `Saved · ${sourceLabel(source)} · charged ${accounts.find((a) => a.id === formAccountId)?.name ?? formAccountId}${btcNote}`,
      );
      setFormDesc('');
      setFormAmount('');
      setFormUseBtc(false);
      setShowTxnModal(false);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onImportCsv(file: File | null) {
    if (!file) return;
    setMsg(null);
    if (!importAccountId) {
      setMsg('Choose the charged account before importing CSV.');
      return;
    }
    setImporting(true);
    try {
      const csvText = await file.text();
      const r = await api.accounts.importWalletCsv(csvText, importAccountId, 'google_wallet');
      const errN = r.parseErrors?.length ?? 0;
      setMsg(
        `CSV import: ${r.inserted} inserted` +
          (r.skippedDup ? `, ${r.skippedDup} dupes skipped` : '') +
          (r.skippedBefore ? `, ${r.skippedBefore} before ${SPENDING_FLOOR} skipped` : '') +
          (errN ? `, ${errN} parse warnings` : '') +
          ` -> ${r.accountName}`,
      );
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function openCharityReceiptModal(t: Transaction) {
    setCharityReceiptDataUrl(null);
    setCharityReceiptName(null);
    setCharityLinkPaye(true);
    setCharityModalTxn(t);
  }

  function closeCharityReceiptModal() {
    setCharityModalTxn(null);
    setCharityReceiptDataUrl(null);
    setCharityReceiptName(null);
    setCharitySaving(false);
  }

  function onPickCharityReceipt(file: File | null) {
    if (!file) {
      setCharityReceiptDataUrl(null);
      setCharityReceiptName(null);
      return;
    }
    const okType =
      file.type.startsWith('image/') ||
      file.type === 'application/pdf' ||
      /\.(jpe?g|png|webp|gif|pdf)$/i.test(file.name);
    if (!okType) {
      setMsg('Receipt must be an image (JPEG/PNG/WebP/GIF) or PDF.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMsg('Receipt max size is 8MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setCharityReceiptDataUrl(result || null);
      setCharityReceiptName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function onConfirmCharityReceipt(e?: FormEvent) {
    e?.preventDefault();
    const t = charityModalTxn;
    if (!t) return;
    setCharitySaving(true);
    setMsg(null);
    try {
      let updated: Transaction = t;
      if (charityReceiptDataUrl) {
        updated = (await api.accounts.uploadTransactionReceipt(
          t.id,
          charityReceiptDataUrl,
        )) as Transaction;
        setTxns((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...updated } : x)));
      }
      if (charityLinkPaye) {
        const prefs = linkCharityDonationToPaye({
          txnId: t.id,
          amountNzd: Math.abs(Number(t.amount) || 0),
          date: t.date,
          description: t.description || 'Charity donation',
          receiptUrl: updated.receiptUrl ?? null,
        });
        const total = prefs.charityDonationsAnnual;
        setMsg(
          `Charity linked to PAYE IR526 · annual donations now ${formatNzd(Number(total) || 0)}` +
            (charityReceiptDataUrl ? ' · receipt saved' : ' · no receipt yet'),
        );
      } else if (charityReceiptDataUrl) {
        setMsg('Charity receipt saved (not linked to PAYE).');
      } else {
        setMsg('Charity category set — upload a receipt later for IR526.');
      }
      closeCharityReceiptModal();
    } catch (err) {
      setMsg((err as Error).message);
      setCharitySaving(false);
    }
  }

  async function onCategoryChange(txnId: string, categoryId: string) {
    setMsg(null);
    setCategorySavingId(txnId);
    const prev = txns.find((t) => t.id === txnId);
    const next = categoryId === '' ? null : categoryId;
    // Optimistic local update
    setTxns((prevTxns) =>
      prevTxns.map((t) => (t.id === txnId ? { ...t, categoryId: next } : t)),
    );
    try {
      const updated = (await api.accounts.updateTransaction(txnId, {
        categoryId: next,
      })) as Transaction;
      setTxns((prevTxns) =>
        prevTxns.map((t) => (t.id === txnId ? { ...t, ...updated } : t)),
      );
      if (isCharityCategoryId(prev?.categoryId) && !isCharityCategoryId(next)) {
        unlinkCharityDonationFromPaye(txnId);
      }
      if (isCharityCategoryId(next)) {
        openCharityReceiptModal({ ...prev!, ...updated, categoryId: next });
      }
    } catch (err) {
      setMsg((err as Error).message);
      await load();
    } finally {
      setCategorySavingId(null);
    }
  }

  async function onDeleteTxn(t: Transaction) {
    const label = `${t.date} · ${t.description || '(no description)'} · ${Number(t.amount)}`;
    if (!window.confirm(`Delete this transaction?\n\n${label}`)) return;
    setMsg(null);
    try {
      await api.accounts.deleteTransaction(t.id);
      if (isCharityCategoryId(t.categoryId)) {
        unlinkCharityDonationFromPaye(t.id);
      }
      setTxns((prev) => prev.filter((x) => x.id !== t.id));
      setMsg(`Deleted ${t.id}`);
    } catch (err) {
      setMsg((err as Error).message);
      await load();
    }
  }

  const budgetsThisPeriod = useMemo(
    () =>
      budgets.filter((b) =>
        budgetOverlapsMonth(b.periodStart, b.periodEnd, selectedMonth),
      ),
    [budgets, selectedMonth],
  );

  const debtOutstandingTotal = useMemo(
    () => debtPeople.reduce((s, p) => s + Number(p.outstandingNzd || 0), 0),
    [debtPeople],
  );

  const categorySpend = useMemo(
    () => aggregateCategorySpend(txns, categories, periodFrom, periodTo, debtRepayments),
    [txns, categories, periodFrom, periodTo, debtRepayments],
  );

  const spendByCategoryId = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of categorySpend) {
      if (r.categoryId) m.set(r.categoryId, r.spend);
    }
    return m;
  }, [categorySpend]);

  /** Spending categories only for budget plans (excludes income + transfers). */
  const expenseCategories = useMemo(
    () =>
      categories.filter((c) =>
        categoryTypeCountsAsSpend(normalizeCategoryType(c.type, c.isIncome)),
      ),
    [categories],
  );

  /** Income categories only (transfer_in is never income). */
  const incomeCategories = useMemo(
    () =>
      categories.filter((c) =>
        categoryTypeIsIncome(normalizeCategoryType(c.type, c.isIncome)),
      ),
    [categories],
  );

  const incomeCompareRows = useMemo(() => {
    const rows = incomeSummary?.categories ?? [];
    return rows.filter((r) => r.plannedNzd > 0 || r.actualNzd > 0);
  }, [incomeSummary]);

  /** Planned vs spent rows for the selected month (planned categories first). */
  const budgetCompareRows = useMemo(() => {
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const spendingIds = new Set(expenseCategories.map((c) => c.id));
    return budgetsThisPeriod
      .filter((b) => spendingIds.has(b.categoryId))
      .map((b) => {
        const planned = Number(b.amountNzd) || 0;
        const spent = spendByCategoryId.get(b.categoryId) ?? 0;
        const remaining = planned - spent;
        const pct = planned > 0 ? Math.min(100, (spent / planned) * 100) : spent > 0 ? 100 : 0;
        return {
          budget: b,
          categoryId: b.categoryId,
          name: catName.get(b.categoryId) ?? b.categoryId,
          planned,
          spent,
          remaining,
          pct,
          overBudget: spent > planned && planned > 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [budgetsThisPeriod, categories, spendByCategoryId, expenseCategories]);

  const plannedTotal = useMemo(
    () => budgetCompareRows.reduce((s, r) => s + r.planned, 0),
    [budgetCompareRows],
  );
  const spentAgainstPlanTotal = useMemo(
    () => budgetCompareRows.reduce((s, r) => s + r.spent, 0),
    [budgetCompareRows],
  );

  const plannedIncomeNzd = incomeSummary?.plannedNzd ?? 0;
  const actualIncomeNzd = incomeSummary?.actualNzd ?? 0;
  const incomeRemainingNzd = plannedIncomeNzd - actualIncomeNzd;
  const incomeOverPlan = actualIncomeNzd > plannedIncomeNzd && plannedIncomeNzd > 0;

  /** Liquid NZD bank/cash total — same basis as Dashboard Cash. */
  const cashBalanceNzd = useMemo(
    () =>
      accounts
        .filter((a) => (a.currency ?? 'NZD').toUpperCase() === 'NZD')
        .filter(isLiquidCashAccount)
        .reduce((s, a) => s + (Number(a.balance) || 0), 0),
    [accounts],
  );

  const liquidCashIds = useMemo(
    () =>
      new Set(
        accounts
          .filter((a) => (a.currency ?? 'NZD').toUpperCase() === 'NZD' && isLiquidCashAccount(a))
          .map((a) => a.id),
      ),
    [accounts],
  );

  /**
   * Cash at start of selected calendar month (Pacific/Auckland).
   * Derived only: current liquid NZD − sum of signed txn amounts on those liquid accounts
   * from month start through today. Null when the month has not started yet (never invent).
   */
  const cashStartOfMonthNzd = useMemo(() => {
    const todayYmd = todayAucklandYmd();
    if (periodFrom > todayYmd) return null;
    const netFlow = flowTxns
      .filter(
        (t) =>
          liquidCashIds.has(t.accountId) &&
          t.date >= periodFrom &&
          t.date <= todayYmd,
      )
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    return cashBalanceNzd - netFlow;
  }, [cashBalanceNzd, flowTxns, liquidCashIds, periodFrom]);

  /** Selected-month spending (Pacific/Auckland) — sum of category spend rows. */
  const spentThisMonthNzd = useMemo(
    () => categorySpend.reduce((s, r) => s + r.spend, 0),
    [categorySpend],
  );

  /**
   * Saved = leftover = Cash − Spent this month.
   * Chosen over income − spent: Nathan called it "cash leftover after spend".
   * Cash is current liquid NZD; Spent is this calendar month's outflows.
   * (Income − spent remains available via planned/received cards below.)
   */
  const savedLeftoverNzd = cashBalanceNzd - spentThisMonthNzd;
  const liquidCashAccountCount = useMemo(
    () =>
      accounts.filter(
        (a) => (a.currency ?? 'NZD').toUpperCase() === 'NZD' && isLiquidCashAccount(a),
      ).length,
    [accounts],
  );

  function startEditPlan(b: Budget) {
    setEditingPlanId(b.id);
    setEditPlanAmount(String(b.amountNzd ?? ''));
  }

  function cancelEditPlan() {
    setEditingPlanId(null);
    setEditPlanAmount('');
  }

  async function onSavePlan(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!planCategoryId) {
      setMsg('Choose a category for the budget plan.');
      return;
    }
    const amount = Number(planAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMsg('Enter a non-negative planned amount in NZD.');
      return;
    }
    setPlanSaving(true);
    try {
      await api.budgets.upsertPlan({
        categoryId: planCategoryId,
        yearMonth: monthKey,
        amountNzd: amount,
      });
      const name = categories.find((c) => c.id === planCategoryId)?.name ?? planCategoryId;
      setMsg(`Budget plan · ${name} · ${formatNzd(amount)} for ${monthLong}`);
      setPlanAmount('');
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanSaving(false);
    }
  }

  async function onSaveInlinePlan(budgetId: string) {
    setMsg(null);
    const amount = Number(editPlanAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMsg('Enter a non-negative planned amount in NZD.');
      return;
    }
    const row = budgetsThisPeriod.find((b) => b.id === budgetId);
    if (!row) return;
    setPlanSaving(true);
    try {
      await api.budgets.upsertPlan({
        categoryId: row.categoryId,
        yearMonth: monthKey,
        amountNzd: amount,
      });
      setMsg(`Updated plan · ${formatNzd(amount)}`);
      cancelEditPlan();
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanSaving(false);
    }
  }

  async function onClearPlan(budgetId: string) {
    const row = budgetsThisPeriod.find((b) => b.id === budgetId);
    const name = row
      ? categories.find((c) => c.id === row.categoryId)?.name ?? row.categoryId
      : budgetId;
    if (!window.confirm(`Remove budget plan for ${name} in ${monthLong}?`)) return;
    setMsg(null);
    setPlanSaving(true);
    try {
      await api.budgets.remove(budgetId);
      setMsg(`Cleared plan · ${name}`);
      if (editingPlanId === budgetId) cancelEditPlan();
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanSaving(false);
    }
  }


  async function onSaveIncomePlan(e?: FormEvent) {
    e?.preventDefault();
    setMsg(null);
    if (!planIncomeCategoryId) {
      setMsg('Choose an income category (Salary, Mining, …).');
      return;
    }
    const amount = Number(planIncomeAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMsg('Enter a non-negative planned income amount in NZD.');
      return;
    }
    setPlanIncomeSaving(true);
    try {
      await api.income.upsertPlan({
        yearMonth: monthKey,
        categoryId: planIncomeCategoryId,
        amountNzd: amount,
      });
      const catName =
        incomeCategories.find((c) => c.id === planIncomeCategoryId)?.name ?? planIncomeCategoryId;
      setMsg(`Planned ${catName} · ${formatNzd(amount)} for ${monthLong}`);
      setPlanIncomeAmount('');
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanIncomeSaving(false);
    }
  }

  async function onSaveEditIncomePlan(categoryId: string) {
    const amount = Number(editIncomePlanAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMsg('Enter a non-negative planned income amount in NZD.');
      return;
    }
    setPlanIncomeSaving(true);
    setMsg(null);
    try {
      await api.income.upsertPlan({
        yearMonth: monthKey,
        categoryId,
        amountNzd: amount,
      });
      setEditingIncomePlanId(null);
      setMsg(`Updated planned income · ${formatNzd(amount)}`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanIncomeSaving(false);
    }
  }

  async function onClearIncomePlan(planId: string, categoryName: string) {
    if (!window.confirm(`Clear planned ${categoryName} for ${monthLong}?`)) return;
    setMsg(null);
    setPlanIncomeSaving(true);
    try {
      await api.income.removePlan(planId);
      setMsg(`Cleared planned ${categoryName} · ${monthLong}`);
      setEditingIncomePlanId(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanIncomeSaving(false);
    }
  }

  async function onAddIncome(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (incDate < SPENDING_FLOOR) {
      setMsg(`Only income on/after ${SPENDING_FLOOR} is accepted.`);
      return;
    }
    if (incKind === 'cash') {
      const amount = Number(incAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setMsg('Enter a positive income amount in NZD.');
        return;
      }
      if (!incAccountId) {
        setMsg('Choose the account that received the cash income.');
        return;
      }
    } else {
      if (!incCryptoAsset.trim()) {
        setMsg('Enter a crypto ticker (e.g. BTC, ETH).');
        return;
      }
      const qty = Number(incCryptoAmount);
      if (!Number.isFinite(qty) || qty <= 0) {
        setMsg('Enter a positive crypto quantity received.');
        return;
      }
    }
    setIncomeSaving(true);
    try {
      const created = (await api.income.create({
        date: incDate,
        ...(incKind === 'cash' ? { amountNzd: Number(incAmount) } : {}),
        kind: incKind,
        description: incDesc.trim() || (incKind === 'crypto' ? 'Crypto income' : 'Income'),
        accountId: incKind === 'cash' ? incAccountId || null : null,
        categoryId: incCategoryId || incomeCategoryIdFromList(categories, incKind === 'crypto' ? 'crypto' : 'cash'),
        cryptoAsset: incKind === 'crypto' ? incCryptoAsset.trim().toUpperCase() : undefined,
        cryptoAmount: incKind === 'crypto' ? Number(incCryptoAmount) : undefined,
        notes: incNotes.trim() || null,
      })) as IncomeRecord & {
        holding?: { merged?: boolean; name?: string; newAmount?: number } | null;
      };
      const savedNzd = Number(created.amountNzd);
      const holdingNote =
        incKind === 'crypto' && created.holding
          ? created.holding.merged
            ? ` · merged into ${created.holding.name} (now ${created.holding.newAmount})`
            : ` · new holding ${created.holding.name}`
          : '';
      const nzdNote =
        Number.isFinite(savedNzd)
          ? formatNzd(savedNzd)
          : 'NZD pending';
      setMsg(
        `Income saved · ${incKind} · ${nzdNote}${
          incKind === 'crypto' ? ' (from live quote)' : ''
        }${holdingNote}`,
      );
      setIncAmount('');
      setIncDesc('');
      setIncCryptoAsset('');
      setIncCryptoAmount('');
      setIncNotes('');
      setShowIncomeModal(false);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setIncomeSaving(false);
    }
  }

  async function onDeleteIncome(rec: IncomeRecord) {
    if (rec.origin === 'category_txn') {
      setMsg('Bank/tagged Income credits are removed by changing the transaction category.');
      return;
    }
    const label = `${rec.date} · ${rec.description || rec.kind} · ${formatNzd(rec.amountNzd)}`;
    if (!window.confirm(`Delete this income record?\n\n${label}`)) return;
    setMsg(null);
    try {
      await api.income.remove(rec.id);
      setMsg(`Deleted income ${rec.id}`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function onAddDebtPerson(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = personName.trim();
    if (!name) {
      setMsg('Enter a name for who you owe.');
      return;
    }
    const outstanding = Number(personOutstanding);
    if (!Number.isFinite(outstanding) || outstanding < 0) {
      setMsg('Outstanding must be a non-negative NZD amount.');
      return;
    }
    setDebtSaving(true);
    try {
      await api.debts.createPerson({
        name,
        kind: personKind,
        notes: personNotes.trim() || null,
        outstandingNzd: outstanding,
      });
      setPersonName('');
      setPersonKind('person');
      setPersonNotes('');
      setPersonOutstanding('');
      setShowAddPerson(false);
      const kindLabel = personKind === 'corporation' ? 'Corporation' : 'Person';
      setMsg(`Added debt · ${kindLabel} · ${name} · ${formatNzd(outstanding)} outstanding`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setDebtSaving(false);
    }
  }


  async function onDeleteDebtPerson(p: DebtPerson) {
    const kind = debtKindLabel(p.kind);
    const repaid = Number(p.repaidTotalNzd ?? 0);
    const extra =
      repaid > 0
        ? `\n\nThis also removes ${formatNzd(repaid)} of repayment history for this creditor only. Other creditors are unchanged.`
        : '';
    if (
      !window.confirm(
        `Delete this creditor?\n\n${kind} · ${p.name} · ${formatNzd(p.outstandingNzd)} outstanding${extra}`,
      )
    ) {
      return;
    }
    setMsg(null);
    setDebtSaving(true);
    try {
      await api.debts.deletePerson(p.id);
      if (historyPersonId === p.id) setHistoryPersonId(null);
      if (repayPersonId === p.id) setRepayPersonId('');
      setMsg(`Deleted creditor · ${kind} · ${p.name}`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
      await load();
    } finally {
      setDebtSaving(false);
    }
  }

  async function onAddRepayment(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!repayPersonId) {
      setMsg('Choose who you are repaying.');
      return;
    }
    const amount = Number(repayAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg('Enter a positive repayment amount in NZD.');
      return;
    }
    if (repayDate < SPENDING_FLOOR) {
      setMsg(`Repayment date must be on/after ${SPENDING_FLOOR}.`);
      return;
    }
    setDebtSaving(true);
    try {
      const r = await api.debts.addRepayment(repayPersonId, {
        amountNzd: amount,
        date: repayDate,
        notes: repayNotes.trim() || null,
        transactionId: repayTxnId.trim() || null,
      });
      setMsg(
        `Repaid ${formatNzd(amount)} -> ${r.person.name} · outstanding now ${formatNzd(r.person.outstandingNzd)}`,
      );
      setRepayAmount('');
      setRepayNotes('');
      setRepayTxnId('');
      setShowRepayForm(false);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setDebtSaving(false);
    }
  }

  if (error && (!txns || txns.length === 0)) return <div className="panel warn">Spending: {error}</div>;

  return (
    <div className="stack">
      <section className="panel">
        <h2>Spending & budgets</h2>
        <p className="page-lead">
          Browse by calendar month (Pacific/Auckland). Import/sync floor stays{' '}
          <strong>1 Oct 2026</strong>. Sync Kiwibank via Akahu; off-Akahu cards (Nexo, GoMining, …)
          — add manually with card name and charged cash account.
        </p>
        <div className="period-pager" role="navigation" aria-label="Spending month">
          <button
            type="button"
            className="btn"
            disabled={!canGoPrev}
            aria-label="Previous month"
            onClick={() => setSelectedMonth((m) => addMonths(m, -1))}
          >
            {'<- Prev'}
          </button>
          <div className="period-pager-label">
            <strong>{monthLong}</strong>
            <span className="muted small">
              {periodFrom}{' – '}{periodTo}
            </span>
          </div>
          <button
            type="button"
            className="btn"
            aria-label="Next month"
            onClick={() => setSelectedMonth((m) => addMonths(m, 1))}
          >
            {'Next ->'}
          </button>
        </div>
        <div
          className="grid cards spending-summary-cards"
          role="group"
          aria-label="Cash, start of month, spent, and saved summary"
        >
          <div className="card">
            <p className="eyebrow">Cash</p>
            <p className="stat-value">{formatNzd(cashBalanceNzd)}</p>
            <p className="muted small">
              {liquidCashAccountCount} liquid account
              {liquidCashAccountCount === 1 ? '' : 's'} · NZD
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Start of month</p>
            <p className="stat-value">
              {cashStartOfMonthNzd != null ? formatNzd(cashStartOfMonthNzd) : '—'}
            </p>
            <p className="muted small">
              {monthLong} · liquid NZD
              {cashStartOfMonthNzd == null ? ' · not started' : ''}
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Spent</p>
            <p className="stat-value">{formatNzd(spentThisMonthNzd)}</p>
            <p className="muted small">
              {monthLong} · outflows
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Saved</p>
            <p className={`stat-value${savedLeftoverNzd < 0 ? ' budget-over-text' : ''}`}>
              {formatNzd(savedLeftoverNzd)}
            </p>
            <p className="muted small">
              Leftover · cash − spent
            </p>
          </div>
        </div>
        {msg && <div className="banner">{msg}</div>}
      </section>

      {showTxnModal && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTxnModal();
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-txn-title"
          >
            <div className="modal-header">
              <h3 id="add-txn-title">Add transaction</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                onClick={closeTxnModal}
              >
                ×
              </button>
            </div>
            <p className="section-desc">
              Bank: Kiwibank / debit before Akahu posts. Manual: off-Akahu cards (Nexo, GoMining, …).
              Charged account required so spend ties to a cash balance.
            </p>
            <form className="form-grid" onSubmit={onAddTxn}>
            <label>
              Source
              <select
                value={formSource}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'google_wallet') setFormSource('google_wallet');
                  else if (v === 'bank') setFormSource('bank');
                  else setFormSource('manual');
                }}
              >
                <option value="bank">Bank</option>
                <option value="manual">Manual (Nexo / GoMining / other)</option>
                <option value="google_wallet">Google Wallet</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                min={SPENDING_FLOOR}
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                required
              />
            </label>
            <label>
              Amount (NZD)
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="12.50"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                required
              />
            </label>
            <label>
              Kind
              <select
                value={formKind}
                onChange={(e) => setFormKind(e.target.value === 'credit' ? 'credit' : 'debit')}
              >
                <option value="debit">Debit (spend)</option>
                <option value="credit">Credit (inflow)</option>
              </select>
            </label>
            <label className="span-2">
              Description
              <input
                type="text"
                placeholder="Merchant / note"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </label>
            <label>
              Card
              <select
                value={formCardPreset}
                onChange={(e) => setFormCardPreset(e.target.value)}
              >
                {CARD_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            {formCardPreset === 'Other' ? (
              <label>
                Custom card name
                <input
                  type="text"
                  placeholder="e.g. Wise card"
                  value={formCardCustom}
                  onChange={(e) => setFormCardCustom(e.target.value)}
                  required
                />
              </label>
            ) : (
              <label>
                Card name (edit)
                <input
                  type="text"
                  value={resolvedCardName}
                  onChange={(e) => {
                    setFormCardPreset('Other');
                    setFormCardCustom(e.target.value);
                  }}
                  title="Free-text — click to customise"
                />
              </label>
            )}
            <label className="span-2">
              Charged account
              <select
                value={formAccountId}
                onChange={(e) => {
                  const id = e.target.value;
                  setFormAccountId(id);
                  const acct = accounts.find((a) => a.id === id);
                  if (isBankishAccount(acct) && formSource === 'manual') {
                    setFormSource('bank');
                  } else if (!isBankishAccount(acct) && formSource === 'bank') {
                    setFormSource('manual');
                  }
                }}
                required
              >
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.institution ? ` · ${a.institution}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2 row gap" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={formUseBtc}
                onChange={(e) => setFormUseBtc(e.target.checked)}
              />
              <span>
                {formKind === 'debit' ? 'Pays with BTC' : 'Use BTC'}{' '}
                <span className="muted small">
                  (optional — converts NZD ↔ BTC at live quote; off by default)
                </span>
              </span>
            </label>
            {formUseBtc && (
              <label className="span-2">
                BTC holding to {formKind === 'debit' ? 'deduct from' : 'add to'}
                <select
                  value={formBtcHoldingId}
                  onChange={(e) => setFormBtcHoldingId(e.target.value)}
                  required={formUseBtc}
                >
                  {btcHoldings.length === 0 ? (
                    <option value="">No BTC holdings — add under Portfolio</option>
                  ) : (
                    btcHoldings.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} · {h.amount} {h.asset}
                        {btcPrimaryId === h.id ? ' (primary)' : ''}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
            <div className="span-2 row gap modal-actions">
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save transaction'}
              </button>
              <button type="button" className="btn" onClick={closeTxnModal} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
          </div>
        </div>
      )}

      <section className="panel">
        <h3 id="budget-plan-anchor">Budget plan · {monthLabel}</h3>
        <p className="section-desc">
          Plan income and spending for {monthLong} (Pacific/Auckland). Income compares{' '}
          <strong>planned vs received</strong>; spending compares <strong>planned vs spent</strong>
          (outflows; Debt = repayments only).
        </p>

        <h4 className="section-subtitle">Planned income</h4>
        <p className="section-desc">
          Plan by category (Salary, Mining, …). Received = income records + bank-sync / tagged
          income-category credits, matched to those categories (linked Add-income txns are not
          double-counted). See <strong>Income received</strong> below.
        </p>
        <div className="grid cards budget-compare-summary" style={{ marginBottom: '0.75rem' }}>
          <div className="card">
            <p className="eyebrow">Planned income</p>
            <p className="stat-value">{formatNzd(plannedIncomeNzd)}</p>
            <p className="muted small">
              {incomeCompareRows.filter((r) => r.plannedNzd > 0).length} categor
              {incomeCompareRows.filter((r) => r.plannedNzd > 0).length === 1 ? 'y' : 'ies'} ·{' '}
              {monthLong}
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Received</p>
            <p className="stat-value">{formatNzd(actualIncomeNzd)}</p>
            <p className={`muted small${incomeOverPlan ? ' budget-over-text' : ''}`}>
              {plannedIncomeNzd > 0
                ? incomeRemainingNzd >= 0
                  ? `${formatNzd(incomeRemainingNzd)} still expected`
                  : `${formatNzd(Math.abs(incomeRemainingNzd))} over plan`
                : incomeSummary
                  ? `${incomeSummary.receivedItemCount ?? incomeSummary.recordCount} item${
                      (incomeSummary.receivedItemCount ?? incomeSummary.recordCount) === 1
                        ? ''
                        : 's'
                    }`
                  : '—'}
            </p>
          </div>
        </div>

        {incomeCompareRows.length === 0 ? (
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            No income plans or received income for {monthLong} yet. Use the form below to plan
            Salary, Mining, etc.
          </p>
        ) : (
          <div className="grid cards budget-compare-grid" style={{ marginBottom: '1rem' }}>
            {incomeCompareRows.map((row) => {
              const pct =
                row.plannedNzd > 0
                  ? Math.min(100, (row.actualNzd / row.plannedNzd) * 100)
                  : row.actualNzd > 0
                    ? 100
                    : 0;
              const over = row.actualNzd > row.plannedNzd && row.plannedNzd > 0;
              const editing = editingIncomePlanId === row.categoryId;
              return (
                <div
                  key={row.categoryId}
                  className={`card budget-compare-card${over ? ' budget-over' : ''}`}
                >
                  <div className="budget-compare-head">
                    <strong>{row.categoryName}</strong>
                    {over && <span className="budget-over-badge">Over plan</span>}
                  </div>
                  {editing ? (
                    <div className="budget-inline-edit row gap">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={editIncomePlanAmount}
                        onChange={(e) => setEditIncomePlanAmount(e.target.value)}
                        aria-label={`Planned ${row.categoryName} NZD`}
                        style={{ maxWidth: '8rem' }}
                      />
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={planIncomeSaving || !row.plan}
                        onClick={() => onSaveEditIncomePlan(row.categoryId)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        disabled={planIncomeSaving}
                        onClick={() => setEditingIncomePlanId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <dl className="budget-compare-stats">
                      <div>
                        <dt>Planned</dt>
                        <dd>{formatNzd(row.plannedNzd)}</dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd>{formatNzd(row.actualNzd)}</dd>
                      </div>
                      <div>
                        <dt>{row.remainingNzd >= 0 ? 'Still expected' : 'Over by'}</dt>
                        <dd className={row.remainingNzd < 0 ? 'budget-positive-text' : ''}>
                          {formatNzd(Math.abs(row.remainingNzd))}
                        </dd>
                      </div>
                    </dl>
                  )}
                  <div
                    className="budget-progress"
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.categoryName} ${Math.round(pct)}% of plan`}
                  >
                    <div
                      className={`budget-progress-fill${over ? ' over' : ''}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <p className="budget-progress-meta muted small">
                    <span>
                      {row.plannedNzd > 0
                        ? `${Math.round(pct)}% of plan`
                        : 'Received only (no plan)'}
                    </span>
                  </p>
                  {!editing && row.plan && (
                    <div className="row gap budget-card-actions">
                      <button
                        type="button"
                        className="btn small"
                        disabled={planIncomeSaving}
                        onClick={() => {
                          setEditIncomePlanAmount(String(row.plannedNzd));
                          setEditingIncomePlanId(row.categoryId);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        disabled={planIncomeSaving}
                        onClick={() => onClearIncomePlan(row.plan!.id, row.categoryName)}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <h4 className="section-subtitle">Set / update income plan</h4>
        <form className="form-grid" onSubmit={onSaveIncomePlan} style={{ marginBottom: '1.25rem' }}>
          <label>
            Category
            <select
              value={planIncomeCategoryId}
              onChange={(e) => {
                const id = e.target.value;
                setPlanIncomeCategoryId(id);
                const existing = incomeSummary?.plans?.find((p) => p.categoryId === id);
                if (existing) setPlanIncomeAmount(String(existing.amountNzd));
              }}
              required
            >
              <option value="">Select…</option>
              {incomeCategories.map((c) => {
                const existing = incomeSummary?.plans?.find((p) => p.categoryId === c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {existing ? ` · planned ${formatNzd(existing.amountNzd)}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Planned (NZD)
            <input
              type="number"
              min={0}
              step="0.01"
              value={planIncomeAmount}
              onChange={(e) => setPlanIncomeAmount(e.target.value)}
              placeholder="e.g. 5500"
              required
            />
          </label>
          <div className="span-2 row gap">
            <button type="submit" className="btn primary" disabled={planIncomeSaving}>
              {planIncomeSaving ? 'Saving…' : 'Save income plan'}
            </button>
          </div>
        </form>

        <h4 className="section-subtitle">Planned spending</h4>
        <p className="section-desc">
          Planned NZD per expense category. Cards compare <strong>planned vs spent</strong>.
        </p>

        {budgetCompareRows.length > 0 && (
          <div className="grid cards budget-compare-summary">
            <div className="card">
              <p className="eyebrow">Planned total</p>
              <p className="stat-value">{formatNzd(plannedTotal)}</p>
              <p className="muted small">
                {budgetCompareRows.length} categor
                {budgetCompareRows.length === 1 ? 'y' : 'ies'}
              </p>
            </div>
            <div className="card">
              <p className="eyebrow">Spent vs plan</p>
              <p className="stat-value">{formatNzd(spentAgainstPlanTotal)}</p>
              <p className={`muted small${spentAgainstPlanTotal > plannedTotal && plannedTotal > 0 ? ' budget-over-text' : ''}`}>
                {plannedTotal > 0
                  ? `${formatNzd(plannedTotal - spentAgainstPlanTotal)} remaining`
                  : '—'}
              </p>
            </div>
          </div>
        )}

        {budgetCompareRows.length === 0 ? (
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            No spending plans for {monthLong} yet. Use the form below to
            add planned spend for rent, transport, groceries, etc.
          </p>
        ) : (
          <div className="grid cards budget-compare-grid" style={{ marginBottom: '1rem' }}>
            {budgetCompareRows.map((row) => (
              <div
                key={row.budget.id}
                className={`card budget-compare-card${row.overBudget ? ' budget-over' : ''}`}
              >
                <div className="budget-compare-head">
                  <strong>{row.name}</strong>
                  {row.overBudget && (
                    <span className="budget-over-badge">Over budget</span>
                  )}
                </div>
                {editingPlanId === row.budget.id ? (
                  <div className="budget-inline-edit row gap">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editPlanAmount}
                      onChange={(e) => setEditPlanAmount(e.target.value)}
                      aria-label={`Planned NZD for ${row.name}`}
                      style={{ maxWidth: '8rem' }}
                    />
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={planSaving}
                      onClick={() => onSaveInlinePlan(row.budget.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={planSaving}
                      onClick={cancelEditPlan}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <dl className="budget-compare-stats">
                    <div>
                      <dt>Planned</dt>
                      <dd>{formatNzd(row.planned)}</dd>
                    </div>
                    <div>
                      <dt>Spent</dt>
                      <dd className={row.overBudget ? 'budget-over-text' : ''}>
                        {formatNzd(row.spent)}
                      </dd>
                    </div>
                    <div>
                      <dt>{row.remaining >= 0 ? 'Remaining' : 'Over by'}</dt>
                      <dd className={row.remaining < 0 ? 'budget-over-text' : ''}>
                        {formatNzd(Math.abs(row.remaining))}
                      </dd>
                    </div>
                  </dl>
                )}
                <div
                  className="budget-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(row.pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${row.name} ${Math.round(row.pct)}% of plan`}
                >
                  <div
                    className={`budget-progress-fill${row.overBudget ? ' over' : ''}`}
                    style={{ width: `${Math.min(100, row.pct)}%` }}
                  />
                </div>
                <p className="budget-progress-meta muted small">
                  <span>{row.planned > 0 ? `${Math.round(row.pct)}% of plan` : 'No plan amount'}</span>
                </p>
                {editingPlanId !== row.budget.id && (
                  <div className="row gap budget-card-actions">
                    <button
                      type="button"
                      className="btn small"
                      disabled={planSaving}
                      onClick={() => startEditPlan(row.budget)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={planSaving}
                      onClick={() => onClearPlan(row.budget.id)}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <h4 className="section-subtitle">Set / update spending plan</h4>
        <form className="form-grid" onSubmit={onSavePlan}>
          <label>
            Category
            <select
              value={planCategoryId}
              onChange={(e) => {
                const id = e.target.value;
                setPlanCategoryId(id);
                const existing = budgetsThisPeriod.find((b) => b.categoryId === id);
                if (existing) setPlanAmount(String(existing.amountNzd));
              }}
              required
            >
              <option value="">Select…</option>
              {expenseCategories.map((c) => {
                const existing = budgetsThisPeriod.find((b) => b.categoryId === c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {existing ? ` · planned ${formatNzd(existing.amountNzd)}` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Planned (NZD)
            <input
              type="number"
              min={0}
              step="0.01"
              value={planAmount}
              onChange={(e) => setPlanAmount(e.target.value)}
              placeholder="e.g. 450"
              required
            />
          </label>
          <div className="span-2 row gap">
            <button type="submit" className="btn primary" disabled={planSaving}>
              {planSaving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Income received · {monthLabel}</h3>
          <button type="button" className="btn primary" onClick={openAddIncomeForm}>
            + Add income
          </button>
        </div>
        <p className="section-desc">
          Money in this month: <strong>Add income</strong> (cash/crypto) plus bank-sync or manually
          tagged income-category credits (Salary, Mining, …). Linked Add-income bank rows are shown
          once. Matched to planned income categories above.
        </p>
        {incomeRecords.length === 0 ? (
          <p className="muted">
            No income in {monthLong}. Use Add income, or tag an inflow as Income after bank sync.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Detail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incomeRecords.map((r) => {
                  const fromTxn = r.origin === 'category_txn';
                  const typeLabel = r.kind === 'crypto' ? 'Crypto' : fromTxn ? 'Income txn' : 'Cash';
                  const badgeSource =
                    r.kind === 'crypto'
                      ? 'manual'
                      : fromTxn
                        ? (r.txnSource === 'akahu' ? 'akahu' : r.txnSource === 'bank' ? 'bank' : 'manual')
                        : 'bank';
                  return (
                  <tr key={r.id}>
                    <td className="muted small">{r.date}</td>
                    <td>{r.description || '—'}</td>
                    <td className="muted small">{r.categoryName || r.categoryId || '—'}</td>
                    <td>
                      <span className={`source-badge source-${badgeSource}`}>
                        {typeLabel}
                      </span>
                    </td>
                    <td className="amt-in money">{formatNzd(r.amountNzd)}</td>
                    <td className="muted small">
                      {r.kind === 'crypto'
                        ? `${r.cryptoAmount ?? '?'} ${r.cryptoAsset ?? ''}${
                            r.holdingName ? ` · ${r.holdingName}` : ''
                          }`
                        : fromTxn
                          ? `${r.accountName || r.accountId || '—'}${
                              r.txnSource ? ` · ${r.txnSource}` : ''
                            }`
                          : r.accountName || r.accountId || '—'}
                    </td>
                    <td>
                      {fromTxn ? (
                        <span className="muted small" title="Recategorise on the transaction to remove from income">
                          via txn
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn small danger"
                          aria-label={`Delete income ${r.description}`}
                          onClick={() => onDeleteIncome(r)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <DividendTracker placement="budget" />

      <section className="panel">
        <h3>Spend by category · {monthLabel}</h3>
        <CategorySpendChart
          rows={categorySpend}
          periodLabel={`${periodFrom} – ${periodTo}`}
          embedded
        />
      </section>

      <section className="panel">
        <h3>I owe</h3>
        <p className="section-desc">
          People or corporations you owe (NZD). Outstanding reduces net worth but does{' '}
          <strong>not</strong> appear on spend charts — only repayments on/after {SPENDING_FLOOR}
          (and linked bank txns categorised as <strong>Debt</strong>) count as spend this month.
        </p>
        <div className="grid cards budget-compare-summary">
          <div className="card">
            <p className="eyebrow">Outstanding total</p>
            <p className="stat-value">{formatNzd(debtOutstandingTotal)}</p>
            <p className="muted small">
              {debtPeople.length} creditor{debtPeople.length === 1 ? '' : 's'}
              {debtPeople.length > 0
                ? ` · ${debtPeople.filter((p) => p.kind === 'person').length} person` +
                  (debtPeople.filter((p) => p.kind === 'person').length === 1 ? '' : 's') +
                  ` · ${debtPeople.filter((p) => p.kind === 'corporation').length} corp`
                : ''}
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Repaid · {monthLabel}</p>
            <p className="stat-value">
              {formatNzd(
                debtRepayments
                  .filter((r) => r.date >= periodFrom && r.date <= periodTo)
                  .reduce((s, r) => s + Number(r.amountNzd || 0), 0),
              )}
            </p>
          </div>
        </div>
        <div className="row gap" style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowAddPerson((v) => !v)}
          >
            {showAddPerson ? 'Hide' : 'Add creditor'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={debtPeople.length === 0}
            onClick={() => {
              setShowRepayForm((v) => !v);
              if (!repayPersonId && debtPeople[0]) setRepayPersonId(debtPeople[0].id);
            }}
          >
            {showRepayForm ? 'Hide repayment' : 'Add repayment'}
          </button>
        </div>
        {showAddPerson && (
          <form className="form-grid" onSubmit={onAddDebtPerson} style={{ marginBottom: '1rem' }}>
            <label className="span-2">
              Creditor type
              <div className="chart-toggle" role="group" aria-label="Creditor type" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  className={`btn small${personKind === 'person' ? ' primary' : ''}`}
                  aria-pressed={personKind === 'person'}
                  onClick={() => setPersonKind('person')}
                >
                  Person
                </button>
                <button
                  type="button"
                  className={`btn small${personKind === 'corporation' ? ' primary' : ''}`}
                  aria-pressed={personKind === 'corporation'}
                  onClick={() => setPersonKind('corporation')}
                >
                  Corporation
                </button>
              </div>
            </label>
            <label>
              {personKind === 'corporation' ? 'Company name' : 'Name'}
              <input
                type="text"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder={personKind === 'corporation' ? 'Company you owe' : 'Who you owe'}
                required
              />
            </label>
            <label>
              Outstanding (NZD)
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={personOutstanding}
                onChange={(e) => setPersonOutstanding(e.target.value)}
                required
              />
            </label>
            <label className="span-2">
              Notes (optional)
              <input
                type="text"
                value={personNotes}
                onChange={(e) => setPersonNotes(e.target.value)}
                placeholder={
                  personKind === 'corporation'
                    ? 'e.g. BNZ credit card, IRD'
                    : 'e.g. loan for car'
                }
              />
            </label>
            <div className="span-2 row gap">
              <button type="submit" className="btn primary" disabled={debtSaving}>
                {debtSaving ? 'Saving…' : 'Save creditor'}
              </button>
            </div>
          </form>
        )}
        {showRepayForm && (
          <form className="form-grid" onSubmit={onAddRepayment} style={{ marginBottom: '1rem' }}>
            <label>
              Creditor
              <select
                value={repayPersonId}
                onChange={(e) => setRepayPersonId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {debtPeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {debtKindLabel(p.kind)} · {p.name} · {formatNzd(p.outstandingNzd)} owed
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount (NZD)
              <input
                type="number"
                step="0.01"
                min="0.01"
                inputMode="decimal"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                required
              />
            </label>
            <label>
              Date
              <input
                type="date"
                min={SPENDING_FLOOR}
                value={repayDate}
                onChange={(e) => setRepayDate(e.target.value)}
                required
              />
            </label>
            <label>
              Linked transaction (optional)
              <select value={repayTxnId} onChange={(e) => setRepayTxnId(e.target.value)}>
                <option value="">— None —</option>
                {txns
                  .filter((t) => Number(t.amount) < 0)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.date} · {t.description || '(no desc)'} · {formatNzd(Number(t.amount))}
                    </option>
                  ))}
              </select>
            </label>
            <label className="span-2">
              Notes (optional)
              <input
                type="text"
                value={repayNotes}
                onChange={(e) => setRepayNotes(e.target.value)}
              />
            </label>
            <div className="span-2 row gap">
              <button type="submit" className="btn primary" disabled={debtSaving}>
                {debtSaving ? 'Saving…' : 'Record repayment'}
              </button>
            </div>
          </form>
        )}
        {debtPeople.length === 0 ? (
          <p className="muted">
            No creditors yet. Add a person or corporation with an outstanding NZD balance.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table debt-people-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Outstanding</th>
                  <th>Repaid (all time)</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {debtPeople.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="muted small">{debtKindLabel(p.kind)}</span>
                    </td>
                    <td>{p.name}</td>
                    <td>{formatNzd(p.outstandingNzd)}</td>
                    <td>{formatNzd(p.repaidTotalNzd ?? 0)}</td>
                    <td className="muted small">{p.notes || '—'}</td>
                    <td>
                      <div className="row gap">
                        <button
                          type="button"
                          className="btn small"
                          onClick={() =>
                            setHistoryPersonId((cur) => (cur === p.id ? null : p.id))
                          }
                        >
                          {historyPersonId === p.id ? 'Hide' : 'History'}
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          aria-label={`Delete creditor ${p.name}`}
                          disabled={debtSaving}
                          onClick={() => onDeleteDebtPerson(p)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {historyPersonId && (
          <div style={{ marginTop: '0.75rem' }}>
            <h4 style={{ margin: '0 0 0.35rem' }}>
              Repayment history ·{' '}
              {debtPeople.find((p) => p.id === historyPersonId)?.name ?? historyPersonId}
            </h4>
            {debtRepayments.filter((r) => r.personId === historyPersonId).length === 0 ? (
              <p className="muted small">No repayments recorded yet for this creditor.</p>
            ) : (
              <ul className="plain-list">
                {debtRepayments
                  .filter((r) => r.personId === historyPersonId)
                  .map((r) => (
                    <li key={r.id}>
                      {r.date} · {formatNzd(r.amountNzd)}
                      {r.notes ? ` · ${r.notes}` : ''}
                      {r.transactionId ? ' · linked txn' : ''}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Categories</h3>
        <p className="section-desc">
          Labels used on transactions. Monthly plans live in Budget plan above.
        </p>
        {categories.length === 0 ? (
          <p className="muted">No categories loaded.</p>
        ) : (
          <div className="category-chip-row" role="list">
            {categories.map((c) => (
              <span key={c.id} className="category-chip" role="listitem">
                {c.name}
                {(() => {
                  const tag = categoryTypeShortTag(normalizeCategoryType(c.type, c.isIncome));
                  return tag ? <span className="chip-tag"> · {tag}</span> : null;
                })()}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Transactions · {monthLabel}</h3>
          <button type="button" className="btn primary" onClick={openAddTransactionForm}>
            + Add transaction
          </button>
        </div>
        {txns.length === 0 ? (
          <p className="muted">
            No transactions in {monthLong}. Sync bank, add a manual row, or pick another month.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Card</th>
                  <th>Charged account</th>
                  <th>Category</th>
                  <th>BTC</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id}>
                    <td className="muted small">{t.date}</td>
                    <td className="txn-desc" title={t.description || undefined}>{t.description}</td>
                    <td className={Number(t.amount) < 0 ? 'amt-out money' : 'amt-in money'}>
                      {formatNzd(Number(t.amount))}
                    </td>
                    <td className="muted small">{t.cardName || '—'}</td>
                    <td className="muted small">{t.accountName || t.accountId}</td>
                    <td>
                      <div className="category-cell">
                        <select
                          className="category-select"
                          value={t.categoryId ?? ''}
                          disabled={categorySavingId === t.id}
                          aria-label={`Category for ${t.description}`}
                          onChange={(e) => onCategoryChange(t.id, e.target.value)}
                        >
                          <option value="">— Uncategorised —</option>
                          {categories.map((c) => {
                            const t = normalizeCategoryType(c.type, c.isIncome);
                            const tag = categoryTypeShortTag(t);
                            return (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {tag ? ` (${tag})` : ''}
                              </option>
                            );
                          })}
                        </select>
                        {isCharityCategoryId(t.categoryId) && (
                          <button
                            type="button"
                            className="btn small"
                            title={t.receiptUrl ? 'View / replace charity receipt' : 'Upload charity receipt for PAYE'}
                            aria-label={`Charity receipt for ${t.description}`}
                            onClick={() => openCharityReceiptModal(t)}
                          >
                            {t.receiptUrl ? 'Receipt' : 'Add receipt'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      {t.affectsBtc ? (
                        <span className="muted small" title={t.btcHoldingName ?? t.btcHoldingId ?? 'BTC'}>
                          {t.btcDeltaApplied != null
                            ? `${t.btcDeltaApplied < 0 ? '−' : '+'}${Math.abs(t.btcDeltaApplied).toFixed(6)} BTC`
                            : 'BTC'}
                          {t.btcHoldingName ? ` · ${t.btcHoldingName}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`source-badge source-${t.source ?? 'manual'}`}>
                        {sourceLabel(t.source)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn small danger"
                        aria-label={`Delete ${t.description}`}
                        onClick={() => onDeleteTxn(t)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {charityModalTxn && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !charitySaving) closeCharityReceiptModal();
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="charity-receipt-title"
          >
            <div className="modal-header">
              <h3 id="charity-receipt-title">Charity receipt / PAYE</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                disabled={charitySaving}
                onClick={closeCharityReceiptModal}
              >
                ×
              </button>
            </div>
            <p className="section-desc">
              Upload the donation receipt for IR526 (image or PDF). Link the amount to{' '}
              <strong>PAYE charity donation tax credit</strong> so estimated take-home includes
              the 1/3 credit (capped at 1/3 of taxable income). Keep receipts for myIR year-end.
            </p>
            <form className="form-grid" onSubmit={onConfirmCharityReceipt}>
              <div className="span-2 muted small">
                <strong>{charityModalTxn.date}</strong>
                {' · '}
                {charityModalTxn.description || '(no description)'}
                {' · '}
                <span className="money">{formatNzd(Number(charityModalTxn.amount))}</span>
                {charityModalTxn.receiptUrl ? (
                  <>
                    {' · '}
                    <a href={charityModalTxn.receiptUrl} target="_blank" rel="noreferrer">
                      Current receipt
                    </a>
                  </>
                ) : null}
              </div>
              <label className="span-2">
                Receipt file
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
                  onChange={(e) => onPickCharityReceipt(e.target.files?.[0] ?? null)}
                  disabled={charitySaving}
                />
                {charityReceiptName && (
                  <span className="muted small">Selected: {charityReceiptName}</span>
                )}
              </label>
              <label className="span-2 field checkbox-field">
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={charityLinkPaye}
                    onChange={(e) => setCharityLinkPaye(e.target.checked)}
                    disabled={charitySaving}
                  />
                  Link amount to PAYE charity donation tax credit (IR526)
                </label>
              </label>
              <div className="span-2 row gap modal-actions">
                <button type="submit" className="btn primary" disabled={charitySaving}>
                  {charitySaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={charitySaving}
                  onClick={closeCharityReceiptModal}
                >
                  Skip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="panel">
        <h3>Import Google Wallet CSV</h3>
        <p className="section-desc">
          Optional — no live Wallet API. CSV columns: date, amount, description, card_name
          (see docs/IMPORT_FORMATS.md). Prefer bank sync + manual for Nexo/GoMining.
        </p>
        <div className="form-grid">
          <label>
            Charged account
            <select
              value={importAccountId}
              onChange={(e) => setImportAccountId(e.target.value)}
            >
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing || !importAccountId}
              onChange={(e) => onImportCsv(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      </section>



      {showIncomeModal && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeIncomeModal();
          }}
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-income-title"
          >
            <div className="modal-header">
              <h3 id="add-income-title">Add income</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                onClick={closeIncomeModal}
              >
                ×
              </button>
            </div>
            <p className="section-desc">
              Cash: NZD into a charged account (tagged with the income category). Crypto: ticker +
              quantity — NZD from live quote; holdings update by qty. Category feeds planned vs
              received (Salary, Mining, …).
            </p>
            <form className="form-grid" onSubmit={onAddIncome}>
              <label>
                Category
                <select
                  value={incCategoryId}
                  onChange={(e) => setIncCategoryId(e.target.value)}
                  required
                >
                  {incomeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select
                  value={incKind}
                  onChange={(e) =>
                    setIncKind(e.target.value === 'crypto' ? 'crypto' : 'cash')
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="crypto">Crypto</option>
                </select>
              </label>
              <label>
                Date
                <input
                  type="date"
                  min={SPENDING_FLOOR}
                  value={incDate}
                  onChange={(e) => setIncDate(e.target.value)}
                  required
                />
              </label>
              {incKind === 'cash' && (
                <label>
                  Amount (NZD)
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    placeholder="1500"
                    value={incAmount}
                    onChange={(e) => setIncAmount(e.target.value)}
                    required
                  />
                </label>
              )}
              <label className="span-2">
                Description
                <input
                  type="text"
                  placeholder="Pay / transfer / mining reward…"
                  value={incDesc}
                  onChange={(e) => setIncDesc(e.target.value)}
                />
              </label>
              {incKind === 'cash' ? (
                <label className="span-2">
                  Received into account
                  <select
                    value={incAccountId}
                    onChange={(e) => setIncAccountId(e.target.value)}
                    required
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.institution ? ` · ${a.institution}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Ticker
                    <input
                      type="text"
                      placeholder="BTC"
                      value={incCryptoAsset}
                      onChange={(e) => setIncCryptoAsset(e.target.value.toUpperCase())}
                      required
                    />
                  </label>
                  <label>
                    Quantity
                    <input
                      type="number"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      placeholder="0.01"
                      value={incCryptoAmount}
                      onChange={(e) => setIncCryptoAmount(e.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              <label className="span-2">
                Notes (optional)
                <input
                  type="text"
                  value={incNotes}
                  onChange={(e) => setIncNotes(e.target.value)}
                />
              </label>
              <div className="span-2 row gap modal-actions">
                <button type="submit" className="btn primary" disabled={incomeSaving}>
                  {incomeSaving ? 'Saving…' : 'Save income'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={closeIncomeModal}
                  disabled={incomeSaving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
