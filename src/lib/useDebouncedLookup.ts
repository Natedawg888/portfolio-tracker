/**
 * Runs a lookup after typing pauses (or at once on submit), never on every keystroke.
 * A sequence id drops responses that arrive after a newer lookup started, and a short
 * in-memory cache answers repeats of the same key without a request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type LookupRequest<In> = { key: string; input: In };

export type LookupState<Out> =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'done'; key: string; result: Out }
  | { status: 'error'; key: string; message: string };

const IDLE = { status: 'idle' } as const;

export function useDebouncedLookup<In, Out>({
  request,
  autoRun,
  run,
  onResult,
  delayMs = 500,
  cacheMs = 60_000,
}: {
  /** null clears the result (empty query). */
  request: LookupRequest<In> | null;
  /** False while the query is too short to look up without an explicit submit. */
  autoRun: boolean;
  run: (input: In, opts: { force: boolean }) => Promise<Out>;
  /** Called when a result becomes the one shown (not for superseded responses or errors). */
  onResult?: (input: In, result: Out) => void;
  delayMs?: number;
  cacheMs?: number;
}): {
  state: LookupState<Out>;
  submit: () => void;
  /** Run the request of the next render at once (not forced), e.g. after a shortcut sets the query. */
  runNext: () => void;
} {
  const [state, setState] = useState<LookupState<Out>>(IDLE);
  const seq = useRef(0);
  /** Key of the lookup in flight or last completed; repeats of it are skipped. */
  const lastKey = useRef<string | null>(null);
  const cache = useRef(new Map<string, { at: number; result: Out }>());
  const runRef = useRef(run);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    runRef.current = run;
    onResultRef.current = onResult;
  }, [run, onResult]);

  const start = useCallback(
    (req: LookupRequest<In>, force: boolean) => {
      const hit = cache.current.get(req.key);
      if (!force && hit && Date.now() - hit.at < cacheMs) {
        seq.current += 1;
        lastKey.current = req.key;
        setState({ status: 'done', key: req.key, result: hit.result });
        onResultRef.current?.(req.input, hit.result);
        return;
      }
      const id = ++seq.current;
      lastKey.current = req.key;
      setState({ status: 'loading', key: req.key });
      runRef.current(req.input, { force }).then(
        (result) => {
          cache.current.set(req.key, { at: Date.now(), result });
          if (id !== seq.current) return;
          setState({ status: 'done', key: req.key, result });
          onResultRef.current?.(req.input, result);
        },
        (err: unknown) => {
          if (id !== seq.current) return;
          // Errors are not cached; let the same key retry.
          lastKey.current = null;
          setState({ status: 'error', key: req.key, message: (err as Error).message });
        },
      );
    },
    [cacheMs],
  );

  const key = request?.key ?? null;
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  useEffect(() => {
    if (key == null) {
      // Invalidate anything in flight so a late response can't reappear under an empty box.
      seq.current += 1;
      lastKey.current = null;
      return;
    }
    if (!autoRun || key === lastKey.current) return;
    const timer = setTimeout(() => {
      const req = requestRef.current;
      // Enter or a shortcut may already have started this key while the timer waited.
      if (req && req.key !== lastKey.current) start(req, false);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [key, autoRun, delayMs, start]);

  const immediate = useRef(false);
  useEffect(() => {
    if (!immediate.current) return;
    immediate.current = false;
    const req = requestRef.current;
    if (req && req.key !== lastKey.current) start(req, false);
  });
  const runNext = useCallback(() => {
    immediate.current = true;
  }, []);

  const submit = useCallback(() => {
    const req = requestRef.current;
    if (!req) return;
    if (state.status === 'loading' && state.key === req.key) return;
    start(req, true);
  }, [start, state]);

  // Only ever show the state for the current key: a result for an earlier query must not
  // sit under a new one. While the debounce is pending, show it as loading.
  const visible: LookupState<Out> =
    key == null
      ? IDLE
      : state.status !== 'idle' && state.key === key
        ? state
        : autoRun
          ? { status: 'loading', key }
          : IDLE;
  return { state: visible, submit, runNext };
}
