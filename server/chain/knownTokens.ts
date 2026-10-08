/**
 * Well-known ERC-20 tokens per EVM network (KAN-37).
 *
 * Used when no token indexer is available (Blockscout blocks server requests for
 * Polygon / Base / Arbitrum; its multichain API needs a key) and as Ethereum's fallback
 * when Blockscout is down. Balances are read with one Multicall3 balanceOf batch over
 * the network's RPC, so these tokens are found without any key.
 *
 * Every contract, symbol and decimals value was checked on-chain (symbol(), name(),
 * decimals()) on 2026-10-07. Symbols are canonical: bridged USDC is 'USDC.e',
 * and Tether is 'USDT' even where the contract now reports 'USDT0'. Adding a token:
 * check it on-chain the same way; evm.test.ts rejects malformed entries.
 */
import type { WalletNetwork } from '../lib/walletAddress.ts';

export type KnownToken = { contract: string; symbol: string; name: string; decimals: number };

export const KNOWN_TOKENS: Partial<Record<WalletNetwork, readonly KnownToken[]>> = {
  ethereum: [
    { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', name: 'ChainLink Token', decimals: 18 },
    { contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', symbol: 'UNI', name: 'Uniswap', decimals: 18 },
    { contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', symbol: 'stETH', name: 'Liquid staked Ether 2.0', decimals: 18 },
    { contract: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', name: 'Aave Token', decimals: 18 },
  ],
  polygon: [
    { contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC.e', name: 'USD Coin (PoS)', decimals: 6 },
    { contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', name: 'USDT0', decimals: 6 },
    { contract: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', name: '(PoS) Wrapped BTC', decimals: 8 },
    { contract: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: '(PoS) Dai Stablecoin', decimals: 18 },
    { contract: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', symbol: 'WPOL', name: 'Wrapped Polygon Ecosystem Token', decimals: 18 },
    { contract: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', symbol: 'LINK', name: 'ChainLink Token', decimals: 18 },
    { contract: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', symbol: 'AAVE', name: 'Aave (PoS)', decimals: 18 },
  ],
  base: [
    { contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC', name: 'USD Base Coin', decimals: 6 },
    { contract: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { contract: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 },
    { contract: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH', name: 'Coinbase Wrapped Staked ETH', decimals: 18 },
    { contract: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', symbol: 'AERO', name: 'Aerodrome', decimals: 18 },
  ],
  arbitrum: [
    { contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC.e', name: 'USD Coin (Arb1)', decimals: 6 },
    { contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'USD₮0', decimals: 6 },
    { contract: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', name: 'Arbitrum', decimals: 18 },
    { contract: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { contract: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', symbol: 'LINK', name: 'ChainLink Token', decimals: 18 },
    { contract: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', symbol: 'GMX', name: 'GMX', decimals: 18 },
  ],
};
