export type DisclaimerVariant = 'short' | 'full' | 'trade-cta' | 'tournament' | 'club';

export const DISCLAIMERS: Readonly<Record<DisclaimerVariant, string>> = Object.freeze({
  short:
    'Divinr analyzes markets and surfaces signal. Not a prediction model, not investment advice.',
  full:
    'Divinr provides AI-generated analysis and signal for educational and research purposes. This is not a prediction model, and nothing here is investment, financial, or trading advice. All trades shown are paper trades unless explicitly stated.',
  'trade-cta':
    'This is a paper-trade signal, not investment advice. Divinr analyzes markets — it is not a prediction model.',
  tournament:
    'Tournament positions are paper trades. Divinr analyzes markets and surfaces signal — this is not investment advice or a prediction model.',
  club:
    'Investment Learning Club — educational platform for practicing AI-assisted market analysis. Divinr is not a prediction model and this is not investment advice.',
});
