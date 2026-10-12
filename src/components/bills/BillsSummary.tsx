import { useState } from 'react';
import { formatNzd } from '../../api/client';
import type { RecurringItem, RecurringListResponse } from '../../types';
import { calendarDays, upcomingOccurrences } from '../../pages/billsView';
import { CalendarStrip } from './CalendarStrip';
import { ComingUp } from './ComingUp';

export function BillsSummary({
  totals,
  items,
  today,
}: {
  totals: RecurringListResponse['totals'];
  items: RecurringItem[];
  today: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const occurrences = upcomingOccurrences(items, today);
  const days = calendarDays(today, occurrences);

  return (
    <section className="card bills-summary" aria-label="Totals">
      <dl>
        <div className="bills-summary-due">
          <dt>Due in the next 30 days</dt>
          <dd className="money">{formatNzd(totals.dueNext30DaysNzd)}</dd>
        </div>
        <div className="bills-summary-period">
          <div>
            <dt>Per month</dt>
            <dd className="money">{formatNzd(totals.monthlyNzd)}</dd>
          </div>
          <div>
            <dt>Per year</dt>
            <dd className="money">{formatNzd(totals.yearlyNzd)}</dd>
          </div>
        </div>
      </dl>
      <CalendarStrip days={days} selected={selected} onSelect={(date) => setSelected(selected === date ? null : date)} />
      <ComingUp occurrences={occurrences} selected={selected} onClear={() => setSelected(null)} />
    </section>
  );
}
