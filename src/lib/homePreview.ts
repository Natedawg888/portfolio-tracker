/**
 * Example figures for the public home page preview. Made up, never a real user's data.
 * The take-home tab runs the app's own PAYE engine on an example salary, so those
 * numbers are what the PAYE page would show for the same inputs.
 */
import { calculatePaye } from './payeCalc.ts';
import { KIWISAVER_DEFAULT_EMPLOYEE_RATE, KIWISAVER_EMPLOYER_MIN_RATE } from './payeRates.ts';

export type PreviewTab = 'networth' | 'budget' | 'paye';

export const PREVIEW_TABS: { id: PreviewTab; label: string }[] = [
  { id: 'networth', label: 'Net worth' },
  { id: 'budget', label: 'Budget' },
  { id: 'paye', label: 'Take-home pay' },
];

/** tone picks a theme colour for the bar segment and row swatch (1–4). */
export type PreviewRow = { label: string; amount: number; tone: 1 | 2 | 3 | 4 };

export type PreviewData = {
  figureLabel: string;
  figure: number;
  summary: string;
  rows: PreviewRow[];
  /** Bar segments use the rows' amounts. */
  barLabel: string;
};

const sum = (rows: PreviewRow[]) => rows.reduce((s, r) => s + r.amount, 0);

export const EXAMPLE_SALARY = 70_000;

export function exampleTakeHome() {
  return calculatePaye({
    amount: EXAMPLE_SALARY,
    frequency: 'year',
    hoursPerWeek: 40,
    employment: 'primary',
    secondaryTotalAnnualIncome: 0,
    otherAnnualGross: 0,
    kiwiSaverOptIn: true,
    kiwiSaverEmployeeRatePct: KIWISAVER_DEFAULT_EMPLOYEE_RATE,
    kiwiSaverEmployerRatePct: KIWISAVER_EMPLOYER_MIN_RATE,
    salarySacrifice: false,
    studentLoan: false,
    ietc: true,
    payrollGivingAnnual: 0,
  });
}

export function previewData(tab: PreviewTab): PreviewData {
  if (tab === 'networth') {
    const rows: PreviewRow[] = [
      { label: 'KiwiSaver', amount: 48_200, tone: 1 },
      { label: 'Shares', amount: 31_750, tone: 2 },
      { label: 'Bank accounts', amount: 12_480, tone: 3 },
      { label: 'Crypto', amount: 6_320, tone: 4 },
    ];
    return {
      figureLabel: 'Net worth',
      figure: sum(rows),
      summary: 'Up $1,240 this month across four kinds of asset.',
      rows,
      barLabel: 'Where it sits',
    };
  }
  if (tab === 'budget') {
    const rows: PreviewRow[] = [
      { label: 'Rent', amount: 1_950, tone: 1 },
      { label: 'Food & groceries', amount: 612, tone: 2 },
      { label: 'Transport', amount: 184, tone: 3 },
      { label: 'Eating out', amount: 96, tone: 4 },
    ];
    return {
      figureLabel: 'Spent this month',
      figure: sum(rows),
      summary: 'Day 15 of 31, with 48% of the month gone and 64% of the plan used.',
      rows,
      barLabel: 'Spending by category',
    };
  }
  const b = exampleTakeHome();
  // Together these four rows are the whole salary.
  const rows: PreviewRow[] = [
    { label: 'Take-home', amount: b.takeHome, tone: 1 },
    { label: 'Income tax', amount: b.incomeTax - b.ietcCredit, tone: 2 },
    { label: 'ACC earners’ levy', amount: b.acc, tone: 3 },
    { label: `KiwiSaver (${KIWISAVER_DEFAULT_EMPLOYEE_RATE}%)`, amount: b.kiwiSaverEmployee, tone: 4 },
  ];
  return {
    figureLabel: 'Take-home a year',
    figure: b.takeHome,
    summary: `On a $${EXAMPLE_SALARY.toLocaleString('en-NZ')} salary, main job, tax code ${b.taxCode}, no student loan.`,
    rows,
    barLabel: 'Where the salary goes',
  };
}

/** Arrow keys, Home and End move between tabs (wrapping). */
export function nextPreviewTab(current: PreviewTab, key: string): PreviewTab | null {
  const ids = PREVIEW_TABS.map((t) => t.id);
  const i = ids.indexOf(current);
  const last = ids.length - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[i === last ? 0 : i + 1];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[i === 0 ? last : i - 1];
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[last];
  return null;
}
