function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function label(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return '—';
  return String(value);
}

function renderInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function objectToMarkdown(value: Record<string, unknown>, depth = 0): string {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== 'object') {
      lines.push(`**${label(key)}:** ${scalar(entry)}`);
      continue;
    }
    const heading = '#'.repeat(Math.min(depth + 3, 6));
    lines.push(`${heading} ${label(key)}`);
    if (Array.isArray(entry)) {
      for (const item of entry) {
        lines.push(`- ${typeof item === 'object' && item !== null ? JSON.stringify(item) : scalar(item)}`);
      }
    } else {
      lines.push(objectToMarkdown(entry as Record<string, unknown>, depth + 1));
    }
  }
  return lines.join('\n\n');
}

function normalizeReasoning(value: string): string {
  const trimmed = value.trim();
  const jsonCandidate = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed: unknown = JSON.parse(jsonCandidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return objectToMarkdown(parsed as Record<string, unknown>);
    }
  } catch {
    // The model returned prose or Markdown; render it unchanged.
  }
  return value;
}

/** Render model reasoning as a small, escaped Markdown subset. */
export function renderReasoningMarkdown(value: string): string {
  const markdown = normalizeReasoning(value);
  const escaped = escapeHtml(markdown);
  const lines = escaped.split(/\r?\n/);
  const html: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      html.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }
  }
  closeList();

  return html.join('');
}
