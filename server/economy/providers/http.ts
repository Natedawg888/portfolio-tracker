/**
 * Downloads public extracts.
 * Node's global fetch (undici) gets HTTP 500 from sdmx.oecd.org for CSV
 * queries that node:https returns successfully, so this client uses node:https.
 */
import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';

const USER_AGENT = 'portfolio-tracker/economic-cycle (educational; local)';

export type Download = {
  body: Buffer;
  /** HTTP Last-Modified, when the server sends one. */
  lastModified: string | null;
};

export async function fetchBuffer(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  return (await fetchDownload(url, options)).body;
}

export async function fetchDownload(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Download> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxBytes = options.maxBytes ?? 40_000_000;
  return requestBuffer(url, timeoutMs, maxBytes, 0, null);
}

/**
 * Wayback replay answers a raw-file redirect with a server cookie. The next
 * request has to send it, or the capture can come back as an HTML error page
 * instead of the workbook.
 */
function cookieHeader(headers: IncomingHttpHeaders, previous: string | null, sameHost: boolean): string | null {
  if (!sameHost) return null;
  const raw = headers['set-cookie'];
  const lines = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const pairs = lines
    .map((line) => line.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.length > 0);
  const merged = [previous, ...pairs].filter((part): part is string => Boolean(part)).join('; ');
  return merged || null;
}

function requestBuffer(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  redirects: number,
  cookie: string | null,
): Promise<Download> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (download: Download) => {
      if (settled) return;
      settled = true;
      resolve(download);
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 5) {
            fail(new Error(`Too many redirects for ${url}`));
            return;
          }
          const nextUrl = new URL(res.headers.location, url);
          const nextCookie = cookieHeader(res.headers, cookie, nextUrl.hostname === parsed.hostname);
          requestBuffer(nextUrl.toString(), timeoutMs, maxBytes, redirects + 1, nextCookie).then(succeed, fail);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          fail(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        const declared = Number(res.headers['content-length'] ?? '0');
        if (declared > maxBytes) {
          res.resume();
          fail(new Error(`Response from ${url} is larger than ${maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            fail(new Error(`Response from ${url} is larger than ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const header = res.headers['last-modified'];
          const lastModified = Array.isArray(header) ? (header[0] ?? null) : (header ?? null);
          succeed({ body: Buffer.concat(chunks), lastModified });
        });
        res.on('error', (err) => fail(err));
      },
    );
    req.on('error', (err) => fail(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out after ${timeoutMs}ms for ${url}`));
    });
    req.end();
  });
}

export async function fetchText(url: string, options: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const bytes = await fetchBuffer(url, options);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}
