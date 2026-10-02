/**
 * Precious stone quotes — diamonds via OpenFacet (free, no API key).
 * USD total × Frankfurter USD→NZD via convertToNzd. Never invent prices.
 *
 * OpenFacet MCP: POST https://mcp.openfacet.net/
 * Limits: carat 0.3–6.0; color D–M; clarity FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2;
 * shape optional: round|cushion|radiant|emerald|oval|pear|marquise|heart
 *
 * Non-diamond gems: no live API — manual estimated NZD only (user_valuation).
 */
import type { QuoteResult, QuoteSource } from '../../src/types/index.ts';
import { convertToNzd } from './fx.ts';

const OPENFACET_MCP = 'https://mcp.openfacet.net/';
const MCP_PROTOCOL = '2026-07-28';
const FETCH_MS = 20_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // ~1 hour (OpenFacet updates ~daily)

export const DIAMOND_COLOURS = [
  'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
] as const;

export const DIAMOND_CLARITIES = [
  'FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2',
] as const;

export const DIAMOND_SHAPES = [
  'round', 'cushion', 'radiant', 'emerald', 'oval', 'pear', 'marquise', 'heart',
] as const;

export type DiamondColour = (typeof DIAMOND_COLOURS)[number];
export type DiamondClarity = (typeof DIAMOND_CLARITIES)[number];
export type DiamondShape = (typeof DIAMOND_SHAPES)[number];

export type DiamondSpecs = {
  carat: number;
  colour: string;
  clarity: string;
  cut?: string | null;
  shape?: string | null;
};

type CacheEntry = { at: number; quote: QuoteResult };

const quoteCache = new Map<string, CacheEntry>();

export function isDiamondStoneType(stoneType: string): boolean {
  const t = (stoneType || '').trim().toLowerCase();
  return t === 'diamond' || t === 'natural diamond' || t === 'natural_diamond';
}

export function normalizeDiamondColour(raw: string): DiamondColour | null {
  const c = (raw || '').trim().toUpperCase();
  return (DIAMOND_COLOURS as readonly string[]).includes(c)
    ? (c as DiamondColour)
    : null;
}

export function normalizeDiamondClarity(raw: string): DiamondClarity | null {
  const c = (raw || '').trim().toUpperCase();
  return (DIAMOND_CLARITIES as readonly string[]).includes(c)
    ? (c as DiamondClarity)
    : null;
}

export function normalizeDiamondShape(raw: string | null | undefined): DiamondShape {
  const s = (raw || 'round').trim().toLowerCase();
  return (DIAMOND_SHAPES as readonly string[]).includes(s)
    ? (s as DiamondShape)
    : 'round';
}

/** Canonical asset key: STONE:diamond:{carat}:{color}:{clarity}:{shape} */
export function stoneAssetKey(specs: {
  stoneType?: string;
  carat: number;
  colour: string;
  clarity: string;
  cut?: string | null;
  shape?: string | null;
}): string {
  const colour = normalizeDiamondColour(specs.colour) ?? String(specs.colour).toUpperCase();
  const clarity = normalizeDiamondClarity(specs.clarity) ?? String(specs.clarity).toUpperCase();
  const shape = normalizeDiamondShape(specs.cut ?? specs.shape);
  const carat = Number(specs.carat);
  const caratStr = Number.isFinite(carat) ? String(carat) : String(specs.carat);
  return `STONE:diamond:${caratStr}:${colour}:${clarity}:${shape}`;
}

/** Parse STONE:diamond:{carat}:{color}:{clarity}:{shape} */
export function parseStoneAssetKey(assetKey: string): DiamondSpecs | null {
  const m = /^STONE:diamond:([^:]+):([A-Za-z]):([A-Za-z0-9]+):([a-z]+)$/i.exec(
    assetKey.trim(),
  );
  if (!m) return null;
  const carat = Number(m[1]);
  if (!Number.isFinite(carat)) return null;
  return {
    carat,
    colour: m[2].toUpperCase(),
    clarity: m[3].toUpperCase(),
    shape: m[4].toLowerCase(),
    cut: m[4].toLowerCase(),
  };
}

function unavailable(
  assetKey: string,
  message: string,
  source: QuoteSource = 'openfacet',
): QuoteResult {
  return {
    assetKey,
    currency: 'NZD',
    price: null,
    status: 'unavailable',
    source,
    asOf: null,
    message,
  };
}

type OpenFacetStructured = {
  per_carat_usd?: number;
  total_usd?: number;
  carat?: number;
  color?: string;
  clarity?: string;
  shape?: string;
};

type OpenFacetMcpResponse = {
  result?: {
    structuredContent?: OpenFacetStructured;
    _meta?: { timestamp?: string; source?: string };
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: { message?: string; code?: number };
};

async function fetchOpenFacetUsd(specs: {
  carat: number;
  colour: DiamondColour;
  clarity: DiamondClarity;
  shape: DiamondShape;
}): Promise<{
  totalUsd: number | null;
  perCaratUsd: number | null;
  asOf: string | null;
  sourceLabel: string | null;
  message: string | null;
}> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
      name: 'get_diamond_price',
      arguments: {
        carat: specs.carat,
        color: specs.colour,
        clarity: specs.clarity,
        shape: specs.shape,
      },
    },
  };

  try {
    const res = await fetch(OPENFACET_MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'get_diamond_price',
        Accept: 'application/json',
        'User-Agent': 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        totalUsd: null,
        perCaratUsd: null,
        asOf: null,
        sourceLabel: null,
        message: `OpenFacet HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 160)}`,
      };
    }
    const data = JSON.parse(text) as OpenFacetMcpResponse;
    if (data.error) {
      return {
        totalUsd: null,
        perCaratUsd: null,
        asOf: null,
        sourceLabel: null,
        message: `OpenFacet error: ${data.error.message ?? JSON.stringify(data.error)}`,
      };
    }
    const sc = data.result?.structuredContent;
    const meta = data.result?._meta;
    const totalUsd =
      typeof sc?.total_usd === 'number' && Number.isFinite(sc.total_usd) && sc.total_usd > 0
        ? sc.total_usd
        : null;
    const perCaratUsd =
      typeof sc?.per_carat_usd === 'number' && Number.isFinite(sc.per_carat_usd) && sc.per_carat_usd > 0
        ? sc.per_carat_usd
        : null;
    if (totalUsd == null) {
      const errText = data.result?.content?.find((c) => c.type === 'text')?.text;
      return {
        totalUsd: null,
        perCaratUsd: null,
        asOf: meta?.timestamp ?? null,
        sourceLabel: meta?.source ?? null,
        message:
          errText?.slice(0, 200) ??
          'OpenFacet returned no total_usd (never invent)',
      };
    }
    return {
      totalUsd,
      perCaratUsd,
      asOf: meta?.timestamp ?? new Date().toISOString(),
      sourceLabel: meta?.source ?? 'openfacet.net',
      message: null,
    };
  } catch (err) {
    return {
      totalUsd: null,
      perCaratUsd: null,
      asOf: null,
      sourceLabel: null,
      message: `OpenFacet fetch failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Live diamond total valuation in NZD (total_usd × USDNZD).
 * Never invents — unavailable when OpenFacet or FX fails.
 */
export async function quoteDiamondOpenFacet(
  input: DiamondSpecs,
  force = false,
): Promise<QuoteResult> {
  const carat = Number(input.carat);
  const colour = normalizeDiamondColour(input.colour);
  const clarity = normalizeDiamondClarity(input.clarity);
  const shape = normalizeDiamondShape(input.cut ?? input.shape);

  const assetKey = stoneAssetKey({
    carat: Number.isFinite(carat) ? carat : 0,
    colour: colour ?? String(input.colour || '?'),
    clarity: clarity ?? String(input.clarity || '?'),
    shape,
  });

  if (!Number.isFinite(carat) || carat < 0.3 || carat > 6.0) {
    return unavailable(
      assetKey,
      'OpenFacet carat must be between 0.3 and 6.0 (inclusive)',
    );
  }
  if (!colour) {
    return unavailable(
      assetKey,
      `Diamond colour must be one of ${DIAMOND_COLOURS.join(', ')}`,
    );
  }
  if (!clarity) {
    return unavailable(
      assetKey,
      `Diamond clarity must be one of ${DIAMOND_CLARITIES.join(', ')}`,
    );
  }

  if (!force) {
    const hit = quoteCache.get(assetKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.quote;
  }

  const of = await fetchOpenFacetUsd({ carat, colour, clarity, shape });
  if (of.totalUsd == null) {
    const detail = of.message ?? 'OpenFacet quote unavailable';
    const cited = detail.includes('openfacet')
      ? detail
      : `${detail} · source https://openfacet.net/ (MCP https://mcp.openfacet.net/)`;
    const q = unavailable(assetKey, cited);
    quoteCache.set(assetKey, { at: Date.now(), quote: q });
    return q;
  }

  const fx = await convertToNzd(of.totalUsd, 'USD', force);
  if (!fx) {
    const q = unavailable(
      assetKey,
      `OpenFacet $${of.totalUsd.toFixed(2)} USD total, but USD→NZD FX unavailable (Frankfurter/BTC FX) — never invent`,
    );
    quoteCache.set(assetKey, { at: Date.now(), quote: q });
    return q;
  }

  const perCt =
    of.perCaratUsd != null ? `$${of.perCaratUsd.toFixed(0)}/ct USD` : 'per-ct n/a';
  const message =
    `OpenFacet ${carat}ct ${shape} ${colour}/${clarity}: ${perCt}, ` +
    `total $${of.totalUsd.toFixed(2)} USD → ${fx.nzd.toFixed(2)} NZD ` +
    `(@ ${fx.rate.toFixed(4)} via ${fx.source})`;

  const quote: QuoteResult = {
    assetKey,
    currency: 'NZD',
    price: fx.nzd,
    status: 'ok',
    source: 'openfacet',
    asOf: of.asOf ?? fx.asOf,
    message,
  };
  quoteCache.set(assetKey, { at: Date.now(), quote });
  return quote;
}

/** Quote from a STONE:diamond:… asset key (refresh / provider path). */
export async function quoteDiamondFromAssetKey(
  assetKey: string,
  force = false,
): Promise<QuoteResult> {
  const parsed = parseStoneAssetKey(assetKey);
  if (!parsed) {
    return {
      assetKey,
      currency: 'NZD',
      price: null,
      status: 'not_applicable',
      source: 'search_comp',
      asOf: null,
      message:
        'Unrecognized stone asset key. Expected STONE:diamond:{carat}:{color}:{clarity}:{shape}. Diamonds: OpenFacet https://openfacet.net/ (MCP https://mcp.openfacet.net/). Non-diamond gems: manual estimated NZD only — never invent.',
    };
  }
  return quoteDiamondOpenFacet(parsed, force);
}

export function clearStoneQuoteCache(): void {
  quoteCache.clear();
}
