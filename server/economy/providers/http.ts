const USER_AGENT = 'portfolio-tracker/economic-cycle (educational; local)';

export async function fetchBuffer(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxBytes = options.maxBytes ?? 40_000_000;
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new Error(`Response from ${url} is larger than ${maxBytes} bytes`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error(`Response from ${url} is larger than ${maxBytes} bytes`);
  }
  return bytes;
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
