import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type { StockItemView } from '../lib/stock.ts';
import type { BillKind, DeliveryTreatment, Supplier, SupplierBill } from '../lib/suppliers.ts';
import type { UsageMode } from '../lib/usageMode.ts';
import { isMoneyHidden, MONEY_MASK } from '../lib/privacy';
import type { AdsConfig } from '../lib/ads';
import type { EconomicCycleResponse, EconomicScenarioResult, PhaseNewsResponse } from '../types/economy.ts';
import type {
  DividendDashboard,
  DividendEvent,
  DividendReinvestResponse,
  DividendWriteBody,
  ForecastReinvestResponse,
} from '../types/dividends.ts';
import type {
  Business,
  BusinessEmployee,
  BusinessEmployeeWriteBody,
  StockAdjustmentWriteBody,
  EarningsResponse,
  ProfitLoss,
  GstItem,
  GstReturnView,
  HolidaysResponse,
  StockBatchWriteBody,
  StockItemWriteBody,
  BusinessAsset,
  BusinessAssetWriteBody,
  BusinessClientView,
  BusinessMeeting,
  CalendarResponse,
  MeetingReminder,
  MeetingStatus,
  MeetingWriteBody,
  BusinessDetail,
  BusinessBudgetCategory,
  BusinessBudgetView,
  BusinessSale,
  BusinessWagePayment,
  BusinessInvitePreview,
  BusinessMemberRole,
  BusinessMembersView,
  SharedBusiness,
  BusinessListResponse,
  BusinessMoneyItem,
  BusinessMovementKind,
  BusinessWriteBody,
  InvoiceClientWriteBody,
  DebtPerson,
  DebtSummary,
  DebtWriteBody,
  Donation,
  DonationSummary,
  DonationWriteBody,
  HomeMonthSnapshot,
  NewsFeedResponse,
  NewsUserState,
  ProjectionResponse,
  PayeeSetting,
  PaySource,
  RecurringItem,
  HealthScoreResponse,
  RecurringListResponse,
  Warranty,
  WarrantyListResponse,
  RentalEntry,
  HouseholdView,
  HouseholdDashboard,
  HouseholdShareable,
  HouseholdShareKind,
  HouseholdSplitMethod,
  HouseholdSplitsView,
  HouseholdPayeView,
  Payslip,
  Vehicle,
  BondWriteBody,
  BondsView,
  CommoditiesView,
  CommodityWriteBody,
  CryptoImportCandidate,
  CryptoSummary,
  CryptoTxn,
  CryptoTxnBody,
  DefiPosition,
  DefiView,
  VehicleWriteBody,
  VehiclesView,
  PayslipWriteBody,
  PayslipsView,
  HouseholdFamilyView,
  HouseholdPayInputs,
  HouseholdWhatIfChange,
  HouseholdWhatIfResult,
  HouseholdRole,
  ShoppingCompareResponse,
  ShoppingListDetail,
  ShoppingListSummary,
  ShoppingPrefs,
  ShoppingStore,
  RentalListResponse,
  RentalProperty,
  RentalRoom,
  RentalTenancy,
  WarrantyPurchase,
  BusinessProfile,
  Invoice,
  InvoiceClient,
  InvoiceListResponse,
  PublicInvoice,
  SavingsGoal,
  SavingsGoalWriteBody,
  Wallet,
  WalletNetwork,
  WalletNetworkInfo,
  WalletsValuationResponse,
  TxnCategorySuggestions,
} from '../types/index.ts';
import type { OutputPaySourceInputs } from '../lib/outputPayCalc.ts';
import {
  addParam,
  growParam,
  MINING_PLAN_FIELDS,
  MINING_REWARDS_TO_PARAM,
  ADD_GROWTH_PARAM,
  returnParam,
  type MiningPlan,
  type ProjectionClassKey,
  type SavedProjectionAssumptions,
} from '../lib/projectionClasses.ts';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  code?: string;
  body: string;
  constructor(status: number, body: string) {
    let message = body || `HTTP ${status}`;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: string; code?: string };
      if (parsed?.error) message = parsed.error;
      if (parsed?.code) code = parsed.code;
    } catch {
      /* plain text */
    }
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type AuthUnauthorizedHandler = () => void;
let onUnauthorized: AuthUnauthorizedHandler | null = null;

/** Register a handler for 401 responses (clears client session / redirects). */
export function setUnauthorizedHandler(handler: AuthUnauthorizedHandler | null) {
  onUnauthorized = handler;
}

export type RecurringWriteBody = {
  name: string;
  kind: RecurringItem['kind'];
  amountNzd: number;
  cadence: RecurringItem['cadence'];
  nextDue: string;
  categoryId: string | null;
  notes: string;
};

export type WarrantyWriteBody = {
  itemName: string;
  retailer: string;
  priceNzd: number | null;
  startsOn: string;
  endsOn: string;
  transactionId: string | null;
  notes: string;
};

export type RentalPropertyWriteBody = Pick<
  RentalProperty,
  'name' | 'address' | 'notes' | 'letType' | 'ownHome' | 'purchaseDate' | 'purchasePrice' | 'saleAgreementDate' | 'salePrice' | 'saleCosts'
>;

export type RentalEntryWriteBody = {
  propertyId: string;
  date: string;
  kind: RentalEntry['kind'];
  category: RentalEntry['category'];
  amountNzd: number;
  description: string;
  addToMoney: boolean;
  roomId: string | null;
  shared: boolean;
};

export type RentalRoomWriteBody = { propertyId: string; name: string; note: string; share: number };

export type RentalTenancyWriteBody = Omit<RentalTenancy, 'id' | 'createdAt' | 'updatedAt'>;

/** Draft invoice fields sent to the API. Totals are always computed by the server. */
export type InvoiceWriteBody = {
  /** Omitted → the default business. */
  businessId?: string | null;
  number?: string;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientReference: string;
  issueDate: string;
  duePreset: string;
  dueDate: string | null;
  reference: string;
  gstMode: 'none' | 'exclusive' | 'inclusive';
  withholdingRatePct: number | null;
  notes: string;
  paymentInstructions: string;
  lines: { description: string; quantity: number; unit: string; rate: number }[];
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  /** False until all required signup steps, including the Akahu checkpoint, are done. */
  onboardingComplete: boolean;
  onboarding: {
    assetClassesDone: boolean;
    budgetCategoriesDone: boolean;
    akahuStepDone: boolean;
  };
  /** What the account uses KoruLedger for (KAN-124); personal when never chosen. */
  usageMode: UsageMode;
  /** False until signup (or Settings) has asked; the signup flow shows the question. */
  usageModeChosen: boolean;
  /** New email waiting for its confirmation link to be opened. */
  pendingEmail?: string | null;
  /** True when changing email sends a confirmation link (email is set up on the server). */
  emailChangeConfirms?: boolean;
};

/** An account signed in on this browser (account switcher). */
export type RememberedAccount = {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  current: boolean;
};

/** Settings → Security (KAN-16). */
export type SsoProvider = { id: 'google' | 'apple' | 'microsoft'; label: string };

export type AccountSecurity = {
  hasPassword: boolean;
  /** Last sign-in that used the password (from the sign-in log), if any. */
  passwordLastUsedAt: string | null;
  /** Sensitive changes skip the password prompt until then. */
  recentSignInUntil: string | null;
  identities: Array<{ id: string; provider: string; label: string; email: string | null; createdAt: string; lastUsedAt: string | null }>;
  ssoProviders: SsoProvider[];
  twoFactor: { enabled: boolean; enabledAt: string | null; backupCodesRemaining: number };
  sessions: Array<{
    id: string;
    deviceLabel: string | null;
    createdAt: string;
    lastSeenAt: string | null;
    expiresAt: string;
    persistent: boolean;
    current: boolean;
    /** The trusted device on the same browser, when known. */
    trustedDeviceId: string | null;
  }>;
  trustedDevices: Array<{
    id: string;
    label: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string;
    current: boolean;
  }>;
  passkeys: PasskeyInfo[];
  recentSignIns: AuthEvent[];
  /** Recent sign-ins from a device not seen before, not yet reviewed ("Was this you?"). */
  newSignIns: AuthEvent[];
};

/** A sign-in or passkey change from the account's sign-in log. */
export type AuthEvent = {
  id: string;
  kind: 'sign_in' | 'passkey_added' | 'passkey_removed';
  method: string | null;
  /** google / apple / microsoft (null for other methods and for older events). */
  provider: string | null;
  /** The passkey used, by its current name (null when removed or not a passkey). */
  passkeyName: string | null;
  deviceLabel: string | null;
  createdAt: string;
  signedIn: boolean;
  current: boolean;
  newDevice: boolean;
  reviewed: boolean;
};

/** A passkey on the account (KAN-75). */
export type PasskeyInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

export const api = {
  auth: {
    status: () =>
      req<{
        hasUsers: boolean;
        userCount: number;
        needsSetup: boolean;
        dataClaimed: boolean;
        firstSignupClaimsData: boolean;
      }>('/auth/status'),
    me: () => req<{ user: AuthUser | null }>('/auth/me'),
    register: (body: { email: string; password: string; firstName: string; lastName: string; displayName?: string }) =>
      req<{
        user: AuthUser;
        claimedExistingData: boolean;
        message: string;
      }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
    login: (body: { email: string; password: string; remember?: boolean }) =>
      req<
        | { user: AuthUser; twoFactorRequired?: false }
        | { twoFactorRequired: true; challenge: string; expiresAt: string; methods: Array<'totp' | 'backup_code'> }
      >('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    loginTwoFactor: (body: { challenge: string; code: string; trustDevice: boolean }) =>
      req<{ user: AuthUser; usedBackupCode?: boolean; backupCodesRemaining?: number }>('/auth/login/2fa', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    security: () => req<AccountSecurity>('/auth/security'),
    // Passkeys (KAN-75). Options and responses are WebAuthn JSON, passed through as is.
    passkeyRegisterOptions: (body: { password?: string }) =>
      req<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/register/options', { method: 'POST', body: JSON.stringify(body) }),
    passkeyRegisterVerify: (body: { response: RegistrationResponseJSON; name?: string }) =>
      req<PasskeyInfo>('/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(body) }),
    passkeyLoginOptions: (body: { remember: boolean }) =>
      req<PublicKeyCredentialRequestOptionsJSON>('/auth/passkeys/login/options', { method: 'POST', body: JSON.stringify(body) }),
    passkeyLoginVerify: (body: { response: AuthenticationResponseJSON }) =>
      req<{ user: AuthUser }>('/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify(body) }),
    renamePasskey: (id: string, name: string) =>
      req<PasskeyInfo>(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    removePasskey: (id: string, password?: string) =>
      req<{ ok: boolean; sessionsEnded: number }>(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ password }) }),
    ssoProviders: () => req<{ providers: SsoProvider[] }>('/auth/sso/providers'),
    disconnectIdentity: (id: string, password?: string) =>
      req<{ ok: boolean }>(`/auth/identities/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ password }) }),
    twoFactorSetup: (password: string) =>
      req<{ secret: string; otpauthUri: string; qrSvg: string }>('/auth/2fa/setup', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    twoFactorEnable: (code: string) =>
      req<{ ok: boolean; backupCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
    twoFactorDisable: (body: { password: string; code: string }) =>
      req<{ ok: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify(body) }),
    twoFactorBackupCodes: (body: { password: string; code: string }) =>
      req<{ ok: boolean; backupCodes: string[] }>('/auth/2fa/backup-codes', { method: 'POST', body: JSON.stringify(body) }),
    revokeSession: (id: string) => req<{ ok: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    revokeOtherSessions: () => req<{ ok: boolean; signedOut: number }>('/auth/sessions/revoke-others', { method: 'POST', body: '{}' }),
    revokeTrustedDevice: (id: string) =>
      req<{ ok: boolean }>(`/auth/trusted-devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    revokeAllTrustedDevices: () => req<{ ok: boolean; revoked: number }>('/auth/trusted-devices', { method: 'DELETE' }),
    markSignInReviewed: (id: string) =>
      req<{ ok: boolean }>(`/auth/sign-ins/${encodeURIComponent(id)}/reviewed`, { method: 'POST', body: '{}' }),
    secureAccount: () => req<{ ok: boolean; signedOut: number; untrusted: number }>('/auth/secure-account', { method: 'POST', body: '{}' }),
    logout: () => req<{ ok: boolean; switchedToUserId: string | null }>('/auth/logout', { method: 'POST', body: '{}' }),
    logoutAll: () => req<{ ok: boolean; signedOut: number }>('/auth/logout-all', { method: 'POST', body: '{}' }),
    accounts: () => req<{ accounts: RememberedAccount[] }>('/auth/accounts'),
    switchAccount: (userId: string) =>
      req<{ ok: boolean; userId: string }>('/auth/accounts/switch', { method: 'POST', body: JSON.stringify({ userId }) }),
    updateProfile: (body: { firstName?: string | null; lastName?: string | null; displayName?: string | null }) =>
      req<{ user: AuthUser }>('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }),
    uploadAvatar: (photoBase64: string) =>
      req<{ user: AuthUser }>('/auth/avatar', {
        method: 'POST',
        body: JSON.stringify({ photoBase64 }),
      }),
    removeAvatar: () =>
      req<{ user: AuthUser }>('/auth/avatar', { method: 'DELETE' }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      req<{ ok: boolean; message: string }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    changeEmail: (body: { currentPassword: string; email: string }) =>
      req<{ user: AuthUser; message: string; pendingEmail?: string }>('/auth/change-email', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    cancelEmailChange: () => req<{ ok: true }>('/auth/change-email/cancel', { method: 'POST' }),
    /** From the emailed link (/confirm-email#token=…); works signed out. */
    confirmEmail: (token: string) =>
      req<{ ok: true; email: string }>('/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token }) }),
    /** "Download a copy": a JSON file of everything stored for this account. */
    exportUrl: () => `${BASE}/auth/export`,
    deleteAccount: (body: { password: string; confirm: 'DELETE' }) =>
      req<{
        ok: boolean;
        message: string;
        deleted: {
          userId: string;
          sessions: number;
          akahuConnections: number;
          scopedTables: Record<string, number>;
          holdingPhotos: number;
          wasDataOwner: boolean;
        };
        sharedDataRemaining: string[];
      }>('/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  health: () => req<{ ok: boolean }>('/health'),
  netWorth: () => req<Record<string, unknown>>('/net-worth'),
  home: {
    /**
     * This month's budget income, spending, savings, and savings rate.
     * Omit month for the current Pacific/Auckland month. savingsRate is a fraction of income.
     */
    snapshot: (month?: string) =>
      req<HomeMonthSnapshot>(
        month ? `/home/snapshot?month=${encodeURIComponent(month)}` : '/home/snapshot',
      ),
  },
  /**
   * Forward net worth and savings from this user's balances and cashflow.
   * months defaults to 12 (1–360). annualReturnPercent and monthlySavingNzd
   * are optional; omitted values are labelled in assumptions.
   */
  projections: {
    get: (query?: {
      months?: number;
      savingWindowMonths?: number;
      annualReturnPercent?: number;
      monthlySavingNzd?: number;
      classReturns?: Partial<Record<ProjectionClassKey, number>>;
      classAdds?: Partial<Record<ProjectionClassKey, number>>;
      classGrowth?: Partial<Record<ProjectionClassKey, number>>;
      mining?: MiningPlan;
      additionGrowthPct?: number;
    }) => {
      const params = new URLSearchParams();
      if (query?.additionGrowthPct != null) params.set(ADD_GROWTH_PARAM, String(query.additionGrowthPct));
      for (const [key, f] of Object.entries(MINING_PLAN_FIELDS)) {
        const v = query?.mining?.[key as keyof typeof MINING_PLAN_FIELDS];
        if (v != null) params.set(f.param, String(v));
      }
      if (query?.mining?.rewardsTo) params.set(MINING_REWARDS_TO_PARAM, query.mining.rewardsTo);
      for (const [key, value] of Object.entries(query?.classReturns ?? {})) {
        if (value != null) params.set(returnParam(key as ProjectionClassKey), String(value));
      }
      for (const [key, value] of Object.entries(query?.classAdds ?? {})) {
        if (value != null) params.set(addParam(key as ProjectionClassKey), String(value));
      }
      for (const [key, value] of Object.entries(query?.classGrowth ?? {})) {
        if (value != null) params.set(growParam(key as ProjectionClassKey), String(value));
      }
      if (query?.months != null) params.set('months', String(query.months));
      if (query?.savingWindowMonths != null) {
        params.set('savingWindowMonths', String(query.savingWindowMonths));
      }
      if (query?.annualReturnPercent != null) {
        params.set('annualReturnPercent', String(query.annualReturnPercent));
      }
      if (query?.monthlySavingNzd != null) {
        params.set('monthlySavingNzd', String(query.monthlySavingNzd));
      }
      const qs = params.toString();
      return req<ProjectionResponse>(`/projections${qs ? `?${qs}` : ''}`);
    },
    savedAssumptions: () => req<SavedProjectionAssumptions>('/projections/assumptions'),
    saveAssumptions: (body: SavedProjectionAssumptions) =>
      req<SavedProjectionAssumptions>('/projections/assumptions', { method: 'PUT', body: JSON.stringify(body) }),
  },
  snapshots: {
    list: (year?: number) =>
      req<
        Array<{
          id: string;
          takenAt: string;
          totalNzd: number;
          breakdown: {
            byClass?: Record<string, number | null>;
            holdings?: Array<{
              id: string;
              label: string;
              assetClass: string;
              valueNzd: number;
            }>;
            asOf?: string;
            quoteNote?: string;
          };
          notes: string | null;
        }>
      >(year != null ? `/snapshots?year=${year}` : '/snapshots'),
    take: (notes?: string) =>
      req<{
        id: string;
        takenAt: string;
        totalNzd: number;
        breakdown: unknown;
        notes: string | null;
      }>('/snapshots', {
        method: 'POST',
        body: JSON.stringify(notes ? { notes } : {}),
      }),
  },
  holdings: {
    list: () => req<unknown[]>('/holdings'),
    create: (body: unknown) => req('/holdings', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: unknown) =>
      req(`/holdings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => req(`/holdings/${id}`, { method: 'DELETE' }),
    refreshValue: (id: string) =>
      req(`/holdings/${id}/refresh-value`, { method: 'POST', body: '{}' }),
    refreshGominingValues: () =>
      req<{
        ok: boolean;
        total: number;
        appliedCount: number;
        failedCount?: number;
        availableEeBands?: number[];
        source: string;
        computation: string;
        note?: string | null;
        results: Array<{
          holdingId: string;
          minerName?: string;
          hashrateThs?: number;
          energyEfficiencyWth?: number | null;
          estimatedValueNzd: number | null;
          usdPerTh: number | null;
          applied: boolean;
          failed?: boolean;
          failureCode?: string | null;
          failReason?: string | null;
          availableEeBands?: number[];
          matchMode?: string;
          quote?: { status?: string; message?: string | null };
        }>;
      }>('/holdings/refresh-gomining-values', { method: 'POST', body: '{}' }),
    refreshForexValues: () =>
      req<{
        ok: boolean;
        totalCurrencies: number;
        appliedCount: number;
        failedCount: number;
        source: string;
        results: Array<{
          currency: string;
          rate: number | null;
          status: string;
          source: string;
          asOf: string | null;
          message: string | null;
          applied: boolean;
        }>;
        holdings: Array<{
          holdingId: string;
          currency: unknown;
          amount: unknown;
          marketValueNzd: number | null;
          unitPriceNzd: number | null;
        }>;
      }>('/holdings/refresh-forex-values', { method: 'POST', body: '{}' }),
    refreshCollectablesValues: () =>
      req<{
        ok: boolean;
        total: number;
        appliedCount: number;
        failedCount: number;
        results: Array<Record<string, unknown>>;
      }>('/holdings/refresh-collectables-values', { method: 'POST', body: '{}' }),
    importCollectablesCsv: (csv: string) =>
      req<{
        ok: boolean;
        created: number;
        quotedOk: number;
        fxConverted?: number;
        totalRows: number;
        columns: string;
        results: Array<Record<string, unknown>>;
      }>('/holdings/import-collectables-csv', {
        method: 'POST',
        body: JSON.stringify({ csv }),
      }),
    uploadPhoto: (id: string, photoBase64: string) =>
      req(`/holdings/${id}/photo`, {
        method: 'POST',
        body: JSON.stringify({ photoBase64 }),
      }),
  },
  accounts: {
    list: () => req<unknown[]>('/accounts'),
    create: (body: unknown) => req('/accounts', { method: 'POST', body: JSON.stringify(body) }),
    transactions: (from = '2026-10-01', to?: string) => {
      const q = new URLSearchParams({ from });
      if (to) q.set('to', to);
      return req<unknown[]>(`/accounts/transactions?${q}`);
    },
    /** One-tap category suggestions for uncategorised transactions in the range (Budget triage). */
    categorySuggestions: (from: string, to: string) =>
      req<TxnCategorySuggestions[]>(
        `/accounts/transactions/suggestions?${new URLSearchParams({ from, to })}`,
      ),
    btcHoldings: () =>
      req<{
        holdings: Array<{
          id: string;
          name: string;
          asset: string;
          amount: number;
          source: string | null;
          notes: string | null;
        }>;
        primaryId: string | null;
      }>('/accounts/btc-holdings'),
    createTransaction: (body: {
      /** Null = not charged to a bank account (crypto Visa debit card). */
      accountId: string | null;
      date: string;
      description: string;
      amount: number;
      kind?: string;
      cardName?: string | null;
      source?: string;
      merchant?: string | null;
      categoryId?: string | null;
      currency?: string;
      externalId?: string | null;
      affectsBtc?: boolean;
      btcHoldingId?: string | null;
    }) =>
      req('/accounts/transactions', { method: 'POST', body: JSON.stringify(body) }),
    updateTransaction: (
      id: string,
      body: {
        categoryId?: string | null;
        source?: string;
        description?: string;
        cardName?: string | null;
        affectsBtc?: boolean;
        btcHoldingId?: string | null;
      },
    ) =>
      req(`/accounts/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deleteTransaction: (id: string) =>
      req<{ ok: boolean; id: string }>(`/accounts/transactions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    uploadTransactionReceipt: (id: string, receiptBase64: string) =>
      req(`/accounts/transactions/${encodeURIComponent(id)}/receipt`, {
        method: 'POST',
        body: JSON.stringify({ receiptBase64 }),
      }),
    deleteTransactionReceipt: (id: string) =>
      req(`/accounts/transactions/${encodeURIComponent(id)}/receipt`, {
        method: 'DELETE',
      }),
    importWalletCsv: (csvText: string, accountId: string, source: 'google_wallet' | 'csv' = 'google_wallet') =>
      req<{
        ok: boolean;
        inserted: number;
        skippedDup: number;
        skippedBefore: number;
        parseErrors: Array<{ row?: number; message: string }>;
        headers?: string[];
        sourceLabel: string;
        accountId: string;
        accountName: string;
      }>('/accounts/transactions/import-wallet-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText, accountId, source }),
      }),
  },
  debts: {
    people: () => req<DebtPerson[]>('/debts/people'),
    summary: (year?: number) =>
      req<DebtSummary>(year != null ? `/debts/summary?year=${year}` : '/debts/summary'),
    createPerson: (body: DebtWriteBody & { name: string; outstandingNzd: number }) =>
      req<DebtPerson>('/debts/people', { method: 'POST', body: JSON.stringify(body) }),
    updatePerson: (id: string, body: DebtWriteBody) =>
      req<DebtPerson>(`/debts/people/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    deletePerson: (id: string) =>
      req<{ ok: boolean; id: string }>(`/debts/people/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    repayments: (opts?: { personId?: string; from?: string; to?: string; year?: number }) => {
      const q = new URLSearchParams();
      if (opts?.personId) q.set('personId', opts.personId);
      if (opts?.from) q.set('from', opts.from);
      if (opts?.to) q.set('to', opts.to);
      if (opts?.year != null) q.set('year', String(opts.year));
      const qs = q.toString();
      return req<
        Array<{
          id: string;
          personId: string;
          personName: string | null;
          amountNzd: number;
          date: string;
          notes: string | null;
          transactionId: string | null;
          createdAt: string;
        }>
      >(`/debts/repayments${qs ? `?${qs}` : ''}`);
    },
    addRepayment: (
      personId: string,
      body: {
        amountNzd: number;
        date: string;
        notes?: string | null;
        transactionId?: string | null;
      },
    ) =>
      req<{
        repayment: {
          id: string;
          personId: string;
          personName: string | null;
          amountNzd: number;
          date: string;
          notes: string | null;
          transactionId: string | null;
          createdAt: string;
        };
        person: DebtPerson;
      }>(`/debts/people/${encodeURIComponent(personId)}/repayments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    deleteRepayment: (id: string) =>
      req<{ ok: boolean; id: string }>(`/debts/repayments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
  healthScore: {
    get: () => req<HealthScoreResponse>('/health-score'),
  },
  recurring: {
    list: () => req<RecurringListResponse>('/recurring'),
    create: (body: RecurringWriteBody & { merchantKey?: string | null; source?: 'detected' | 'manual' }) =>
      req<RecurringItem>('/recurring', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<RecurringWriteBody> & { status?: RecurringItem['status'] }) =>
      req<RecurringItem>(`/recurring/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean; id: string }>(`/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    link: (id: string, transactionId: string) =>
      req<RecurringItem>(`/recurring/${encodeURIComponent(id)}/link`, { method: 'POST', body: JSON.stringify({ transactionId }) }),
    dismiss: (merchantKey: string) =>
      req<{ ok: boolean; merchantKey: string }>('/recurring/dismiss', { method: 'POST', body: JSON.stringify({ merchantKey }) }),
    restoreDismissed: () => req<{ ok: boolean; restored: number }>('/recurring/dismissed/restore', { method: 'POST' }),
  },
  ads: {
    config: () => req<AdsConfig>('/ads/config'),
  },
  warranties: {
    list: () => req<WarrantyListResponse>('/warranties'),
    purchases: (q = '') => req<WarrantyPurchase[]>(`/warranties/purchases?${new URLSearchParams({ q })}`),
    create: (body: WarrantyWriteBody) => req<Warranty>('/warranties', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<WarrantyWriteBody>) =>
      req<Warranty>(`/warranties/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean; id: string }>(`/warranties/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadReceipt: (id: string, receiptBase64: string) =>
      req<Warranty>(`/warranties/${encodeURIComponent(id)}/receipt`, { method: 'POST', body: JSON.stringify({ receiptBase64 }) }),
    removeReceipt: (id: string) => req<Warranty>(`/warranties/${encodeURIComponent(id)}/receipt`, { method: 'DELETE' }),
  },
  crypto: {
    summary: (year?: number) => req<CryptoSummary>(`/crypto/summary${year ? `?year=${year}` : ''}`),
    createTxn: (body: CryptoTxnBody) => req<CryptoTxn>('/crypto/txns', { method: 'POST', body: JSON.stringify(body) }),
    updateTxn: (id: string, body: CryptoTxnBody) => req<CryptoTxn>(`/crypto/txns/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeTxn: (id: string) => req<{ ok: boolean }>(`/crypto/txns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    price: (asset: string, date: string) =>
      req<{ priceNzd: number | null; source: string | null; priceDate: string | null; reason: string | null }>(`/crypto/price?${new URLSearchParams({ asset, date })}`),
    setCostMethod: (costMethod: 'fifo' | 'wac') => req<{ costMethod: string }>('/crypto/settings', { method: 'PUT', body: JSON.stringify({ costMethod }) }),
    importPreview: (walletId: string) =>
      req<{ wallet: { id: string; name: string; network: string }; candidates: CryptoImportCandidate[]; skipped: number }>(`/crypto/import/${encodeURIComponent(walletId)}`),
    importCommit: (walletId: string, items: Record<string, unknown>[]) =>
      req<{ added: number; ignored: number }>('/crypto/import', { method: 'POST', body: JSON.stringify({ walletId, items }) }),
    saveDefi: (id: string | null, body: Omit<DefiPosition, 'id'>) =>
      req<DefiView>(id ? `/crypto/defi/${encodeURIComponent(id)}` : '/crypto/defi', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
    removeDefi: (id: string) => req<DefiView>(`/crypto/defi/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  bonds: {
    list: () => req<BondsView>('/bonds'),
    create: (body: BondWriteBody) => req<BondsView>('/bonds', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: BondWriteBody) => req<BondsView>(`/bonds/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<BondsView>(`/bonds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    setCoupon: (id: string, date: string, body: { skipped?: boolean; netAmount?: number | null }) =>
      req<BondsView>(`/bonds/${encodeURIComponent(id)}/coupons/${encodeURIComponent(date)}`, { method: 'PUT', body: JSON.stringify(body) }),
    repaid: (id: string, on?: string) => req<BondsView>(`/bonds/${encodeURIComponent(id)}/repaid`, { method: 'POST', body: JSON.stringify({ on }) }),
    rollOver: (id: string, body: BondWriteBody) => req<BondsView>(`/bonds/${encodeURIComponent(id)}/rollover`, { method: 'POST', body: JSON.stringify(body) }),
  },
  commodities: {
    list: () => req<CommoditiesView>('/commodities'),
    create: (body: CommodityWriteBody) => req<CommoditiesView>('/commodities', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: CommodityWriteBody) => req<CommoditiesView>(`/commodities/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<CommoditiesView>(`/commodities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  vehicles: {
    list: () => req<VehiclesView>('/vehicles'),
    create: (body: VehicleWriteBody) => req<Vehicle>('/vehicles', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: VehicleWriteBody) => req<Vehicle>(`/vehicles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean }>(`/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  payslips: {
    list: (year?: number, employer?: string | null) => {
      const q = new URLSearchParams();
      if (year) q.set('year', String(year));
      if (employer) q.set('employer', employer);
      const qs = q.toString();
      return req<PayslipsView>(`/payslips${qs ? `?${qs}` : ''}`);
    },
    create: (body: PayslipWriteBody) => req<Payslip>('/payslips', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: PayslipWriteBody) => req<Payslip>(`/payslips/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean }>(`/payslips/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadFile: (id: string, fileBase64: string) => req<Payslip>(`/payslips/${encodeURIComponent(id)}/file`, { method: 'POST', body: JSON.stringify({ fileBase64 }) }),
    removeFile: (id: string) => req<Payslip>(`/payslips/${encodeURIComponent(id)}/file`, { method: 'DELETE' }),
  },
  household: {
    get: () => req<HouseholdView>('/household'),
    create: (name: string) => req<HouseholdView>('/household', { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (name: string) => req<HouseholdView>('/household', { method: 'PATCH', body: JSON.stringify({ name }) }),
    remove: () => req<{ ok: boolean }>('/household', { method: 'DELETE' }),
    invite: (email: string, role: 'adult' | 'viewer') =>
      req<HouseholdView & { invite: { link: string; emailed: boolean } }>('/household/invites', { method: 'POST', body: JSON.stringify({ email, role }) }),
    revokeInvite: (id: string) => req<HouseholdView>(`/household/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    previewInvite: (token: string) =>
      req<{ householdName: string; inviterName: string; role: HouseholdRole; alreadyInHousehold: boolean }>('/household/invites/preview', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    acceptInvite: (token: string) => req<HouseholdView>('/household/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }),
    setRole: (userId: string, role: 'adult' | 'viewer') =>
      req<HouseholdView>(`/household/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (userId: string) => req<HouseholdView>(`/household/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    transfer: (userId: string) => req<HouseholdView>('/household/transfer', { method: 'POST', body: JSON.stringify({ userId }) }),
    leave: () => req<{ ok: boolean }>('/household/leave', { method: 'POST' }),
    shareable: () => req<HouseholdShareable>('/household/shareable'),
    setShared: (kind: HouseholdShareKind, itemId: string, shared: boolean) =>
      req<HouseholdShareable>('/household/shares', { method: 'PUT', body: JSON.stringify({ kind, itemId, shared }) }),
    dashboard: () => req<HouseholdDashboard>('/household/dashboard'),
    splits: () => req<HouseholdSplitsView>('/household/splits'),
    createSplit: (transactionId: string, method: HouseholdSplitMethod, shares: { memberId: string; value?: number }[]) =>
      req<HouseholdSplitsView>('/household/splits', { method: 'POST', body: JSON.stringify({ transactionId, method, shares }) }),
    updateSplit: (id: string, method: HouseholdSplitMethod, shares: { memberId: string; value?: number }[]) =>
      req<HouseholdSplitsView>(`/household/splits/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ method, shares }) }),
    removeSplit: (id: string) => req<HouseholdSplitsView>(`/household/splits/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    recordSettlement: (body: { fromId: string; toId: string; amountNzd: number; paidOn?: string; note?: string }) =>
      req<HouseholdSplitsView>('/household/settlements', { method: 'POST', body: JSON.stringify(body) }),
    removeSettlement: (id: string) => req<HouseholdSplitsView>(`/household/settlements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    paye: (year?: number) => req<HouseholdPayeView>(`/household/paye${year ? `?year=${year}` : ''}`),
    setMyPay: (body: { inputs: HouseholdPayInputs | null; includePaySources: boolean }) =>
      req<HouseholdPayeView>('/household/paye/mine', { method: 'PUT', body: JSON.stringify(body) }),
    clearMyPay: () => req<HouseholdPayeView>('/household/paye/mine', { method: 'DELETE' }),
    setPayFeedBudget: (feedBudget: boolean) => req<HouseholdPayeView>('/household/paye/settings', { method: 'PUT', body: JSON.stringify({ feedBudget }) }),
    payWhatIf: (memberId: string, taxYear: number, change: HouseholdWhatIfChange) =>
      req<HouseholdWhatIfResult>('/household/paye/what-if', { method: 'POST', body: JSON.stringify({ memberId, taxYear, change }) }),
    family: (year?: number) => req<HouseholdFamilyView>(`/household/family${year ? `?year=${year}` : ''}`),
    setFamily: (body: { partnerIds: string[]; children: { id?: string; birthMonth: string; memberId?: string | null }[]; mainBenefit: boolean; taxYear?: number }) =>
      req<HouseholdFamilyView>('/household/family', { method: 'PUT', body: JSON.stringify(body) }),
    setBudgetPlan: (categoryId: string, amountNzd: number) =>
      req<{ ok: boolean }>(`/household/shared/budget/${encodeURIComponent(categoryId)}`, { method: 'PATCH', body: JSON.stringify({ amountNzd }) }),
    updateGoal: (id: string, body: { targetNzd?: number; currentAmountNzd?: number }) =>
      req<{ ok: boolean }>(`/household/shared/goal/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    updateBill: (id: string, body: { amountNzd?: number; nextDue?: string }) =>
      req<{ ok: boolean }>(`/household/shared/bill/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  shopping: {
    lists: () => req<ShoppingListSummary[]>('/shopping/lists'),
    createList: (body: { name: string; categoryId?: string | null }) =>
      req<ShoppingListDetail>('/shopping/lists', { method: 'POST', body: JSON.stringify(body) }),
    list: (id: string) => req<ShoppingListDetail>(`/shopping/lists/${encodeURIComponent(id)}`),
    updateList: (id: string, body: { name?: string; categoryId?: string | null }) =>
      req<ShoppingListDetail>(`/shopping/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeList: (id: string) => req<{ ok: boolean }>(`/shopping/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    resetList: (id: string) => req<ShoppingListDetail>(`/shopping/lists/${encodeURIComponent(id)}/reset`, { method: 'POST' }),
    addItem: (listId: string, body: { name: string; quantity?: number; estPriceNzd?: number | null; categoryId?: string | null }) =>
      req<ShoppingListDetail>(`/shopping/lists/${encodeURIComponent(listId)}/items`, { method: 'POST', body: JSON.stringify(body) }),
    updateItem: (
      id: string,
      body: Partial<{ name: string; quantity: number; estPriceNzd: number | null; categoryId: string | null; ticked: boolean; productKey: string | null }>,
    ) => req<ShoppingListDetail>(`/shopping/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeItem: (id: string) => req<ShoppingListDetail>(`/shopping/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    recordPrices: (listId: string, body: { chain: string; branch: string; prices: { itemId: string; priceNzd: number }[] }) =>
      req<{ list: ShoppingListDetail; shared: number; notShared: number }>(`/shopping/lists/${encodeURIComponent(listId)}/prices`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    compare: (listId: string) => req<ShoppingCompareResponse>(`/shopping/lists/${encodeURIComponent(listId)}/compare`),
    prefs: () => req<ShoppingPrefs & { sharedCount: number; chains: { id: string; label: string }[] }>('/shopping/prefs'),
    savePrefs: (body: Partial<{ contributePrices: boolean; stores: ShoppingStore[]; windowDays: number }>) =>
      req<ShoppingPrefs & { sharedCount: number; chains: { id: string; label: string }[] }>('/shopping/prefs', { method: 'PUT', body: JSON.stringify(body) }),
    products: (q: string) => req<{ key: string; name: string }[]>(`/shopping/products?${new URLSearchParams({ q })}`),
    branches: (chain: string, q: string) => req<string[]>(`/shopping/branches?${new URLSearchParams({ chain, q })}`),
    removeMyPrices: () => req<{ ok: boolean; removed: number }>('/shopping/prices/mine', { method: 'DELETE' }),
  },
  rentals: {
    list: () => req<RentalListResponse>('/rentals'),
    setLossBasis: (lossBasis: RentalListResponse['lossBasis']) =>
      req<{ lossBasis: RentalListResponse['lossBasis'] }>('/rentals/settings', { method: 'PUT', body: JSON.stringify({ lossBasis }) }),
    createProperty: (body: RentalPropertyWriteBody) =>
      req<RentalProperty>('/rentals/properties', { method: 'POST', body: JSON.stringify(body) }),
    updateProperty: (id: string, body: Partial<RentalPropertyWriteBody>) =>
      req<RentalProperty>(`/rentals/properties/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeProperty: (id: string) =>
      req<{ ok: boolean; id: string }>(`/rentals/properties/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createEntry: (body: RentalEntryWriteBody) =>
      req<RentalEntry>('/rentals/entries', { method: 'POST', body: JSON.stringify(body) }),
    updateEntry: (id: string, body: Partial<RentalEntryWriteBody>) =>
      req<RentalEntry>(`/rentals/entries/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeEntry: (id: string) => req<{ ok: boolean; id: string }>(`/rentals/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createRoom: (body: RentalRoomWriteBody) => req<RentalRoom>('/rentals/rooms', { method: 'POST', body: JSON.stringify(body) }),
    updateRoom: (id: string, body: Partial<Omit<RentalRoomWriteBody, 'propertyId'>>) =>
      req<RentalRoom>(`/rentals/rooms/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeRoom: (id: string) => req<{ ok: boolean; id: string }>(`/rentals/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createTenancy: (body: RentalTenancyWriteBody) =>
      req<RentalTenancy>('/rentals/tenancies', { method: 'POST', body: JSON.stringify(body) }),
    updateTenancy: (id: string, body: Partial<Omit<RentalTenancyWriteBody, 'roomId'>>) =>
      req<RentalTenancy>(`/rentals/tenancies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeTenancy: (id: string) => req<{ ok: boolean; id: string }>(`/rentals/tenancies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  invoices: {
    list: (filters: { status?: string; clientId?: string; businessId?: string; from?: string; to?: string } = {}) => {
      const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
      const qs = q.toString();
      return req<InvoiceListResponse>(`/invoices${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => req<Invoice>(`/invoices/${encodeURIComponent(id)}`),
    create: (body: InvoiceWriteBody) => req<Invoice>('/invoices', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: InvoiceWriteBody) =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean; id: string }>(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    action: (id: string, action: 'mark-sent' | 'void' | 'duplicate') =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
    share: (id: string) => req<Invoice>(`/invoices/${encodeURIComponent(id)}/share`, { method: 'POST' }),
    unshare: (id: string) => req<Invoice>(`/invoices/${encodeURIComponent(id)}/share`, { method: 'DELETE' }),
    addPayment: (id: string, body: { date: string; amountNzd: number; method: string; notes?: string; addToIncome: boolean }) =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify(body) }),
    removePayment: (id: string, paymentId: string) =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, { method: 'DELETE' }),
    emailDraft: (id: string, kind: 'invoice' | 'reminder') =>
      req<{ to: string[]; subject: string; message: string; kind: string; emailEnabled: boolean; problem: string | null }>(
        `/invoices/${encodeURIComponent(id)}/email-draft?kind=${kind}`,
      ),
    send: (id: string, body: { kind: 'invoice' | 'reminder'; to: string[]; subject: string; message: string; includeLink: boolean }) =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}/send`, {
        method: 'POST',
        body: JSON.stringify({ ...body, confirm: true }),
      }),
    recordSend: (id: string, body: { kind: 'invoice' | 'reminder'; channel: 'email_app' | 'share'; to: string[]; subject: string }) =>
      req<Invoice>(`/invoices/${encodeURIComponent(id)}/record-send`, { method: 'POST', body: JSON.stringify(body) }),
    pdfUrl: (id: string, inline = false) => `${BASE}/invoices/${encodeURIComponent(id)}/pdf${inline ? '?inline=1' : ''}`,
    csvUrl: () => `${BASE}/invoices/export.csv`,
    business: () => req<BusinessProfile>('/invoices/business'),
    saveBusiness: (body: BusinessProfile) =>
      req<BusinessProfile>('/invoices/business', { method: 'PUT', body: JSON.stringify(body) }),
    clients: (businessId?: string | null) =>
      req<InvoiceClient[]>(`/invoices/clients${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`),
    createClient: (body: InvoiceClientWriteBody) =>
      req<InvoiceClient>('/invoices/clients', { method: 'POST', body: JSON.stringify(body) }),
    updateClient: (id: string, body: InvoiceClientWriteBody) =>
      req<InvoiceClient>(`/invoices/clients/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeClient: (id: string) =>
      req<{ ok: boolean; id: string }>(`/invoices/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    publicView: (token: string) => req<PublicInvoice>(`/public/invoices/${encodeURIComponent(token)}`),
    publicPdfUrl: (token: string) => `${BASE}/public/invoices/${encodeURIComponent(token)}/pdf`,
  },
  business: {
    list: (taxYear?: number | null) => req<BusinessListResponse>(`/business${taxYear ? `?taxYear=${taxYear}` : ''}`),
    get: (id: string, taxYear?: number | null) =>
      req<BusinessDetail>(`/business/${encodeURIComponent(id)}${taxYear ? `?taxYear=${taxYear}` : ''}`),
    create: (body: BusinessWriteBody) => req<Business>('/business', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: BusinessWriteBody) =>
      req<Business>(`/business/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) => req<{ ok: boolean; id: string }>(`/business/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    archive: (id: string) => req<Business>(`/business/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    restore: (id: string) => req<Business>(`/business/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
    setLogo: (id: string, image: string) =>
      req<Business>(`/business/${encodeURIComponent(id)}/logo`, { method: 'POST', body: JSON.stringify({ image }) }),
    removeLogo: (id: string) => req<Business>(`/business/${encodeURIComponent(id)}/logo`, { method: 'DELETE' }),
    /** Accountant and viewer access (KAN-129). */
    shared: () => req<SharedBusiness[]>('/business/shared'),
    members: (id: string) => req<BusinessMembersView>(`/business/${encodeURIComponent(id)}/members`),
    invite: (id: string, email: string, role: BusinessMemberRole) =>
      req<BusinessMembersView & { invite: { link: string; emailed: boolean } }>(`/business/${encodeURIComponent(id)}/members/invites`, {
        method: 'POST',
        body: JSON.stringify({ email, role }),
      }),
    revokeInvite: (id: string, inviteId: string) =>
      req<BusinessMembersView>(`/business/${encodeURIComponent(id)}/members/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
    setMemberRole: (id: string, userId: string, role: BusinessMemberRole) =>
      req<BusinessMembersView>(`/business/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (id: string, userId: string) =>
      req<{ ok: true; left: boolean }>(`/business/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    previewInvite: (token: string) => req<BusinessInvitePreview>('/business/invites/preview', { method: 'POST', body: JSON.stringify({ token }) }),
    acceptInvite: (token: string) =>
      req<{ businessId: string; role: BusinessMemberRole }>('/business/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }),
    createAsset: (businessId: string, body: BusinessAssetWriteBody) =>
      req<BusinessAsset>(`/business/${encodeURIComponent(businessId)}/assets`, { method: 'POST', body: JSON.stringify(body) }),
    updateAsset: (id: string, body: BusinessAssetWriteBody) =>
      req<BusinessAsset>(`/business/assets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeAsset: (id: string) => req<{ ok: boolean; id: string }>(`/business/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    addMovement: (assetId: string, body: { date: string; kind: BusinessMovementKind; quantity: number; amountNzd?: number | null; notes?: string }) =>
      req<BusinessAsset>(`/business/assets/${encodeURIComponent(assetId)}/movements`, { method: 'POST', body: JSON.stringify(body) }),
    removeMovement: (id: string) => req<BusinessAsset>(`/business/movements/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    candidates: (taxYear: number, q: string) =>
      req<BusinessMoneyItem[]>(`/business/money/candidates?taxYear=${taxYear}&q=${encodeURIComponent(q)}`),
    tag: (kind: 'transaction' | 'income', id: string, businessId: string | null) =>
      req<{ ok: true }>('/business/money/tag', { method: 'POST', body: JSON.stringify({ kind, id, businessId }) }),
    client: (clientId: string) => req<BusinessClientView>(`/business/clients/${encodeURIComponent(clientId)}`),
    createEmployee: (businessId: string, body: BusinessEmployeeWriteBody) =>
      req<BusinessEmployee>(`/business/${encodeURIComponent(businessId)}/employees`, { method: 'POST', body: JSON.stringify(body) }),
    updateEmployee: (id: string, body: BusinessEmployeeWriteBody) =>
      req<BusinessEmployee>(`/business/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeEmployee: (id: string) => req<{ ok: boolean; id: string }>(`/business/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadContract: (id: string, fileBase64: string, fileName: string) =>
      req<BusinessEmployee>(`/business/employees/${encodeURIComponent(id)}/contract`, { method: 'POST', body: JSON.stringify({ fileBase64, fileName }) }),
    removeContract: (id: string) => req<BusinessEmployee>(`/business/employees/${encodeURIComponent(id)}/contract`, { method: 'DELETE' }),
    produceCandidates: () => req<BusinessDetail['produce']>('/business/produce/candidates'),
    linkProduce: (commodityId: string, businessId: string | null) =>
      req<{ ok: true }>('/business/produce/link', { method: 'POST', body: JSON.stringify({ commodityId, businessId }) }),
    /** Accountant export link (KAN-128): the whole file, or one section, for a tax year or a from/to period. */
    exportUrl: (businessId: string, period: { taxYear?: number | null } | { from: string; to: string }, section: 'all' | 'pnl' | 'transactions' | 'invoices' | 'gst' = 'all') => {
      const q = new URLSearchParams('from' in period ? { from: period.from, to: period.to } : period.taxYear ? { taxYear: String(period.taxYear) } : {});
      if (section !== 'all') q.set('section', section);
      return `${BASE}/business/${encodeURIComponent(businessId)}/export.csv${q.size ? `?${q}` : ''}`;
    },
    /** The GST return for the period containing `date` (KAN-127). Business plan only. */
    gst: (businessId: string, date?: string) =>
      req<GstReturnView>(`/business/${encodeURIComponent(businessId)}/gst${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    setGstSettings: (businessId: string, settings: GstReturnView['settings']) =>
      req<GstReturnView['settings']>(`/business/${encodeURIComponent(businessId)}/gst/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
    setGstItem: (businessId: string, kind: 'income' | 'transaction', id: string, treatment: GstItem['treatment'] | null) =>
      req<{ ok: true }>(`/business/${encodeURIComponent(businessId)}/gst/items`, { method: 'PUT', body: JSON.stringify({ kind, id, treatment }) }),
    /** P&L for a tax year, or a custom from/to period (KAN-126). Business plan only: 402 otherwise. */
    profitLoss: (businessId: string, period: { taxYear?: number | null } | { from: string; to: string }) => {
      const q = 'from' in period ? new URLSearchParams({ from: period.from, to: period.to }) : new URLSearchParams(period.taxYear ? { taxYear: String(period.taxYear) } : {});
      return req<ProfitLoss>(`/business/${encodeURIComponent(businessId)}/profit-loss${q.size ? `?${q}` : ''}`);
    },
    stock: (businessId: string, includeArchived = false) =>
      req<StockItemView[]>(`/business/${encodeURIComponent(businessId)}/stock${includeArchived ? '?includeArchived=1' : ''}`),
    createStockItem: (businessId: string, body: StockItemWriteBody) =>
      req<StockItemView>(`/business/${encodeURIComponent(businessId)}/stock`, { method: 'POST', body: JSON.stringify(body) }),
    updateStockItem: (id: string, body: StockItemWriteBody) =>
      req<StockItemView>(`/business/stock/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    archiveStockItem: (id: string) => req<StockItemView>(`/business/stock/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    restoreStockItem: (id: string) => req<StockItemView>(`/business/stock/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
    addStockBatch: (itemId: string, body: StockBatchWriteBody) =>
      req<StockItemView>(`/business/stock/${encodeURIComponent(itemId)}/batches`, { method: 'POST', body: JSON.stringify(body) }),
    removeStockBatch: (id: string) => req<StockItemView>(`/business/stock/batches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    addStockAdjustment: (itemId: string, body: StockAdjustmentWriteBody) =>
      req<StockItemView>(`/business/stock/${encodeURIComponent(itemId)}/adjustments`, { method: 'POST', body: JSON.stringify(body) }),
    removeStockAdjustment: (id: string) => req<StockItemView>(`/business/stock/adjustments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** Suppliers and their bills (KAN-107, KAN-123). */
    suppliers: (businessId: string) => req<Supplier[]>(`/business/${encodeURIComponent(businessId)}/suppliers`),
    createSupplier: (businessId: string, body: SupplierWriteBody) =>
      req<Supplier>(`/business/${encodeURIComponent(businessId)}/suppliers`, { method: 'POST', body: JSON.stringify(body) }),
    updateSupplier: (id: string, body: SupplierWriteBody) => req<Supplier>(`/business/suppliers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeSupplier: (id: string) => req<{ id: string }>(`/business/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    bills: (businessId: string, supplierId?: string | null) =>
      req<SupplierBill[]>(`/business/${encodeURIComponent(businessId)}/bills${supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : ''}`),
    createBill: (businessId: string, body: BillWriteBody) => req<SupplierBill>(`/business/${encodeURIComponent(businessId)}/bills`, { method: 'POST', body: JSON.stringify(body) }),
    updateBill: (id: string, body: BillWriteBody) => req<SupplierBill>(`/business/bills/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeBill: (id: string) => req<{ id: string }>(`/business/bills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    uploadBillFile: (id: string, fileBase64: string, fileName: string) =>
      req<SupplierBill>(`/business/bills/${encodeURIComponent(id)}/file`, { method: 'POST', body: JSON.stringify({ fileBase64, fileName }) }),
    removeBillFile: (id: string) => req<SupplierBill>(`/business/bills/${encodeURIComponent(id)}/file`, { method: 'DELETE' }),
    linkBillBatch: (id: string, batchId: string) => req<SupplierBill>(`/business/bills/${encodeURIComponent(id)}/batches`, { method: 'POST', body: JSON.stringify({ batchId }) }),
    unlinkBillBatch: (id: string, batchId: string) =>
      req<SupplierBill>(`/business/bills/${encodeURIComponent(id)}/batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' }),
    /** Sales and receipts (KAN-120). */
    sales: (businessId: string, range?: { from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (range?.from) q.set('from', range.from);
      if (range?.to) q.set('to', range.to);
      return req<BusinessSale[]>(`/business/${encodeURIComponent(businessId)}/sales${q.size ? `?${q}` : ''}`);
    },
    createSale: (businessId: string, body: SaleWriteBody) => req<BusinessSale>(`/business/${encodeURIComponent(businessId)}/sales`, { method: 'POST', body: JSON.stringify(body) }),
    updateSale: (id: string, body: SaleWriteBody) => req<BusinessSale>(`/business/sales/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeSale: (id: string) => req<{ id: string }>(`/business/sales/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    issueReceipt: (id: string) => req<BusinessSale>(`/business/sales/${encodeURIComponent(id)}/receipt`, { method: 'POST' }),
    uploadSaleReceipt: (id: string, fileBase64: string, fileName: string) =>
      req<BusinessSale>(`/business/sales/${encodeURIComponent(id)}/receipt-file`, { method: 'POST', body: JSON.stringify({ fileBase64, fileName }) }),
    removeSaleReceipt: (id: string) => req<BusinessSale>(`/business/sales/${encodeURIComponent(id)}/receipt-file`, { method: 'DELETE' }),
    /** Wages and the business budget (KAN-121). */
    wages: (businessId: string, range?: { from?: string; to?: string }) => {
      const q = new URLSearchParams();
      if (range?.from) q.set('from', range.from);
      if (range?.to) q.set('to', range.to);
      return req<BusinessWagePayment[]>(`/business/${encodeURIComponent(businessId)}/wages${q.size ? `?${q}` : ''}`);
    },
    createWage: (businessId: string, body: WageWriteBody) => req<BusinessWagePayment>(`/business/${encodeURIComponent(businessId)}/wages`, { method: 'POST', body: JSON.stringify(body) }),
    updateWage: (id: string, body: WageWriteBody) => req<BusinessWagePayment>(`/business/wages/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeWage: (id: string) => req<{ id: string }>(`/business/wages/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    budget: (businessId: string, taxYear?: number | null) =>
      req<BusinessBudgetView>(`/business/${encodeURIComponent(businessId)}/budget${taxYear ? `?taxYear=${taxYear}` : ''}`),
    createBudgetCategory: (businessId: string, body: BudgetCategoryWriteBody) =>
      req<BusinessBudgetCategory>(`/business/${encodeURIComponent(businessId)}/budget/categories`, { method: 'POST', body: JSON.stringify(body) }),
    updateBudgetCategory: (id: string, body: BudgetCategoryWriteBody) =>
      req<BusinessBudgetCategory>(`/business/budget/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    removeBudgetCategory: (id: string) => req<{ id: string }>(`/business/budget/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    setBudgetPlans: (id: string, plans: { period: string; amountNzd: number | null }[]) =>
      req<BusinessBudgetCategory>(`/business/budget/categories/${encodeURIComponent(id)}/plans`, { method: 'PUT', body: JSON.stringify({ plans }) }),
    setTransactionCategory: (businessId: string, transactionId: string, categoryId: string | null) =>
      req<true>(`/business/${encodeURIComponent(businessId)}/money/category`, { method: 'PUT', body: JSON.stringify({ transactionId, categoryId }) }),
  },
  calendar: {
    range: (from: string, to: string, businessId?: string | null) =>
      req<CalendarResponse>(`/calendar?${new URLSearchParams({ from, to, ...(businessId ? { businessId } : {}) })}`),
    getMeeting: (id: string) => req<BusinessMeeting>(`/calendar/meetings/${encodeURIComponent(id)}`),
    createMeeting: (body: MeetingWriteBody) => req<BusinessMeeting>('/calendar/meetings', { method: 'POST', body: JSON.stringify(body) }),
    updateMeeting: (id: string, body: MeetingWriteBody) =>
      req<BusinessMeeting>(`/calendar/meetings/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    setStatus: (id: string, status: MeetingStatus) =>
      req<BusinessMeeting>(`/calendar/meetings/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    dueReminders: () => req<MeetingReminder[]>('/calendar/reminders/due', { method: 'POST' }),
    earnings: (from: string, to: string) => req<EarningsResponse>(`/calendar/earnings?${new URLSearchParams({ from, to })}`),
    holidays: (from: string, to: string) => req<HolidaysResponse>(`/calendar/holidays?${new URLSearchParams({ from, to })}`),
  },
  paySources: {
    list: () => req<PaySource[]>('/pay-sources'),
    create: (body: { name: string; taxYear?: number; inputs: OutputPaySourceInputs }) =>
      req<PaySource>('/pay-sources', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name: string; taxYear?: number; inputs: OutputPaySourceInputs }) =>
      req<PaySource>(`/pay-sources/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/pay-sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  savingsGoals: {
    list: () => req<SavingsGoal[]>('/savings-goals'),
    get: (id: string) => req<SavingsGoal>(`/savings-goals/${encodeURIComponent(id)}`),
    create: (body: SavingsGoalWriteBody & { name: string; targetNzd: number }) =>
      req<SavingsGoal>('/savings-goals', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: SavingsGoalWriteBody) =>
      req<SavingsGoal>(`/savings-goals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/savings-goals/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
  wallets: {
    list: () => req<Wallet[]>('/wallets'),
    networks: () => req<WalletNetworkInfo[]>('/wallets/networks'),
    valuation: () => req<WalletsValuationResponse>('/wallets/valuation'),
    create: (body: { network: WalletNetwork; address: string; name?: string }) =>
      req<Wallet>('/wallets', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sync: (id: string) =>
      req<{ synced: boolean; wallet: Wallet; error?: string; code?: string }>(
        `/wallets/${encodeURIComponent(id)}/sync`,
        { method: 'POST' },
      ),
  },
  donations: {
    list: (taxYear?: number) =>
      req<Donation[]>(`/donations${taxYear != null ? `?taxYear=${taxYear}` : ''}`),
    summary: (taxYear?: number) =>
      req<DonationSummary>(`/donations/summary${taxYear != null ? `?taxYear=${taxYear}` : ''}`),
    get: (id: string) => req<Donation>(`/donations/${encodeURIComponent(id)}`),
    create: (body: DonationWriteBody & { date: string; recipient: string; amountNzd: number }) =>
      req<Donation>('/donations', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: DonationWriteBody) =>
      req<Donation>(`/donations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/donations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
  budgets: {
    categories: () =>
      req<
        Array<{
          id: string;
          slug?: string;
          name: string;
          parentId: string | null;
          colour: string | null;
          type: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
          isIncome: boolean;
          sortOrder: number;
        }>
      >('/budgets/categories'),
    createCategory: (body: {
      name: string;
      /** A starter category recreated in onboarding keeps its slug (the server makes the id per user). */
      slug?: string;
      id?: string;
      type?: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
      isIncome?: boolean;
      colour?: string | null;
      sortOrder?: number;
      parentId?: string | null;
    }) =>
      req<{
        id: string;
        name: string;
        parentId: string | null;
        colour: string | null;
        type: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
        isIncome: boolean;
        sortOrder: number;
      }>('/budgets/categories', { method: 'POST', body: JSON.stringify(body) }),
    updateCategory: (
      id: string,
      body: {
        name?: string;
        type?: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
        isIncome?: boolean;
        colour?: string | null;
        sortOrder?: number;
      },
    ) =>
      req<{
        id: string;
        name: string;
        parentId: string | null;
        colour: string | null;
        type: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
        isIncome: boolean;
        sortOrder: number;
      }>(`/budgets/categories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    /** Deleting a category in use needs moveTo: everything that uses it moves there. */
    deleteCategory: (id: string, moveTo?: string) =>
      req<{ ok: boolean; id: string }>(
        `/budgets/categories/${encodeURIComponent(id)}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`,
        { method: 'DELETE' },
      ),
    categoryUsage: (id: string) =>
      req<{
        transactions: number;
        incomeRecords: number;
        budgetPlans: number;
        incomePlans: number;
        payeeRules: number;
        recurring: number;
        shopping: number;
        total: number;
      }>(`/budgets/categories/${encodeURIComponent(id)}/usage`),
    list: (month?: string) =>
      req<unknown[]>(month ? `/budgets?month=${encodeURIComponent(month)}` : '/budgets'),
    /** Upsert monthly plan: { categoryId, yearMonth: "YYYY-MM", amountNzd } */
    upsertPlan: (body: {
      categoryId: string;
      yearMonth: string;
      amountNzd: number;
      notes?: string | null;
    }) =>
      req<unknown>('/budgets/plan', { method: 'PUT', body: JSON.stringify(body) }),
    update: (id: string, body: { amountNzd?: number; notes?: string | null }) =>
      req<unknown>(`/budgets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/budgets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
  income: {
    list: (opts?: { from?: string; to?: string; month?: string }) => {
      const q = new URLSearchParams();
      if (opts?.month) q.set('month', opts.month);
      else {
        if (opts?.from) q.set('from', opts.from);
        if (opts?.to) q.set('to', opts.to);
      }
      const qs = q.toString();
      return req<
        Array<{
          id: string;
          date: string;
          amountNzd: number;
          kind: 'cash' | 'crypto';
          description: string;
          accountId: string | null;
          accountName: string | null;
          accountType?: string | null;
          cryptoAsset: string | null;
          cryptoAmount: number | null;
          holdingId: string | null;
          holdingName: string | null;
          transactionId: string | null;
          notes: string | null;
          createdAt: string;
          dividendEventId?: string | null;
          categoryId?: string | null;
          categoryName?: string | null;
          origin?: 'record' | 'category_txn';
          txnSource?: string | null;
        }>
      >(qs ? `/income?${qs}` : '/income');
    },
    summary: (month: string) =>
      req<{
        yearMonth: string;
        periodStart: string;
        periodEnd: string;
        plannedNzd: number;
        actualNzd: number;
        recordsTotalNzd: number;
        categoryCreditsExtraNzd: number;
        recordCount: number;
        categoryCreditCount?: number;
        receivedItemCount?: number;
        remainingNzd: number;
        plan: {
          id: string;
          yearMonth: string;
          categoryId: string;
          categoryName: string | null;
          amountNzd: number;
          notes: string | null;
          createdAt: string;
          updatedAt: string;
        } | null;
        plans: Array<{
          id: string;
          yearMonth: string;
          categoryId: string;
          categoryName: string | null;
          amountNzd: number;
          notes: string | null;
          createdAt: string;
          updatedAt: string;
        }>;
        categories: Array<{
          categoryId: string;
          categoryName: string;
          plannedNzd: number;
          actualNzd: number;
          remainingNzd: number;
          recordCount: number;
          plan: {
            id: string;
            yearMonth: string;
            categoryId: string;
            categoryName: string | null;
            amountNzd: number;
            notes: string | null;
            createdAt: string;
            updatedAt: string;
          } | null;
        }>;
      }>(`/income/summary?month=${encodeURIComponent(month)}`),
    getPlan: (month: string) =>
      req<
        Array<{
          id: string;
          yearMonth: string;
          categoryId: string;
          categoryName: string | null;
          amountNzd: number;
          notes: string | null;
          createdAt: string;
          updatedAt: string;
        }>
      >(`/income/plan?month=${encodeURIComponent(month)}`),
    upsertPlan: (body: {
      yearMonth: string;
      categoryId: string;
      amountNzd: number;
      notes?: string | null;
    }) => req('/income/plan', { method: 'PUT', body: JSON.stringify(body) }),
    removePlan: (id: string) =>
      req<{ ok: boolean; id: string }>(`/income/plan/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    create: (body: {
      date: string;
      /** Required for cash; omitted for crypto (server derives from qty × live quote). */
      amountNzd?: number;
      kind: 'cash' | 'crypto';
      description?: string;
      accountId?: string | null;
      /** Income category (Salary, Mining, …). */
      categoryId?: string | null;
      cryptoAsset?: string;
      cryptoAmount?: number;
      notes?: string | null;
    }) => req('/income', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/income/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },
  payees: {
    list: () => req<PayeeSetting[]>('/payees'),
    save: (body: { name: string; categoryId: string | null }) =>
      req<PayeeSetting>('/payees', { method: 'PUT', body: JSON.stringify(body) }),
  },
    kiwisaver: {
    list: () => req<unknown[]>('/kiwisaver'),
    history: (accountId?: string) =>
      req<unknown>(
        accountId
          ? `/kiwisaver/history?accountId=${encodeURIComponent(accountId)}`
          : '/kiwisaver/history',
      ),
    activity: (accountId?: string, limit = 20) =>
      req<unknown>(
        `/kiwisaver/activity?limit=${limit}` +
          (accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''),
      ),
    create: (body: unknown) => req('/kiwisaver', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: unknown) =>
      req(`/kiwisaver/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/kiwisaver/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    setConnection: (enabled: boolean, accountId?: string) =>
      req('/kiwisaver/connection', {
        method: 'POST',
        body: JSON.stringify({ enabled, accountId }),
      }),
    importCsv: (csvText: string, filename?: string) =>
      req('/kiwisaver/import-sharesies-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText, filename }),
      }),
    /** Bank-held KiwiSaver CSV (manual — not Akahu). */
    importBankCsv: (csvText: string, filename?: string) =>
      req<{
        ok: boolean;
        message: string;
        rowsParsed: number;
        upserted: number;
        accountIds: string[];
        errors: Array<{ row?: number; message: string }>;
      }>('/kiwisaver/import-bank-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText, filename }),
      }),
  },
  akahu: {
    status: () =>
      req<{
        configured: boolean;
        provider: string;
        baseUrl: string;
        mode: 'none' | 'personal' | 'oauth';
        oauthReady: boolean;
        sharedTokenConfigured: boolean;
        tokenSource: 'oauth' | 'env' | null;
        connected: boolean;
        oauthConnected: boolean;
        connectedAt: string | null;
        lastSyncAt: string | null;
        institutions: Array<{
          connectionId: string;
          name: string;
          logo?: string | null;
          accountCount: number;
          types: string[];
        }>;
        multiUser: 'per_user_oauth' | 'shared_env_token' | 'none';
      }>('/akahu/status'),
    connect: () =>
      req<{ ok: boolean; authorizeUrl: string; error?: string }>('/akahu/connect', {
        method: 'POST',
        body: '{}',
      }),
    disconnect: () =>
      req<{
        ok: boolean;
        disconnected: boolean;
        message?: string;
        revokedAtAkahu?: boolean;
        revokeError?: string;
      }>('/akahu/disconnect', { method: 'POST', body: '{}' }),
    institutions: () =>
      req<{
        ok: boolean;
        institutions: Array<{
          connectionId: string;
          name: string;
          logo?: string | null;
          accountCount: number;
          types: string[];
        }>;
        tokenSource?: string;
        error?: string;
      }>('/akahu/institutions'),
    sync: () =>
      req<{
        ok: boolean;
        stocksUpserted: number;
        cryptoUpserted: number;
        stocksDeleted: number;
        cryptoDeleted: number;
        kiwisaverFunds: number;
        kiwisaverBalanceSynced: boolean;
        cashAccountsUpserted: number;
        stockSymbols: string[];
        cryptoSymbols: string[];
        sources: string[];
        fxSources?: string[];
        error?: string;
      }>('/akahu/sync', { method: 'POST', body: '{}' }),
    syncTransactions: (sinceDate = '2026-10-01') =>
      req<{
        ok: boolean;
        fetched: number;
        inserted: number;
        updated: number;
        merged?: number;
        skippedNoAccount: number;
        cashAccountsEnsured?: number;
        skippedBeforeDate: number;
        sinceDate: string;
        refreshed?: boolean;
        refreshRateLimited?: boolean;
        error?: string;
      }>('/akahu/sync-transactions', {
        method: 'POST',
        body: JSON.stringify({ sinceDate }),
      }),
  },
  settings: {
    get: () =>
      req<{
        defaultCurrency: string;
        timezone: string;
        locale: string;
        gomining: {
          discountPct: number;
          btcUsd: number | null;
          networkHashrateEhs: number | null;
          dailyBtcIssuance: number | null;
          kWhCostUsd: number | null;
          defaults: {
            kWhCostUsd: number;
            dailyBtcIssuance: number;
            discountAppliesTo: string;
            note: string;
          };
        };
      }>('/settings'),
    getGomining: () =>
      req<{
        discountPct: number;
        btcUsd: number | null;
        networkHashrateEhs: number | null;
        dailyBtcIssuance: number | null;
        kWhCostUsd: number | null;
        fx?: {
          btcUsd: number | null;
          btcNzd: number | null;
          status: 'ok' | 'unavailable';
          source: string;
          asOf: string | null;
          message: string | null;
        };
        income?: {
          poolIncomeUsdPerTh: number | null;
          poolIncomeBtcPerTh: number | null;
          poolIncomeSatPerTh: number | null;
          btcCourseInUsd: number | null;
          electricityUsdPerThPerWt: number | null;
          serviceUsdPerTh: number | null;
          impliedKwhCostUsd: number | null;
          goBtcPaySatPerTh?: number;
          goBtcPayBtcPerTh?: number;
          goBtcPayStatus?: 'ok' | 'unavailable';
          goBtcPayMessage?: string | null;
          status: 'ok' | 'unavailable';
          source: string;
          asOf: string | null;
          message: string | null;
          recordId: number | null;
        };
        networkHashrate?: {
          networkHashrateEhs: number | null;
          status: 'ok' | 'unavailable';
          source: string;
          asOf: string | null;
          message: string | null;
        };
        effective?: {
          networkHashrateEhs: number | null;
          networkHashrateSource: string;
          poolIncomeUsdPerTh: number | null;
          poolIncomeBtcPerTh: number | null;
          poolIncomeSource: string;
        };
        defaults: {
          kWhCostUsd: number;
          dailyBtcIssuance: number;
          discountAppliesTo: string;
          note: string;
        };
      }>('/settings/gomining'),
    updateGomining: (body: {
      discountPct?: number;
      btcUsd?: number | null;
      networkHashrateEhs?: number | null;
      dailyBtcIssuance?: number | null;
      kWhCostUsd?: number | null;
    }) =>
      req('/settings/gomining', { method: 'PATCH', body: JSON.stringify(body) }),
    getCollectableTypes: () =>
      req<{
        types: Array<{ id: string; title: string; kind: 'mtg' | 'pokemon' | 'manual'; blurb?: string }>;
        presets: Array<{ id: string; title: string; kind: 'mtg' | 'pokemon' | 'manual'; blurb?: string }>;
      }>('/settings/collectable-types'),
    setCollectableTypes: (
      types: Array<{ id: string; title: string; kind: 'mtg' | 'pokemon' | 'manual'; blurb?: string }>,
    ) =>
      req<{
        types: Array<{ id: string; title: string; kind: 'mtg' | 'pokemon' | 'manual'; blurb?: string }>;
        presets: Array<{ id: string; title: string; kind: 'mtg' | 'pokemon' | 'manual'; blurb?: string }>;
      }>('/settings/collectable-types', {
        method: 'PUT',
        body: JSON.stringify({ types }),
      }),
    getAssetClasses: () =>
      req<{
        enabled: Record<string, boolean>;
        options: Array<{ key: string; label: string; blurb: string }>;
        valueSearch: { showCurrencyExchanger: boolean };
      }>('/settings/asset-classes'),
    setAssetClasses: (
      enabled: Record<string, boolean>,
      valueSearch?: { showCurrencyExchanger: boolean },
    ) =>
      req<{
        enabled: Record<string, boolean>;
        options: Array<{ key: string; label: string; blurb: string }>;
        valueSearch: { showCurrencyExchanger: boolean };
      }>('/settings/asset-classes', {
        method: 'PUT',
        body: JSON.stringify({ enabled, valueSearch }),
      }),
    getSnapshotPrefs: () => req<{ dailySnapshot: boolean }>('/settings/snapshots'),
    setSnapshotPrefs: (dailySnapshot: boolean) =>
      req<{ dailySnapshot: boolean }>('/settings/snapshots', {
        method: 'PUT',
        body: JSON.stringify({ dailySnapshot }),
      }),
    getKiwiSaverEmployeeRate: () =>
      req<{
        employeeRatePct: number;
        saved: boolean;
        offeredRates: number[];
        statutoryDefaultPct: number;
      }>('/settings/kiwisaver-employee-rate'),
    setKiwiSaverEmployeeRate: (employeeRatePct: number) =>
      req<{
        employeeRatePct: number;
        saved: boolean;
        offeredRates: number[];
        statutoryDefaultPct: number;
      }>('/settings/kiwisaver-employee-rate', {
        method: 'PUT',
        body: JSON.stringify({ employeeRatePct }),
      }),
    getOnboarding: () =>
      req<{
        onboardingComplete: boolean;
        onboarding: {
          assetClassesDone: boolean;
          budgetCategoriesDone: boolean;
          akahuStepDone: boolean;
        };
      }>('/settings/onboarding'),
    /** The account's plan and its features (KAN-125). */
    plan: () =>
      req<{
        plan: 'free' | 'plus' | 'pro' | 'business';
        features: Record<'household' | 'payslips' | 'crypto_pro' | 'bonds_plus' | 'commodities_plus' | 'business_reports', boolean>;
      }>('/settings/plan'),
    setOnboarding: (body: {
      assetClassesDone?: boolean;
      budgetCategoriesDone?: boolean;
      akahuStepDone?: boolean;
    }) =>
      req<{
        onboardingComplete: boolean;
        onboarding: {
          assetClassesDone: boolean;
          budgetCategoriesDone: boolean;
          akahuStepDone: boolean;
        };
      }>('/settings/onboarding', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    setUsageMode: (mode: UsageMode) =>
      req<{
        usageMode: UsageMode;
        onboardingComplete: boolean;
        onboarding: { assetClassesDone: boolean; budgetCategoriesDone: boolean; akahuStepDone: boolean };
      }>('/settings/usage-mode', { method: 'PUT', body: JSON.stringify({ mode }) }),
  },
  quotes: {
    resolveTicker: (
      ticker: string,
      assetClass: 'crypto' | 'stock',
      opts?: { exchange?: string | null; refresh?: boolean },
    ) => {
      const q = new URLSearchParams({
        ticker: ticker.trim(),
        assetClass,
      });
      if (opts?.exchange != null && String(opts.exchange).trim()) {
        q.set('exchange', String(opts.exchange).trim());
      }
      if (opts?.refresh) q.set('refresh', '1');
      return req<{
        ticker: string;
        assetClass: 'crypto' | 'stock';
        name: string;
        symbol: string | null;
        asset: string | null;
        yahooSymbol?: string | null;
        coingeckoId: string | null;
        iconUrl: string | null;
        quote: {
          assetKey: string;
          currency: string;
          price: number | null;
          status: string;
          source: string;
          asOf: string | null;
          message?: string | null;
        };
        quoteAvailable: boolean;
        /** Source price before NZD conversion; absent from older servers, null for cached or unavailable quotes. */
        nativePrice?: number | null;
        nativeCurrency?: string | null;
        /** Crypto only: a last-good price served while live sources failed. */
        stale?: boolean;
        /** nativeCurrency → NZD rate applied (1 when the source quotes NZD). */
        fxRate?: number | null;
      }>(`/quotes/resolve?${q}`);
    },
    metalsStatus: () =>
      req<{
        configured: boolean;
        provider: string;
        currency: string;
        unit: string;
        metals: string[];
        docs: string;
        signup: string;
        envVar: string;
        quotaBlocked?: boolean;
        quotaMessage?: string | null;
      }>('/quotes/metals/status'),
    metals: (refresh?: boolean) =>
      req<{
        configured: boolean;
        provider: string;
        currency: string;
        unit: string;
        quotes: Array<{
          metal: string;
          assetKey: string;
          currency: string;
          price: number | null;
          status: string;
          source: string;
          asOf: string | null;
          message?: string | null;
        }>;
      }>(`/quotes/metals${refresh ? '?refresh=1' : ''}`),
    refreshMetals: () =>
      req<{
        configured: boolean;
        provider: string;
        currency: string;
        unit: string;
        okCount: number;
        quotes: Array<{
          metal: string;
          assetKey: string;
          currency: string;
          price: number | null;
          status: string;
          source: string;
          asOf: string | null;
          message?: string | null;
        }>;
      }>('/quotes/metals/refresh', { method: 'POST', body: '{}' }),
    stonesStatus: () =>
      req<{
        provider: string;
        configured: boolean;
        apiKeyRequired: boolean;
        diamondOnly: boolean;
        docs: string;
        mcp: string;
        colours: string[];
        clarities: string[];
        shapes: string[];
        caratRange: number[];
        note: string;
      }>('/quotes/stones/status'),
    diamondQuote: (params: {
      carat: number;
      colour: string;
      clarity: string;
      shape?: string;
      force?: boolean;
    }) =>
      req<{
        provider: string;
        currency: string;
        specs: { carat: number; colour: string; clarity: string; shape: string };
        limits: unknown;
        quote: {
          assetKey: string;
          currency: string;
          price: number | null;
          status: string;
          source: string;
          asOf: string | null;
          message?: string | null;
        };
      }>('/quotes/stones/diamond', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    cardQuote: (params: {
      game: 'mtg' | 'pokemon';
      name?: string;
      set?: string;
      number?: string;
      finish?: string;
      apiId?: string;
    }) => {
      const q = new URLSearchParams({ game: params.game });
      if (params.name) q.set('name', params.name);
      if (params.set) q.set('set', params.set);
      if (params.number) q.set('number', params.number);
      if (params.finish) q.set('finish', params.finish);
      if (params.apiId) q.set('apiId', params.apiId);
      return req<{
        provider: string;
        currency: string;
        quote: {
          game: string;
          name: string;
          set: string | null;
          number: string | null;
          finish: string | null;
          apiId: string | null;
          imageUrl: string | null;
          colours: string[] | null;
          rarity: string | null;
          unitUsd: number | null;
          unitNzd: number | null;
          fxRate: number | null;
          status: 'ok' | 'unavailable';
          source: string;
          asOf: string | null;
          message: string | null;
          assetKey: string | null;
        };
      }>(`/quotes/cards?${q}`);
    },
    fxCurrencies: (force = false) => {
      const q = new URLSearchParams();
      if (force) q.set('refresh', '1');
      const qs = q.toString();
      return req<{
        currencies: Array<{
          code: string;
          name: string;
          countries: string[];
          searchText: string;
        }>;
        source: string;
        asOf: string;
        message: string | null;
        count: number;
      }>(`/quotes/fx/currencies${qs ? `?${qs}` : ''}`);
    },
    fx: (params: { from: string; to?: string; amount?: number; force?: boolean }) => {
      const q = new URLSearchParams({ from: params.from.trim().toUpperCase() });
      if (params.to) q.set('to', params.to.trim().toUpperCase());
      if (params.amount != null && Number.isFinite(params.amount)) {
        q.set('amount', String(params.amount));
      }
      if (params.force) q.set('refresh', '1');
      return req<{
        fromCurrency: string;
        toCurrency: string;
        rate: number | null;
        status: 'ok' | 'unavailable';
        source: string;
        asOf: string | null;
        message: string | null;
        amount: number | null;
        convertedAmount: number | null;
        nzd: number | null;
        converted: {
          nzd: number;
          rate: number;
          fromCurrency: string;
          source: string;
          asOf: string;
          message: string;
        } | null;
      }>(`/quotes/fx?${q}`);
    },
    history: (params: {
      assetClass: 'crypto' | 'metal' | 'stock';
      range: '1d' | '5d' | '1m' | '1y';
      ticker?: string;
      metal?: string;
      exchange?: string | null;
    }) => {
      const q = new URLSearchParams({
        assetClass: params.assetClass,
        range: params.range,
      });
      if (params.ticker) q.set('ticker', params.ticker);
      if (params.metal) q.set('metal', params.metal);
      if (params.exchange) q.set('exchange', params.exchange);
      return req<{
        assetClass: string;
        range: string;
        currency: string;
        unit: string;
        status: 'ok' | 'unavailable';
        source: string;
        points: Array<{ at: string; price: number }>;
        message: string | null;
        asOf: string | null;
      }>(`/quotes/history?${q}`);
    },
  },
  dividends: {
    dashboard: (year: number) =>
      req<DividendDashboard>(`/dividends?year=${encodeURIComponent(String(year))}`),
    create: (body: DividendWriteBody) =>
      req<DividendEvent>('/dividends', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: DividendWriteBody) =>
      req<DividendEvent>(`/dividends/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      req<{ ok: boolean; id: string }>(`/dividends/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    /** On/off for one recorded payment. On reinvests that payment's net cash. A paid payment does not add forecast shares. */
    setReinvest: (id: string, reinvested: boolean) =>
      req<DividendReinvestResponse>(`/dividends/${encodeURIComponent(id)}/reinvest`, {
        method: 'PATCH',
        body: JSON.stringify({ reinvested }),
      }),
    /**
     * On/off for one forecast row (`detected[].id` is `holdingId:paymentDate`).
     * Does not save the forecast row as a dividend or income record.
     * On spends the row's gross cash. Tax is not estimated.
     */
    setForecastReinvest: (body: { holdingId: string; paymentDate: string; reinvested: boolean }) =>
      req<ForecastReinvestResponse>('/dividends/forecast-reinvest', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    /** Reinvest every predicted payment of a holding (dividend reinvestment plan). */
    setForecastReinvestAll: (body: { holdingId: string; reinvested: boolean }) =>
      req<{ holdingId: string; reinvested: boolean }>('/dividends/forecast-reinvest-all', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },
  economy: {
    cycle: (opts?: { refresh?: boolean; country?: string; signal?: AbortSignal }) => {
      const q = new URLSearchParams();
      if (opts?.refresh) q.set('refresh', '1');
      if (opts?.country) q.set('country', opts.country);
      const search = q.toString();
      return req<EconomicCycleResponse>(`/economy/cycle${search ? `?${search}` : ''}`, {
        signal: opts?.signal,
      });
    },
    news: (opts?: { phase?: string | null; refresh?: boolean; country?: string | null }) => {
      const q = new URLSearchParams();
      if (opts?.phase) q.set('phase', opts.phase);
      if (opts?.country) q.set('country', opts.country);
      if (opts?.refresh) q.set('refresh', '1');
      const search = q.toString();
      return req<PhaseNewsResponse>(`/economy/news${search ? `?${search}` : ''}`);
    },
    /** Hypothetical re-score of the stored quarter. Read-only on the server. */
    scenario: (body: { country: string; overrides: Record<string, number> }, opts?: { signal?: AbortSignal }) =>
      req<EconomicScenarioResult>('/economy/scenario', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: opts?.signal,
      }),
  },
  news: {
    feed: (opts?: { refresh?: boolean; includeClosed?: boolean }) => {
      const q = new URLSearchParams();
      if (opts?.refresh) q.set('refresh', '1');
      if (opts?.includeClosed === true) q.set('includeClosed', '1');
      if (opts?.includeClosed === false) q.set('includeClosed', '0');
      const search = q.toString();
      return req<NewsFeedResponse>(`/news${search ? `?${search}` : ''}`);
    },
    state: () => req<NewsUserState>('/news/state'),
    saveState: (body: Partial<NewsUserState>) =>
      req<NewsUserState>('/news/state', { method: 'PUT', body: JSON.stringify(body) }),
  },
};

/** Coerce API / legacy balance values (number | string | {current}) to a finite number. */
export function coerceBalance(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'object' && value !== null && 'current' in value) {
    return coerceBalance((value as { current: unknown }).current);
  }
  return null;
}

export function formatNzd(n: number | null | undefined | unknown): string {
  if (isMoneyHidden()) return MONEY_MASK;
  const v = typeof n === 'number' || n == null ? n : coerceBalance(n);
  if (v == null || Number.isNaN(v as number)) return '—';
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
  }).format(v as number);
}

/** Format an amount in any ISO currency (Value Search FX). Never invents. */
export function formatMoney(
  n: number | null | undefined | unknown,
  currency = 'NZD',
): string {
  if (isMoneyHidden()) return MONEY_MASK;
  const v = typeof n === 'number' || n == null ? n : coerceBalance(n);
  if (v == null || Number.isNaN(v as number)) return '—';
  const code = (currency || 'NZD').trim().toUpperCase() || 'NZD';
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'JPY' || code === 'KRW' || code === 'IDR' ? 0 : 4,
    }).format(v as number);
  } catch {
    return `${(v as number).toLocaleString('en-NZ')} ${code}`;
  }
}

export function formatAuckland(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export type SupplierWriteBody = Pick<Supplier, 'name' | 'contactPerson' | 'email' | 'phone' | 'address' | 'nzbn' | 'gstNumber' | 'notes'>;
export type BillWriteBody = {
  supplierId: string;
  kind: BillKind;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  amountNzd: number;
  deliveryNzd: number;
  deliveryTreatment: DeliveryTreatment;
  paidOn: string | null;
  transactionId: string | null;
  notes: string;
};
export type SaleWriteBody = {
  date: string;
  clientId: string | null;
  invoiceId: string | null;
  transactionId: string | null;
  notes: string;
  lines: { itemId: string; quantity: number; unitPriceNzd: number | null }[];
};
export type WageWriteBody = { employeeId: string | null; employeeName: string; date: string; amountNzd: number; transactionId: string | null; notes: string };
export type BudgetCategoryWriteBody = { name: string; kind: 'income' | 'expense'; planCadence: 'month' | 'year' };
