export function pluralize(
  count: number | null | undefined,
  singular: string,
  plural?: string,
): string {
  const n = Number(count) || 0;
  if (n === 1) return `${n} ${singular}`;
  return `${n} ${plural ?? singular + 's'}`;
}
