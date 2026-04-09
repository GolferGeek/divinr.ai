/**
 * Parse a context_markdown string into structured sections.
 * Splits on `## ` headings: General, Role: <name>, Adaptations.
 * Unrecognized headings are ignored. Missing sections return empty strings.
 *
 * Shared by MarketsService and AuditService. Effort: analyst-contracts.
 */
export interface ContractSections {
  general: string;
  roles: Record<string, string>;
  adaptations: string;
}

export interface AdaptationEntry {
  patternType: string;
  date: string;
  instruction: string;
  confidenceShift: number;
  weightShift: number;
}

export function parseContractMarkdown(markdown: string): ContractSections {
  const sections: ContractSections = {
    general: '',
    roles: {},
    adaptations: '',
  };

  const parts = markdown.split(/^## /m);
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = part.slice(0, newlineIdx).trim();
    const body = part.slice(newlineIdx + 1).trim();

    if (heading.toLowerCase() === 'general') {
      sections.general = body;
    } else if (heading.toLowerCase().startsWith('role:')) {
      const roleName = heading.slice(5).trim();
      sections.roles[roleName] = body;
    } else if (heading.toLowerCase() === 'adaptations') {
      sections.adaptations = body;
    }
  }

  return sections;
}

/**
 * Insert or replace an adaptation entry in a contract's ## Adaptations section.
 * If the section doesn't exist, it is appended to the document.
 * Idempotent: if an entry with the same patternType already exists, it is replaced.
 */
export function updateAdaptationsSection(
  contractMarkdown: string,
  newEntry: AdaptationEntry,
): string {
  const entryBlock = formatAdaptationEntry(newEntry);

  // Split the document on ## headings, preserving the delimiter
  const headingRe = /^## /m;
  const parts = contractMarkdown.split(headingRe);

  // Find the Adaptations part index
  let adaptIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    const heading = parts[i].split('\n')[0].trim().toLowerCase();
    if (heading === 'adaptations') {
      adaptIdx = i;
      break;
    }
  }

  if (adaptIdx === -1) {
    // No ## Adaptations section — append one
    const trimmed = contractMarkdown.trimEnd();
    return `${trimmed}\n\n## Adaptations\n\n${entryBlock}\n`;
  }

  // Parse the existing adaptations body
  const adaptPart = parts[adaptIdx];
  const firstNewline = adaptPart.indexOf('\n');
  const body = firstNewline === -1 ? '' : adaptPart.slice(firstNewline + 1);

  // Remove existing entry with same patternType (idempotent replace)
  const existingEntries = splitAdaptationEntries(body);
  const filtered = existingEntries.filter(
    (e) => !e.heading.toLowerCase().startsWith(newEntry.patternType.toLowerCase()),
  );
  filtered.push({ heading: '', body: entryBlock });

  // Rebuild the adaptations body from entries
  const newBody = filtered.map((e) => (e.heading ? `### ${e.heading}\n${e.body}` : e.body)).join('\n\n');

  // Reassemble the document
  parts[adaptIdx] = `Adaptations\n\n${newBody.trim()}\n`;
  return parts.map((p, i) => (i === 0 ? p : `## ${p}`)).join('');
}

function formatAdaptationEntry(entry: AdaptationEntry): string {
  const lines = [
    `### ${entry.patternType} — ${entry.date}`,
    entry.instruction,
    `Source: tier1_auto | Confidence shift: ${entry.confidenceShift}% | Weight shift: ${entry.weightShift}`,
  ];
  return lines.join('\n');
}

/** Split an adaptations body into individual ### entries. */
function splitAdaptationEntries(body: string): Array<{ heading: string; body: string }> {
  const entries: Array<{ heading: string; body: string }> = [];
  const parts = body.split(/^### /m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newlineIdx = trimmed.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = trimmed.slice(0, newlineIdx).trim();
    const entryBody = trimmed.slice(newlineIdx + 1).trim();
    entries.push({ heading, body: entryBody });
  }
  return entries;
}
