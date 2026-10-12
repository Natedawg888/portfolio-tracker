import { PayeChoiceRow } from '../PayeChoiceRow';
import { SEARCH_TYPE_LABEL, type SearchType } from '../../lib/valueSearchDetect';

export type TypeChoice = SearchType | 'auto';

export function TypePicker({
  value,
  types,
  detected,
  onChange,
}: {
  value: TypeChoice;
  /** Enabled types only, in display order. */
  types: readonly SearchType[];
  /** What Auto resolved the current query to; null when the query is empty. */
  detected: SearchType | null;
  onChange: (next: TypeChoice) => void;
}) {
  const options = [
    { value: 'auto' as const, label: detected ? `Auto · ${SEARCH_TYPE_LABEL[detected]}` : 'Auto' },
    ...types.map((t) => ({ value: t, label: SEARCH_TYPE_LABEL[t] })),
  ];
  return (
    <div className="vs-types">
      <PayeChoiceRow<TypeChoice>
        label="Search as"
        ariaLabel="Search type"
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}
