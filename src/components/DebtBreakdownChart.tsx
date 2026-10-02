import { AssetBreakdownChart, type AssetBreakdownRow } from './AssetBreakdownChart';

export type DebtBreakdownPerson = {
  id: string;
  name: string;
  kind: 'person' | 'corporation';
  outstandingNzd: number;
};

const COLOURS = ['#d45a7a', '#c47a2c', '#9a6ad4', '#4a8fd4', '#5ab8a0', '#d4b84a', '#a07050', '#70a0c0'];

function outstanding(value: number): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function DebtBreakdownChart({ people }: { people: DebtBreakdownPerson[] }) {
  const creditorRows: AssetBreakdownRow[] = people.map((person, index) => ({
    key: person.id,
    name: person.name,
    value: outstanding(person.outstandingNzd),
    colour: COLOURS[index % COLOURS.length],
  }));



  return (
    <AssetBreakdownChart
      rows={creditorRows}
      title="Debt breakdown"
      subtitle="Outstanding NZD debt · current creditor balances"
      totalLabel="Total debt"
      centerLabel="Debt"
      pieTitle="Allocation"
      barTitle="By bucket"
      note="Only outstanding balances are shown; repayments reduce these balances."
      headingId="debt-breakdown-title"
      legendLabel="Creditor debt totals"
      chartLabel="debt by creditor"
    />
  );
}
