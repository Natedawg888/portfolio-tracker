/**
 * Working for Families estimate for the household (KAN-79).
 *
 * NZ has no joint tax, so each person's PAYE stays individual (paye.ts). Only these family tax
 * credits depend on family income: the income of the two partners (or a sole parent), taken
 * from the pay they share with the household. If a partner doesn't share their pay there's no
 * estimate, since their income would be missing.
 *
 * Owners and adults set the details (partners, children by birth month, main benefit) and see
 * the estimate; viewers don't, since it shows the partners' combined income. Educational only:
 * rates come from payeRates.ts, and a year without loaded rates gives no estimate.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { payTaxYearRates } from '../../src/lib/payeRates.ts';
import { estimateWff, type WffResult } from '../../src/lib/wffCalc.ts';
import { householdActive, logActivity, membershipOf } from './store.ts';
import { nameOf, pickTaxYear, sharedPayOf } from './paye.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });

export const MAX_CHILDREN = 12;
type Child = { id: string; birthMonth: string; memberId: string | null };

export type FamilyView = {
  taxYear: number;
  yearLabel: string;
  canEdit: boolean;
  members: { id: string; name: string }[];
  partners: { memberId: string; name: string; sharesPay: boolean }[];
  children: (Child & { memberName: string | null })[];
  mainBenefit: boolean;
  /** null when this tax year has no Working for Families rates loaded. */
  rates: { checkedOn: string; sources: { label: string; url: string }[] } | null;
  /** Why there's no estimate, when there isn't one. */
  missing: string | null;
  familyIncomeNzd: number | null;
  estimate: WffResult | null;
};

function read(db: Database, householdId: string): { partners: string[]; children: Child[]; mainBenefit: boolean } {
  const r = queryOne<{ partner_ids_json: string; children_json: string; main_benefit: number }>(db, `SELECT * FROM household_family WHERE household_id = ?`, [householdId]);
  if (!r) return { partners: [], children: [], mainBenefit: false };
  try {
    return { partners: JSON.parse(r.partner_ids_json) as string[], children: JSON.parse(r.children_json) as Child[], mainBenefit: r.main_benefit === 1 };
  } catch {
    return { partners: [], children: [], mainBenefit: false };
  }
}

function currentMembers(db: Database, householdId: string): string[] {
  return queryAll<{ user_id: string }>(db, `SELECT user_id FROM household_members WHERE household_id = ? ORDER BY joined_at`, [householdId]).map((r) => r.user_id);
}

export function familyEstimate(db: Database, userId: string, yearRaw?: unknown): Result<FamilyView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role === 'viewer') return fail(403, 'Only adults can see the family tax credit estimate');
  const taxYear = pickTaxYear(yearRaw);
  const yearRates = payTaxYearRates(taxYear);
  const ids = currentMembers(db, m.householdId);
  const names = new Map(ids.map((id) => [id, nameOf(db, id)]));
  const fam = read(db, m.householdId);
  const partnerIds = fam.partners.filter((id) => names.has(id));
  const pay = new Map(partnerIds.map((id) => [id, sharedPayOf(db, m.householdId, id, taxYear)]));
  const partners = partnerIds.map((id) => ({ memberId: id, name: names.get(id)!, sharesPay: pay.get(id) != null }));

  let missing: string | null = null;
  let estimate: WffResult | null = null;
  let familyIncomeNzd: number | null = null;
  const wff = yearRates.wff;
  if (!wff) missing = 'Working for Families rates for this tax year aren’t loaded.';
  else if (!partners.length) missing = 'Choose who the parents or caregivers are.';
  else if (partners.some((p) => !p.sharesPay)) missing = `${partners.filter((p) => !p.sharesPay).map((p) => p.name).join(' and ')} needs to share their pay first, so family income is complete.`;
  else if (!fam.children.length) missing = 'Add your dependent children.';
  else {
    const lines = partnerIds.flatMap((id) => pay.get(id) ?? []);
    const income = roundMoney(lines.reduce((s, l) => s + l.grossNzd, 0));
    familyIncomeNzd = income;
    estimate = estimateWff(
      {
        taxYearStart: yearRates.start,
        familyIncome: income,
        familyIncomeTax: lines.reduce((s, l) => s + l.incomeTaxNzd, 0),
        couple: partners.length === 2,
        children: fam.children,
        inPaidWork: income > 0,
        hoursPerWeek: lines.reduce((s, l) => s + l.hoursPerWeek, 0),
        mainBenefit: fam.mainBenefit,
      },
      wff,
    );
    if (lines.some((l) => l.kind === 'salary' && l.taxCode?.startsWith('ME'))) {
      estimate.notes.push('You can’t get the independent earner tax credit (ME tax code) and Working for Families at the same time. Change tax code when you apply.');
    }
  }

  return {
    ok: true,
    value: {
      taxYear,
      yearLabel: yearRates.label,
      canEdit: householdActive(db, m),
      members: ids.map((id) => ({ id, name: names.get(id)! })),
      partners,
      children: fam.children.map((c) => ({ ...c, memberId: c.memberId && names.has(c.memberId) ? c.memberId : null, memberName: c.memberId ? names.get(c.memberId) ?? null : null })),
      mainBenefit: fam.mainBenefit,
      rates: wff ? { checkedOn: wff.checkedOn, sources: [...wff.sources] } : null,
      missing,
      familyIncomeNzd,
      estimate,
    },
  };
}

/** Body: { partnerIds: string[], children: [{ id?, birthMonth, memberId? }], mainBenefit }. */
export function setFamily(db: Database, userId: string, body: unknown): Result<FamilyView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role === 'viewer') return fail(403, 'Only adults can change family details');
  if (!householdActive(db, m)) return fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');
  const b = (body ?? {}) as { partnerIds?: unknown; children?: unknown; mainBenefit?: unknown };
  const members = new Set(currentMembers(db, m.householdId));
  const partnerIds = Array.isArray(b.partnerIds) ? [...new Set(b.partnerIds.filter((x): x is string => typeof x === 'string'))] : [];
  if (partnerIds.length > 2) return fail(400, 'Choose one or two parents or caregivers');
  if (partnerIds.some((id) => !members.has(id))) return fail(400, 'Parents or caregivers must be in the household');
  const rawKids = Array.isArray(b.children) ? b.children : [];
  if (rawKids.length > MAX_CHILDREN) return fail(400, `Up to ${MAX_CHILDREN} children`);
  const thisMonth = aucklandToday().slice(0, 7);
  const children: Child[] = [];
  for (const [i, raw] of rawKids.entries()) {
    const c = (raw ?? {}) as { id?: unknown; birthMonth?: unknown; memberId?: unknown };
    const birthMonth = typeof c.birthMonth === 'string' ? c.birthMonth.slice(0, 7) : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(birthMonth) || birthMonth > thisMonth || birthMonth < '1990-01') return fail(400, 'Enter each child’s birth month');
    const memberId = typeof c.memberId === 'string' && c.memberId ? c.memberId : null;
    if (memberId && (!members.has(memberId) || partnerIds.includes(memberId))) return fail(400, 'A child can only be linked to a household member who isn’t a parent');
    children.push({ id: typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : `child-${i + 1}`, birthMonth, memberId });
  }
  run(
    db,
    `INSERT INTO household_family (household_id, partner_ids_json, children_json, main_benefit, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(household_id) DO UPDATE SET partner_ids_json = excluded.partner_ids_json, children_json = excluded.children_json,
       main_benefit = excluded.main_benefit, updated_at = excluded.updated_at`,
    [m.householdId, JSON.stringify(partnerIds), JSON.stringify(children), b.mainBenefit === true ? 1 : 0, new Date().toISOString()],
  );
  // No names, dates or amounts.
  logActivity(db, m.householdId, userId, 'updated the family details for tax credits');
  return familyEstimate(db, userId, (body as { taxYear?: unknown } | null)?.taxYear);
}
