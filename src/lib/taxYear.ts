/**
 * NZ tax years (KAN-101): 1 April to 31 March. One helper for every module so a combined view
 * can't mix years. Modules keep their own stored keys for backward compatibility:
 *   - by start year: PAYE (payeRates.ts), crypto (cryptoGains.ts), FIF   → 2026 = 2026/27
 *   - by end year:   rentals (rental.ts), donations (server/donations)    → 2027 = 2026/27
 * IRD names a tax year by its end year (1 Apr 2026 – 31 Mar 2027 is "the 2027 tax year"), so
 * new APIs should take the end year. Labels are always "2026/27".
 * https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals
 */

export type TaxYear = {
  /** Calendar year it starts in (1 April). */
  startYear: number;
  /** Calendar year it ends in (31 March); IRD's name for it. */
  endYear: number;
  /** YYYY-MM-DD, 1 April. */
  start: string;
  /** YYYY-MM-DD, 31 March. */
  end: string;
  /** "2026/27". */
  label: string;
};

export function taxYearFromStartYear(startYear: number): TaxYear {
  return {
    startYear,
    endYear: startYear + 1,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
  };
}

export function taxYearFromEndYear(endYear: number): TaxYear {
  return taxYearFromStartYear(endYear - 1);
}

/** Start year of the tax year a YYYY-MM-DD date falls in (31 Mar 2027 → 2026, 1 Apr 2027 → 2027). */
export function taxYearStartForDate(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

/** End year (IRD's name) of the tax year a YYYY-MM-DD date falls in. */
export function taxYearEndForDate(ymd: string): number {
  return taxYearStartForDate(ymd) + 1;
}

export function taxYearForDate(ymd: string): TaxYear {
  return taxYearFromStartYear(taxYearStartForDate(ymd));
}

/** "2026/27" from a start year. */
export function taxYearLabelFromStart(startYear: number): string {
  return taxYearFromStartYear(startYear).label;
}

/** "2026/27" from an end year. */
export function taxYearLabelFromEnd(endYear: number): string {
  return taxYearFromEndYear(endYear).label;
}
