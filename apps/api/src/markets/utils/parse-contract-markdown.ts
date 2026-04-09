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
