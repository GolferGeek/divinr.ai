export type ColorClass = '' | 'positive' | 'negative' | 'neutral';

export function colorClass(v: number | null | undefined): ColorClass {
  if (v == null) return '';
  if (v > 0) return 'positive';
  if (v < 0) return 'negative';
  return 'neutral';
}
