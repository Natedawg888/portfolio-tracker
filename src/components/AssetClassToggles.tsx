import {
  ASSET_CLASS_PREF_OPTIONS,
  type AssetClassPrefKey,
  type AssetClassPrefs,
} from '../lib/assetClassPrefs';

type Props = {
  value: AssetClassPrefs;
  onChange: (next: AssetClassPrefs) => void;
  disabled?: boolean;
};

export function AssetClassToggles({ value, onChange, disabled }: Props) {
  const toggle = (key: AssetClassPrefKey) => {
    onChange({ ...value, [key]: !value[key] });
  };

  const setAll = (on: boolean) => {
    const next = { ...value };
    for (const opt of ASSET_CLASS_PREF_OPTIONS) next[opt.key] = on;
    onChange(next);
  };

  return (
    <div className="asset-toggles">
      <div className="asset-toggles-toolbar">
        <button type="button" className="btn small ghost" disabled={disabled} onClick={() => setAll(true)}>
          Enable all
        </button>
        <button type="button" className="btn small ghost" disabled={disabled} onClick={() => setAll(false)}>
          Disable all
        </button>
      </div>
      <ul className="asset-toggle-list" role="list">
        {ASSET_CLASS_PREF_OPTIONS.map((opt) => {
          const on = value[opt.key] !== false;
          return (
            <li key={opt.key}>
              <button
                type="button"
                className={on ? 'asset-toggle on' : 'asset-toggle off'}
                role="switch"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(opt.key)}
              >
                <span className="asset-toggle-text">
                  <span className="asset-toggle-label">{opt.label}</span>
                  <span className="asset-toggle-blurb">{opt.blurb}</span>
                </span>
                <span className="asset-toggle-track" aria-hidden>
                  <span className="asset-toggle-knob" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
