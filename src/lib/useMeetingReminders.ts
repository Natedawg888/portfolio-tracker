/**
 * In-app meeting reminders: while the app is open and visible, ask the server once a minute for
 * reminders that are due and show each as a toast. The server hands each one out only once.
 */
import { useEffect } from 'react';
import { api } from '../api/client';
import { reminderMessage } from './calendarView';
import { showQuietToast } from './quietToast';

const POLL_MS = 60_000;

export function useMeetingReminders(): void {
  useEffect(() => {
    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        for (const r of await api.calendar.dueReminders()) showQuietToast(reminderMessage(r), { kind: 'info', ttlMs: 20_000 });
      } catch {
        // A missed poll is retried on the next one; reminders stay due until shown.
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
