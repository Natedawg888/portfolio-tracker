/**
 * Minimal structured logging for hosted stdout (Railway / Fly / Render).
 * Never logs secrets or raw cookies.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEY = /(token|secret|password|api[_-]?key|authorization|cookie|sid)/i;

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 500) return value.slice(0, 500) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

function useJson(): boolean {
  const fmt = (process.env.LOG_FORMAT ?? '').toLowerCase();
  if (fmt === 'pretty') return false;
  if (fmt === 'json') return true;
  return process.env.NODE_ENV === 'production';
}

export function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const payload = {
    level,
    msg,
    at: new Date().toISOString(),
    service: 'portfolio-tracker',
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = useJson() ? JSON.stringify(payload) : `[${payload.at}] ${level.toUpperCase()} ${msg} ${fields ? JSON.stringify(redact(fields)) : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log('error', msg, fields),
};
