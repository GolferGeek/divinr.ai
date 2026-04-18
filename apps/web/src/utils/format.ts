export function pluralize(
  count: number | null | undefined,
  singular: string,
  plural?: string,
): string {
  const n = Number(count) || 0;
  if (n === 1) return `${n} ${singular}`;
  return `${n} ${plural ?? singular + 's'}`;
}

export function formatBadge(n: number | undefined): string {
  if (!n || n <= 0) return '';
  if (n > 99) return '99+';
  return String(n);
}
