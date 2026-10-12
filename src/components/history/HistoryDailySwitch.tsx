import { useEffect, useState } from 'react';
import { api } from '../../api/client';

export function HistoryDailySwitch() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.settings
      .getSnapshotPrefs()
      .then((p) => {
        if (live) setOn(p.dailySnapshot);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);

  async function toggle() {
    if (on == null) return;
    const next = !on;
    setOn(next);
    setError(null);
    try {
      await api.settings.setSnapshotPrefs(next);
    } catch (e) {
      setOn(!next);
      setError(`Couldn’t save: ${(e as Error).message}`);
    }
  }

  return (
    <div className="history-daily">
      <button
        type="button"
        className={on ? 'asset-toggle on' : 'asset-toggle off'}
        role="switch"
        aria-checked={on === true}
        disabled={on == null}
        onClick={() => void toggle()}
      >
        <span className="asset-toggle-text">
          <span className="asset-toggle-label">Take a snapshot every day</span>
          <span className="asset-toggle-blurb">
            Saves one snapshot a day when you open the Dashboard. Turning it off keeps existing snapshots.
          </span>
        </span>
        <span className="asset-toggle-track" aria-hidden>
          <span className="asset-toggle-knob" />
        </span>
      </button>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </div>
  );
}
