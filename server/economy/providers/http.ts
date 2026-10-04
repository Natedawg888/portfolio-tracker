/**
 * Downloads public extracts.
 * Node's global fetch (undici) gets HTTP 500 from sdmx.oecd.org for CSV
 * queries that node:https returns successfully, so this client uses node:https.
 */
import http from 'node:http';
import https from 'node:https';

const USER_AGENT = 'portfolio-tracker/economic-cycle (educational; local)';

export async function fetchBuffer(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxBytes = options.maxBytes ?? 40_000_000;
  return requestBuffer(url, timeoutMs, maxBytes, 0);
}

function requestBuffer(url: string, timeoutMs: number, maxBytes: number, redirects: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (body: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(body);
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
          const next = new URL(res.headers.location, url).toString();
          requestBuffer(next, timeoutMs, maxBytes, redirects + 1).then(succeed, fail);
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
        res.on('end', () => succeed(Buffer.concat(chunks)));
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
