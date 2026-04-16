/**
 * Shared keyword-match logic for instrument relevance scoring.
 * Extracted from PredictorGeneratorService for reuse by ArticleRelevanceService.
 */

export interface KeywordMatchInput {
  title: string | null;
  summary: string | null;
  content: string | null;
}

export interface InstrumentIdentifiers {
  symbol: string;
  name: string;
}

export function instrumentKeywordScore(
  article: KeywordMatchInput,
  instrument: InstrumentIdentifiers,
): number {
  const text = [article.title, article.summary, article.content?.slice(0, 3000)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const symbol = instrument.symbol.toLowerCase();
  const name = instrument.name.toLowerCase();

  const symbolRegex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  if (symbolRegex.test(text)) return 1.0;

  if (text.includes(name)) return 0.9;

  const firstName = name.split(/\s+/)[0];
  if (firstName && firstName.length > 3 && text.includes(firstName)) return 0.7;

  return 0;
}
