export function ValueSearchBox({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter: look up now, bypassing the debounce and the client cache. */
  onSubmit: () => void;
}) {
  return (
    <form
      className="vs-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="value-search-query" className="sr-only">
        Search for a stock, coin, card, metal, currency or miner
      </label>
      <input
        id="value-search-query"
        className="vs-search-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Try SPCX, BTC, Lightning Bolt, silver, 100 USD to NZD"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
    </form>
  );
}
