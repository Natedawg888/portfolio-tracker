/**
 * Budget — transactions from 1 Oct 2026 (Pacific/Auckland).
 * Bank: Akahu sync. Cards not on Akahu (Nexo, GoMining, etc.): first-class manual entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import {
  maybeAutoSyncBankTransactions,
  maybeAutoSyncPortfolio,
} from '../lib/akahuTxnAutoSync';
import { showQuietToast } from '../lib/quietToast';
import {
  beginPageRead,
  commitPageRead,
  invalidateAfterBudgetEdit,
  invalidateAfterExternalSync,
  portfolioSyncChanged,
  readPageCache,
  txnSyncChanged,
} from '../lib/pageDataCache';
import type { DebtPerson, DebtRepayment, IncomeKind, IncomeMonthSummary, IncomeRecord, PayeeSetting, Transaction, TransactionSource, TxnCategorySuggestions } from '../types';
import { aggregateCategorySpend } from '../components/CategorySpendChart';
import { CategoryBudgetList, type PlannedRow, type UnplannedRow } from '../components/budget/CategoryBudgetList';
import { CategoryManager } from '../components/CategoryManager';
import { categoryColourFor, validColour } from '../lib/categoryColours';
import {
  DEFAULT_MONTH,
  SPENDING_FLOOR,
  addMonths,
  budgetOverlapsMonth,
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
import { budgetUsed, monthProgress, spendInsight, type TxnFilter } from '../lib/budgetView';
import { BudgetHeader } from '../components/budget/BudgetHeader';
import { BudgetSummary } from '../components/budget/BudgetSummary';
import { IncomeCard, type IncomeRow } from '../components/budget/IncomeCard';
import { TriageCard } from '../components/budget/TriageCard';
import { TransactionList } from '../components/budget/TransactionList';
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
  colour?: string | null;
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

type SpendingBundle = {
  categories: Category[];
  budgets: Budget[];
  txns: Transaction[];
  accounts: CashAccount[];
  debtPeople: DebtPerson[];
  debtRepayments: DebtRepayment[];
  incomeRecords: IncomeRecord[];
  incomeSummary: IncomeMonthSummary | null;
  payees: PayeeSetting[];
  btcHoldings: Array<{ id: string; name: string; asset: string; amount: number }>;
  btcPrimaryId: string | null;
  suggestions: TxnCategorySuggestions[];
};

function spendingCacheKey(month: YearMonth): string {
  return `spending:${yearMonthKey(month)}`;
}

function payeeDraftFrom(payees: PayeeSetting[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const payee of payees) next[payee.name] = payee.categoryId ?? '';
  return next;
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
  const initialSpend = readPageCache<SpendingBundle>(spendingCacheKey(DEFAULT_MONTH));
  const initialCash = initialSpend?.accounts[0];
  const [categories, setCategories] = useState<Category[]>(initialSpend?.categories ?? []);
  const [budgets, setBudgets] = useState<Budget[]>(initialSpend?.budgets ?? []);
  const [txns, setTxns] = useState<Transaction[]>(initialSpend?.txns ?? []);
  const [accounts, setAccounts] = useState<CashAccount[]>(initialSpend?.accounts ?? []);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  /** Transactions list filter; "See transactions" on a category row sets a category filter. */
  const [txnFilter, setTxnFilter] = useState<TxnFilter>({ kind: 'all' });

  // Income
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>(initialSpend?.incomeRecords ?? []);
  const [incomeSummary, setIncomeSummary] = useState<IncomeMonthSummary | null>(initialSpend?.incomeSummary ?? null);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [incDate, setIncDate] = useState(todayAucklandYmd);
  const [incAmount, setIncAmount] = useState('');
  const [incKind, setIncKind] = useState<IncomeKind>('cash');
  const [incDesc, setIncDesc] = useState('');
  const [incAccountId, setIncAccountId] = useState(initialCash?.id ?? '');
  const [incCryptoAsset, setIncCryptoAsset] = useState('');
  const [incCryptoAmount, setIncCryptoAmount] = useState('');
  const [incNotes, setIncNotes] = useState('');
  const [incCategoryId, setIncCategoryId] = useState('cat-income');
  const [payees, setPayees] = useState<PayeeSetting[]>(initialSpend?.payees ?? []);
  const [suggestions, setSuggestions] = useState<TxnCategorySuggestions[]>(initialSpend?.suggestions ?? []);
  const [payeeCategoryDraft, setPayeeCategoryDraft] = useState<Record<string, string>>(() =>
    payeeDraftFrom(initialSpend?.payees ?? []),
  );
  const [payeeSavingName, setPayeeSavingName] = useState<string | null>(null);
  const [payeeSettingsOpen, setPayeeSettingsOpen] = useState(false);
  const [planIncomeSaving, setPlanIncomeSaving] = useState(false);

  // Manual / Wallet form state
  const [formSource, setFormSource] = useState<'bank' | 'manual' | 'google_wallet'>(
    initialCash ? (isBankishAccount(initialCash) ? 'bank' : 'manual') : 'bank',
  );
  const [formDate, setFormDate] = useState(todayAucklandYmd);
  const [formDesc, setFormDesc] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formKind, setFormKind] = useState<'debit' | 'credit'>('debit');
  const [formAccountId, setFormAccountId] = useState(initialCash?.id ?? '');
  /** Off for crypto Visa debit cards (Nexo, GoMining…): spend not charged to a bank account. */
  const [formCharged, setFormCharged] = useState(true);
  /** '' = automatic: the payee's saved category, else uncategorised. */
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formCardPreset, setFormCardPreset] = useState<string>('Nexo card');
  const [formCardCustom, setFormCardCustom] = useState('');
  const [importAccountId, setImportAccountId] = useState(initialCash?.id ?? '');
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
  const [formBtcHoldingId, setFormBtcHoldingId] = useState(
    initialSpend?.btcPrimaryId || initialSpend?.btcHoldings[0]?.id || '',
  );
  const [btcHoldings, setBtcHoldings] = useState<
    Array<{ id: string; name: string; asset: string; amount: number }>
  >(initialSpend?.btcHoldings ?? []);
  const [btcPrimaryId, setBtcPrimaryId] = useState<string | null>(initialSpend?.btcPrimaryId ?? null);

  // Debts (summary link; managed on the Debts page)
  const [debtPeople, setDebtPeople] = useState<DebtPerson[]>(initialSpend?.debtPeople ?? []);
  const [debtRepayments, setDebtRepayments] = useState<DebtRepayment[]>(initialSpend?.debtRepayments ?? []);

  // Budget plan (monthly planned spend per category)
  const [planSaving, setPlanSaving] = useState(false);

  const periodFrom = monthStart(selectedMonth);
  const periodTo = monthEnd(selectedMonth);
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

  const spendKey = spendingCacheKey(selectedMonth);
  const [appliedSpendKey, setAppliedSpendKey] = useState(spendKey);
  if (appliedSpendKey !== spendKey) {
    setAppliedSpendKey(spendKey);
    const next = readPageCache<SpendingBundle>(spendKey);
    if (next) {
      setCategories(next.categories);
      setBudgets(next.budgets);
      setTxns(next.txns);
      setAccounts(next.accounts);
      setDebtPeople(next.debtPeople);
      setDebtRepayments(next.debtRepayments);
      setIncomeRecords(next.incomeRecords);
      setIncomeSummary(next.incomeSummary);
      setPayees(next.payees);
      setBtcHoldings(next.btcHoldings);
      setBtcPrimaryId(next.btcPrimaryId);
      setSuggestions(next.suggestions ?? []);
      setError(null);
    }
  }

  const formAccountSeeded = useRef(Boolean(initialCash));
  const monthRef = useRef(selectedMonth);
  const txnsRef = useRef(txns);
  useEffect(() => {
    monthRef.current = selectedMonth;
  }, [selectedMonth]);
  useEffect(() => {
    txnsRef.current = txns;
  }, [txns]);

  const load = useCallback(async () => {
    const requested = selectedMonth;
    const stamp = beginPageRead(spendingCacheKey(requested));
    const [cats, buds, list, accts, btc, people, repayments, incomeList, incomeSum, payeeList, suggested] = await Promise.all([
      api.budgets.categories(),
      api.budgets.list(),
      api.accounts.transactions(periodFrom, periodTo),
      api.accounts.list(),
      api.accounts.btcHoldings().catch(() => ({ holdings: [], primaryId: null })),
      api.debts.people().catch(() => []),
      api.debts.repayments({ from: '2026-10-01' }).catch(() => []),
      api.income.list({ month: yearMonthKey(selectedMonth) }).catch(() => []),
      api.income.summary(yearMonthKey(selectedMonth)).catch(() => null),
      api.payees.list().catch(() => []),
      api.accounts.categorySuggestions(periodFrom, periodTo).catch(() => [] as TxnCategorySuggestions[]),
    ]);
    const nextPayees = payeeList as PayeeSetting[];
    const cash = (accts as CashAccount[]).slice().sort((a, b) => a.name.localeCompare(b.name));
    const bundle: SpendingBundle = {
      categories: cats as Category[],
      budgets: buds as Budget[],
      txns: list as Transaction[],
      accounts: cash,
      debtPeople: people as DebtPerson[],
      debtRepayments: repayments as DebtRepayment[],
      incomeRecords: incomeList as IncomeRecord[],
      incomeSummary: incomeSum as IncomeMonthSummary | null,
      payees: nextPayees,
      btcHoldings: btc.holdings ?? [],
      btcPrimaryId: btc.primaryId ?? null,
      suggestions: suggested,
    };
    if (!commitPageRead(stamp, bundle)) return;
    if (monthRef.current !== requested) return;
    setCategories(bundle.categories);
    setBudgets(bundle.budgets);
    setTxns(bundle.txns);
    setDebtPeople(bundle.debtPeople);
    setDebtRepayments(bundle.debtRepayments);
    setIncomeRecords(bundle.incomeRecords);
    setIncomeSummary(bundle.incomeSummary);
    setPayees(nextPayees);
    setPayeeCategoryDraft((prev) => {
      const next = { ...prev };
      for (const payee of nextPayees) {
        if (!(payee.name in next)) next[payee.name] = payee.categoryId ?? '';
      }
      return next;
    });
    setAccounts(cash);
    setBtcHoldings(bundle.btcHoldings);
    setBtcPrimaryId(bundle.btcPrimaryId);
    setSuggestions(bundle.suggestions);
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
    setError(null);
  }, [periodFrom, periodTo, selectedMonth]);

  const reloadAfterEdit = useCallback(async () => {
    invalidateAfterBudgetEdit();
    await load();
  }, [load]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);


  useEffect(() => {
    load().catch((e: Error) => {
      if (txnsRef.current.length > 0) {
        showQuietToast('Could not refresh budget — showing last data.', { kind: 'warn' });
        return;
      }
      setError(e.message);
    });
  }, [load]);

  // Silent background Akahu auto-sync once on Budget/Spending open / refresh.
  // Mount-only (loadRef) so month changes reload data without re-hitting Akahu,
  // and so load identity changes never cancel a sync mid-flight.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [txn, port] = await Promise.all([
          maybeAutoSyncBankTransactions(),
          maybeAutoSyncPortfolio(),
        ]);
        if (cancelled) return;
        if (
          (txn.ran && txn.result.ok && txnSyncChanged(txn.result)) ||
          (port.ran && port.result.ok && portfolioSyncChanged(port.result))
        ) {
          invalidateAfterExternalSync();
        }
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
    if (formCharged && !formAccountId) {
      setMsg('Choose the charged account (Kiwibank Main / Debit / etc.), or turn off “Charged to a bank account”.');
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
        (source === 'bank' && formCharged
          ? accounts.find((a) => a.id === formAccountId)?.name || 'Bank'
          : null);
      const description =
        formDesc.trim() ||
        (source === 'bank' ? cardName || '' : cardName || '(manual)');
      const created = (await api.accounts.createTransaction({
        accountId: formCharged ? formAccountId : null,
        date: formDate,
        description,
        amount,
        kind: formKind,
        cardName,
        source,
        affectsBtc: formUseBtc,
        btcHoldingId: formUseBtc ? formBtcHoldingId || null : null,
        // Omitted = server applies the payee's saved category.
        ...(formCategoryId ? { categoryId: formCategoryId } : {}),
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
      const chargedNote = formCharged
        ? `charged ${accounts.find((a) => a.id === formAccountId)?.name ?? formAccountId}`
        : 'not charged to a bank account';
      setMsg(`Saved · ${sourceLabel(source)} · ${chargedNote}${btcNote}`);
      setFormDesc('');
      setFormAmount('');
      setFormUseBtc(false);
      setFormCategoryId('');
      setShowTxnModal(false);
      await reloadAfterEdit();
      // Same as picking Charity in the list: offer the receipt / PAYE link.
      if (isCharityCategoryId(created.categoryId)) openCharityReceiptModal(created);
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
      await reloadAfterEdit();
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
      await reloadAfterEdit();
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
      await reloadAfterEdit();
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

  const actualIncomeNzd = incomeSummary?.actualNzd ?? 0;

  /** Selected-month spending (Pacific/Auckland) — sum of category spend rows. */
  const spentThisMonthNzd = useMemo(
    () => categorySpend.reduce((s, r) => s + r.spend, 0),
    [categorySpend],
  );

  const colourByCategory = new Map(
    categorySpend.filter((r) => r.categoryId).map((r) => [r.categoryId as string, r.colour]),
  );
  const plannedIds = new Set(budgetCompareRows.map((r) => r.categoryId));
  const plannedRows: PlannedRow[] = budgetCompareRows.map((r) => ({
    budgetId: r.budget.id,
    categoryId: r.categoryId,
    name: r.name,
    colour: colourByCategory.get(r.categoryId) ?? categoryColourFor(categories, r.categoryId),
    planned: r.planned,
    spent: r.spent,
  }));
  const unplannedRows: UnplannedRow[] = categorySpend
    .filter((r) => r.categoryId != null && !plannedIds.has(r.categoryId))
    .map((r) => ({ categoryId: r.categoryId as string, name: r.name, colour: r.colour, spent: r.spend }));
  const uncategorisedSpend = categorySpend.filter((r) => r.categoryId == null).reduce((s, r) => s + r.spend, 0);
  const addablePlanCategories = expenseCategories
    .filter((c) => !plannedIds.has(c.id) && !unplannedRows.some((u) => u.categoryId === c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  const uncategorisedTxns = txns.filter((t) => !t.categoryId);
  const repaidThisMonth = debtRepayments
    .filter((r) => r.date >= periodFrom && r.date <= periodTo)
    .reduce((s, r) => s + Number(r.amountNzd || 0), 0);
  const incomeRows: IncomeRow[] = (() => {
    const itemsByCat = new Map<string, IncomeRecord[]>();
    for (const rec of incomeRecords) {
      const key = rec.categoryId ?? '__none__';
      itemsByCat.set(key, [...(itemsByCat.get(key) ?? []), rec]);
    }
    const rows: IncomeRow[] = incomeCompareRows.map((row) => ({
      categoryId: row.categoryId,
      name: row.categoryName,
      received: row.actualNzd,
      planned: row.plannedNzd > 0 || row.plan ? row.plannedNzd : null,
      planId: row.plan?.id ?? null,
      items: itemsByCat.get(row.categoryId) ?? [],
    }));
    // Income whose category isn't in the summary (or has none) still shows, totalled from its items.
    for (const [key, items] of itemsByCat) {
      if (rows.some((row) => (row.categoryId ?? '__none__') === key)) continue;
      rows.push({
        categoryId: key === '__none__' ? null : key,
        name: key === '__none__' ? 'Other income' : (items[0].categoryName ?? categories.find((c) => c.id === key)?.name ?? key),
        received: items.reduce((s, r) => s + (Number(r.amountNzd) || 0), 0),
        planned: null,
        planId: null,
        items,
      });
    }
    return rows.sort((a, b) => b.received - a.received);
  })();
  const progress = monthProgress(selectedMonth, todayAucklandYmd());
  const used = budgetUsed(spentAgainstPlanTotal, plannedTotal);
  const insight = useMemo(
    () => spendInsight(categorySpend, new Set(budgetCompareRows.map((r) => r.categoryId))),
    [categorySpend, budgetCompareRows],
  );

  async function savePlan(categoryId: string, amount: number): Promise<boolean> {
    setMsg(null);
    setPlanSaving(true);
    try {
      await api.budgets.upsertPlan({ categoryId, yearMonth: monthKey, amountNzd: amount });
      const name = categories.find((c) => c.id === categoryId)?.name ?? categoryId;
      setMsg(`Plan saved · ${name} · ${formatNzd(amount)} for ${monthLong}`);
      await reloadAfterEdit();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    } finally {
      setPlanSaving(false);
    }
  }

  async function removePlan(budgetId: string, name: string): Promise<void> {
    if (!window.confirm(`Remove the ${monthLong} plan for ${name}?`)) return;
    setMsg(null);
    setPlanSaving(true);
    try {
      await api.budgets.remove(budgetId);
      setMsg(`Removed plan · ${name}`);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanSaving(false);
    }
  }

  function seeTransactions(categoryId: string) {
    setTxnFilter({ kind: 'category', categoryId });
    document.getElementById('budget-transactions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveIncomePlan(categoryId: string, amount: number): Promise<boolean> {
    setMsg(null);
    setPlanIncomeSaving(true);
    try {
      await api.income.upsertPlan({ yearMonth: monthKey, categoryId, amountNzd: amount });
      const name = incomeCategories.find((c) => c.id === categoryId)?.name ?? categoryId;
      setMsg(`Planned ${name} · ${formatNzd(amount)} for ${monthLong}`);
      await reloadAfterEdit();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    } finally {
      setPlanIncomeSaving(false);
    }
  }

  async function removeIncomePlan(planId: string, name: string): Promise<void> {
    if (!window.confirm(`Remove the ${monthLong} plan for ${name}?`)) return;
    setMsg(null);
    setPlanIncomeSaving(true);
    try {
      await api.income.removePlan(planId);
      setMsg(`Removed planned ${name}`);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPlanIncomeSaving(false);
    }
  }

  function incomeCategoryForPayeeName(name: string): string | null {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const match = payees.find((payee) => payee.name.trim().toLowerCase() === key);
    if (!match?.categoryId) return null;
    const category = categories.find((item) => item.id === match.categoryId);
    if (!category || !categoryTypeIsIncome(normalizeCategoryType(category.type, category.isIncome))) {
      return null;
    }
    return category.id;
  }

  async function onSavePayee(name: string) {
    setMsg(null);
    setPayeeSavingName(name);
    try {
      const saved = await api.payees.save({
        name,
        categoryId: payeeCategoryDraft[name] ? payeeCategoryDraft[name] : null,
      });
      setPayees((prev) => {
        const key = saved.name.trim().toLowerCase();
        const rest = prev.filter((payee) => payee.name.trim().toLowerCase() !== key);
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'));
      });
      setPayeeCategoryDraft((prev) => ({ ...prev, [saved.name]: saved.categoryId ?? '' }));
      setMsg(`Saved payee settings · ${saved.name}`);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPayeeSavingName(null);
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
      await reloadAfterEdit();
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
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  if (error && (!txns || txns.length === 0)) {
    return (
      <div className="panel warn budget-page">
        <h2 className="page-title">Budget</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="stack budget-page">
      <BudgetHeader
        monthLong={monthLong}
        progress={progress}
        canGoPrev={canGoPrev}
        onPrev={() => setSelectedMonth((m) => addMonths(m, -1))}
        onNext={() => setSelectedMonth((m) => addMonths(m, 1))}
        addActions={[
          { key: 'txn', label: 'Add transaction', onSelect: openAddTransactionForm },
          { key: 'income', label: 'Add income', onSelect: openAddIncomeForm },
          { key: 'csv', label: 'Import Google Wallet CSV', onSelect: () => setShowCsvModal(true) },
        ]}
      />
      <BudgetSummary
        moneyInNzd={incomeSummary ? actualIncomeNzd : null}
        moneyOutNzd={spentThisMonthNzd}
        used={used}
        progress={progress}
        insight={insight}
        floorLabel="1 Oct 2026"
      />
      {msg && <div className="banner" role="status">{msg}</div>}

      <TriageCard
        txns={uncategorisedTxns}
        suggestions={suggestions}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          tag: categoryTypeShortTag(normalizeCategoryType(c.type, c.isIncome)),
        }))}
        savingId={categorySavingId}
        onPick={(txnId, categoryId) => void onCategoryChange(txnId, categoryId)}
      />

      <CategoryBudgetList
        monthLong={monthLong}
        progress={progress}
        planned={plannedRows}
        unplanned={unplannedRows}
        uncategorisedSpend={uncategorisedSpend}
        addable={addablePlanCategories}
        saving={planSaving}
        onSavePlan={savePlan}
        onRemovePlan={removePlan}
        onSeeTransactions={seeTransactions}
        onManageCategories={() => setShowCategoriesModal(true)}
      />

      {showCategoriesModal && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCategoriesModal(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowCategoriesModal(false);
          }}
        >
          <div className="modal-dialog modal-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="manage-categories-title">
            <div className="modal-header">
              <h3 id="manage-categories-title">Manage categories</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                onClick={() => setShowCategoriesModal(false)}
              >
                ×
              </button>
            </div>
            <CategoryManager onChanged={reloadAfterEdit} />
          </div>
        </div>
      )}

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
              Pick the charged account so spend ties to a cash balance, or turn it off for a crypto
              Visa debit card that spends from crypto rather than a bank account.
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
                list="txn-payee-names"
                placeholder="Merchant / note"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
              <datalist id="txn-payee-names">
                {payees.map((payee) => (
                  <option key={payee.name} value={payee.name} />
                ))}
              </datalist>
              <span className="muted small">
                Leave Category on Automatic to use this payee’s saved category, or one guessed from
                your past transactions like it.
              </span>
            </label>
            <label className="span-2">
              Category
              <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)}>
                <option value="">Automatic (from this payee or similar past transactions)</option>
                {categories.map((c) => {
                  const tag = categoryTypeShortTag(normalizeCategoryType(c.type, c.isIncome));
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {tag ? ` (${tag})` : ''}
                    </option>
                  );
                })}
              </select>
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
            <label className="span-2 row gap" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={formCharged}
                onChange={(e) => {
                  setFormCharged(e.target.checked);
                  // A card that spends crypto isn't a bank transaction.
                  if (!e.target.checked && formSource === 'bank') setFormSource('manual');
                }}
              />
              <span>
                Charged to a bank account{' '}
                <span className="muted small">(turn off for crypto Visa debit cards — Nexo, GoMining, …)</span>
              </span>
            </label>
            {formCharged ? (
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
            ) : (
              <p className="span-2 muted small">
                Not charged to a bank account: the spend still counts in budgets and categories, but no
                cash balance changes. Tick “Pays with BTC” to take it out of a BTC holding instead.
              </p>
            )}
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

      <IncomeCard
        monthLong={monthLong}
        progress={progress}
        totalReceived={incomeSummary ? actualIncomeNzd : null}
        rows={incomeRows}
        expectedPay={
          incomeSummary?.expectedPay
            ? {
                monthlyNetNzd: incomeSummary.expectedPay.monthlyNetNzd,
                names: incomeSummary.expectedPay.sources.map((src) => src.name),
              }
            : null
        }
        addable={incomeCategories
          .filter((c) => !incomeRows.some((row) => row.categoryId === c.id))
          .map((c) => ({ id: c.id, name: c.name }))}
        saving={planIncomeSaving}
        onSavePlan={saveIncomePlan}
        onRemovePlan={removeIncomePlan}
        onDeleteItem={(rec) => void onDeleteIncome(rec)}
        onAddIncome={openAddIncomeForm}
      />

      <Link to="/debts" className="card debt-link-card">
        {debtPeople.length === 0 ? (
          <span>No debts recorded</span>
        ) : (
          <span>
            You owe <strong className="money">{formatNzd(debtOutstandingTotal)}</strong>
            {' · '}
            {formatNzd(repaidThisMonth)} repaid this month
            {' · '}
            <span className="muted">
              {debtPeople.slice(0, 3).map((p) => p.name).join(', ')}
              {debtPeople.length > 3 ? ` +${debtPeople.length - 3} more` : ''}
            </span>
          </span>
        )}
        <span className="debt-link-go">
          Debts <span aria-hidden="true">→</span>
        </span>
      </Link>

      <TransactionList
        monthLong={monthLong}
        txns={txns}
        categories={categories.map((c) => {
          const type = normalizeCategoryType(c.type, c.isIncome);
          return {
            id: c.id,
            name: c.name,
            type,
            tag: categoryTypeShortTag(type),
            colour: colourByCategory.get(c.id) ?? validColour(c.colour),
          };
        })}
        filter={txnFilter}
        onFilterChange={setTxnFilter}
        savingId={categorySavingId}
        onCategoryChange={(txnId, categoryId) => void onCategoryChange(txnId, categoryId)}
        onDelete={(t) => void onDeleteTxn(t)}
        onCharityReceipt={openCharityReceiptModal}
        onAdd={openAddTransactionForm}
      />

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

      {showCsvModal && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importing) setShowCsvModal(false);
          }}
        >
          <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
            <div className="modal-header">
              <h3 id="csv-import-title">Import Google Wallet CSV</h3>
              <button
                type="button"
                className="btn small modal-close"
                aria-label="Close"
                disabled={importing}
                onClick={() => setShowCsvModal(false)}
              >
                ×
              </button>
            </div>
            <p className="section-desc">
              Columns: date, amount, description, card_name (see docs/IMPORT_FORMATS.md). Rows before 1 Oct 2026 and
              duplicates are skipped.
            </p>
            <div className="form-grid">
              <label>
                Charged account
                <select value={importAccountId} onChange={(e) => setImportAccountId(e.target.value)}>
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
                  onChange={(e) => {
                    void onImportCsv(e.target.files?.[0] ?? null).then(() => setShowCsvModal(false));
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}

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
                Payee
                <input
                  type="text"
                  list="income-payee-names"
                  placeholder="Employer, holding, or other payer"
                  value={incDesc}
                  onChange={(e) => {
                    const next = e.target.value;
                    setIncDesc(next);
                    const categoryId = incomeCategoryForPayeeName(next);
                    if (categoryId) setIncCategoryId(categoryId);
                  }}
                />
                <datalist id="income-payee-names">
                  {payees.map((payee) => (
                    <option key={payee.name} value={payee.name} />
                  ))}
                </datalist>
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

      <section className={`panel payee-settings-panel${payeeSettingsOpen ? ' is-open' : ''}`}>
        <h3>
          <button
            type="button"
            className="payee-settings-toggle"
            aria-expanded={payeeSettingsOpen}
            aria-controls="payee-settings-body"
            onClick={() => setPayeeSettingsOpen((open) => !open)}
          >
            <span className="payee-settings-title">
              Payee settings
              <span className="payee-settings-count muted">({payees.length})</span>
            </span>
            <span className="payee-settings-chevron" aria-hidden="true" />
          </button>
        </h3>
        <div id="payee-settings-body" hidden={!payeeSettingsOpen}>
          <p className="section-desc">
            A payee you have used, including a dividend payer, can keep a category you already have.
            That category is filled in the next time you use the payee. Income uses it when the
            category is an income category. Transactions use it when the payee is the description.
            This is a personal record, not advice.
          </p>
          {payees.length === 0 ? (
            <p className="muted">
              No payees yet. Record income, a transaction, or a dividend and the name is listed here.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th>Category</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payees.map((payee) => (
                    <tr key={payee.name}>
                      <td>{payee.name}</td>
                      <td>
                        <select
                          aria-label={`Category for ${payee.name}`}
                          value={payeeCategoryDraft[payee.name] ?? payee.categoryId ?? ''}
                          onChange={(e) =>
                            setPayeeCategoryDraft((prev) => ({ ...prev, [payee.name]: e.target.value }))
                          }
                        >
                          <option value="">No saved category</option>
                          {categories.map((c) => {
                            const tag = categoryTypeShortTag(normalizeCategoryType(c.type, c.isIncome));
                            return (
                              <option key={c.id} value={c.id}>
                                {c.name}
                                {tag ? ` (${tag})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn small"
                          disabled={payeeSavingName === payee.name}
                          onClick={() => onSavePayee(payee.name)}
                        >
                          {payeeSavingName === payee.name ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
