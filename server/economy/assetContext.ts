/**
 * Historical asset-class context for a phase. Educational only.
 * Tendencies describe past patterns. They are not instructions.
 */
import type { Phase } from './types.ts';

export const ASSET_CLASS_IDS = ['equities', 'property', 'bonds', 'cash', 'commodities'] as const;
export type AssetClassId = (typeof ASSET_CLASS_IDS)[number];
export type Tendency = 'positive' | 'neutral' | 'negative';

export type AssetClassContext = {
  id: AssetClassId;
  label: string;
  tendency: Tendency;
  explanation: string;
};

const LABELS: Record<AssetClassId, string> = {
  equities: 'Equities',
  property: 'Property',
  bonds: 'Bonds',
  cash: 'Cash / term deposits',
  commodities: 'Commodities',
};

type Row = { tendency: Tendency; explanation: string };

const COPY: Record<Phase, Record<AssetClassId, Row>> = {
  recovery: {
    equities: {
      tendency: 'positive',
      explanation:
        'Historically, equities have often begun recovering before the broader economy because markets tend to anticipate future economic conditions.',
    },
    property: {
      tendency: 'neutral',
      explanation:
        'Property markets have often responded more slowly than share markets around a turn out of a weak period, with prices and turnover following changes in jobs and financing conditions.',
    },
    bonds: {
      tendency: 'positive',
      explanation:
        'Bond prices have often been supported in early recoveries when policy interest rates were easing, although inflation surprises have sometimes offset that pattern.',
    },
    cash: {
      tendency: 'neutral',
      explanation:
        'Cash and term-deposit rates have often started to ease as policy rates fell, while the nominal value of cash balances stayed stable.',
    },
    commodities: {
      tendency: 'neutral',
      explanation:
        'Commodity prices have been mixed in early recoveries, depending more on global demand than on the domestic phase alone.',
    },
  },
  expansion: {
    equities: {
      tendency: 'positive',
      explanation:
        'During expansions, equities have often risen alongside profits and spending, though valuations and global shocks have produced large exceptions.',
    },
    property: {
      tendency: 'positive',
      explanation:
        'Property activity and prices have often firmed during expansions as employment and borrowing capacity improved. Local supply and credit settings have mattered as much as the phase.',
    },
    bonds: {
      tendency: 'neutral',
      explanation:
        'Bond returns have often been more muted in expansions when yields drifted higher, while coupon income still contributed. Results have varied with the inflation path.',
    },
    cash: {
      tendency: 'neutral',
      explanation:
        'Cash and term deposits have tended to offer stability in expansions, with rates following the policy rate rather than growth itself.',
    },
    commodities: {
      tendency: 'positive',
      explanation:
        'Industrial commodity prices have often been firm when global activity was expanding. Results have differed widely by commodity.',
    },
  },
  late_expansion: {
    equities: {
      tendency: 'neutral',
      explanation:
        'Late in expansions, equities have sometimes kept rising with earnings while becoming more sensitive to inflation and interest-rate surprises. Past results have not been one-directional.',
    },
    property: {
      tendency: 'neutral',
      explanation:
        'Property markets have often been active late in expansions, and they have also been exposed when borrowing costs were already high. Outcomes have depended on local supply and credit.',
    },
    bonds: {
      tendency: 'negative',
      explanation:
        'Bond prices have often faced pressure late in expansions when inflation was rising and policy rates were high or still increasing. That pattern has not held in every episode.',
    },
    cash: {
      tendency: 'positive',
      explanation:
        'Cash and term-deposit rates have often been relatively high late in expansions, so interest on deposits has tended to be firmer than earlier in the cycle. Nominal capital stayed stable.',
    },
    commodities: {
      tendency: 'positive',
      explanation:
        'Commodity prices have often been elevated late in expansions when demand was strong, with sharp reversals once demand cooled. The mix has varied by commodity.',
    },
  },
  slowdown: {
    equities: {
      tendency: 'negative',
      explanation:
        'As growth has slowed, equities have often weakened or become more volatile as markets reassessed future earnings. Some slowdowns have been brief and were not followed by large declines.',
    },
    property: {
      tendency: 'negative',
      explanation:
        'Property turnover and price growth have often cooled in slowdowns as buyers and lenders became more cautious. The timing has varied by region.',
    },
    bonds: {
      tendency: 'positive',
      explanation:
        'Bond prices have often stabilised or risen in slowdowns when markets anticipated lower future policy rates and inflation eased. Inflation setbacks have been an exception.',
    },
    cash: {
      tendency: 'neutral',
      explanation:
        'Cash and term deposits have remained nominally stable in slowdowns. Deposit rates have sometimes stayed high for a time after activity softened, then followed policy rates lower.',
    },
    commodities: {
      tendency: 'negative',
      explanation:
        'Commodity prices have often softened when global activity slowed, with energy and industrial metals more sensitive than some agricultural prices.',
    },
  },
  recession: {
    equities: {
      tendency: 'negative',
      explanation:
        'In recessions, equities have often fallen as earnings weakened, although prices have sometimes begun to recover before the economy itself did.',
    },
    property: {
      tendency: 'negative',
      explanation:
        'Property markets have often been subdued in recessions, with weaker turnover and softer prices, especially when unemployment was rising. The depth has varied by country and by supply.',
    },
    bonds: {
      tendency: 'positive',
      explanation:
        'Government bond prices have often risen in recessions when policy rates were cut and inflation cooled. Credit-sensitive bonds have not always shared that pattern.',
    },
    cash: {
      tendency: 'neutral',
      explanation:
        'Cash and term deposits have preserved nominal capital in recessions. Interest rates on new deposits have often declined as the central bank eased.',
    },
    commodities: {
      tendency: 'negative',
      explanation:
        'Many commodity prices have fallen during recessions as demand contracted, then stabilised as activity turned. Some agricultural prices have not always followed that path.',
    },
  },
};

export function assetClassContext(phase: Phase): AssetClassContext[] {
  return ASSET_CLASS_IDS.map((id) => ({
    id,
    label: LABELS[id],
    tendency: COPY[phase][id].tendency,
    explanation: COPY[phase][id].explanation,
  }));
}
