/**
 * Parse a context_markdown string into structured sections.
 *
 * Recognized `## ` headings:
 *   - General
 *   - Role: <name>                                     (legacy, pre-stage-keyed)
 *   - Stage: Predictor Generation
 *   - Stage: Risk Assessment — Reflection (3a)         (em-dash or ASCII `--`)
 *   - Stage: Risk Assessment — Debate (3b)
 *   - Stage: Prediction Generation
 *   - Stage: Learning
 *   - Adaptations
 *
 * Unrecognized headings are ignored. Missing sections return empty strings /
 * empty objects. Shared by MarketsService, AuditService, and the prediction
 * runtime.
 *
 * Effort: stage-keyed-analyst-contracts (extends original analyst-contracts).
 */
import { WorkflowStage } from '../workflow-stages/workflow-stage';

export type StageKey =
  | 'predictorGeneration'
  | 'riskReflection'
  | 'riskDebate'
  | 'predictionGeneration'
  | 'learning';

export type AnalystType = 'personality' | 'arbitrator' | 'portfolio_manager';

export interface ContractSections {
  general: string;
  roles: Record<string, string>;
  stages: Record<StageKey, string>;
  adaptations: string;
}

export interface AdaptationEntry {
  patternType: string;
  date: string;
  instruction: string;
  confidenceShift: number;
  weightShift: number;
}

export interface ContractValidationResult {
  valid: boolean;
  missingSections: string[];
  forbiddenPhrases: string[];
  extraSections: string[];
}

/** Required stage sections per analyst type (see PRD §7 risk 4). */
export const REQUIRED_SECTIONS_BY_TYPE: Record<AnalystType, StageKey[]> = {
  personality: [
    'predictorGeneration',
    'riskReflection',
    'riskDebate',
    'predictionGeneration',
    'learning',
  ],
  arbitrator: ['riskDebate', 'learning'],
  portfolio_manager: ['predictionGeneration', 'learning'],
};

const EMPTY_STAGES: Record<StageKey, string> = {
  predictorGeneration: '',
  riskReflection: '',
  riskDebate: '',
  predictionGeneration: '',
  learning: '',
};

const FORBIDDEN_PHRASES = ['advice', 'recommendation', 'as an ai'];

const STAGE_HEADING_LABELS: Record<StageKey, string> = {
  predictorGeneration: 'Stage: Predictor Generation',
  riskReflection: 'Stage: Risk Assessment — Reflection (3a)',
  riskDebate: 'Stage: Risk Assessment — Debate (3b)',
  predictionGeneration: 'Stage: Prediction Generation',
  learning: 'Stage: Learning',
};

function normalizeHeading(heading: string): string {
  // Collapse whitespace, replace em-dash/en-dash with ASCII `-`, lowercase.
  return heading
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchStageHeading(heading: string): StageKey | null {
  const n = normalizeHeading(heading);
  if (!n.startsWith('stage:')) return null;
  const body = n.slice(6).trim();
  if (body === 'predictor generation') return 'predictorGeneration';
  if (body === 'prediction generation') return 'predictionGeneration';
  if (body === 'learning') return 'learning';
  // Risk Assessment sub-stages — accept `-- Reflection (3a)` or `- Reflection (3a)`.
  const riskMatch = body.match(/^risk assessment\s*-+\s*(reflection|debate)\s*\(?\s*(3a|3b)?\s*\)?$/);
  if (riskMatch) {
    return riskMatch[1] === 'reflection' ? 'riskReflection' : 'riskDebate';
  }
  return null;
}

export function parseContractMarkdown(markdown: string): ContractSections {
  const sections: ContractSections = {
    general: '',
    roles: {},
    stages: { ...EMPTY_STAGES },
    adaptations: '',
  };

  const parts = markdown.split(/^## /m);
  for (const part of parts) {
    const newlineIdx = part.indexOf('\n');
    if (newlineIdx === -1) continue;
    const heading = part.slice(0, newlineIdx).trim();
    const body = part.slice(newlineIdx + 1).trim();
    const normalized = normalizeHeading(heading);

    if (normalized === 'general') {
      sections.general = body;
    } else if (normalized === 'adaptations') {
      sections.adaptations = body;
    } else if (normalized.startsWith('stage:')) {
      const stageKey = matchStageHeading(heading);
      if (stageKey) sections.stages[stageKey] = body;
    } else if (normalized.startsWith('role:')) {
      const roleName = heading.slice(5).trim();
      sections.roles[roleName] = body;
    }
  }

  return sections;
}

/**
 * Map a WorkflowStage + optional sub-stage to its StageKey.
 * Throws for ArticleProcessing — analyst contracts have no Article Processing
 * section (see PRD §4.1 / intention line 40); that stage is instrument-keyed.
 */
export function stageToKey(
  stage: WorkflowStage,
  subStage?: 'reflection' | 'debate',
): StageKey {
  switch (stage) {
    case WorkflowStage.PredictorGeneration:
      return 'predictorGeneration';
    case WorkflowStage.RiskAssessment:
      if (subStage === 'reflection') return 'riskReflection';
      if (subStage === 'debate') return 'riskDebate';
      throw new Error('RiskAssessment requires subStage: "reflection" | "debate"');
    case WorkflowStage.PredictionGeneration:
      return 'predictionGeneration';
    case WorkflowStage.Learning:
      return 'learning';
    case WorkflowStage.ArticleProcessing:
      throw new Error(
        'ArticleProcessing has no analyst-contract section — it is instrument-keyed.',
      );
  }
}

/**
 * Assemble the prompt fragment for a given stage: General + stage section + Adaptations,
 * joined by blank lines. Returns '' if the resolved stage section is empty (callers
 * fall back to legacy persona_prompt path in that case).
 */
export function buildStagePromptFragment(
  sections: ContractSections,
  stage: WorkflowStage,
  subStage?: 'reflection' | 'debate',
): string {
  const key = stageToKey(stage, subStage);
  const stageBody = sections.stages[key];
  if (!stageBody.trim()) return '';
  const parts = [sections.general.trim(), stageBody.trim(), sections.adaptations.trim()]
    .filter((p) => p.length > 0);
  return parts.join('\n\n');
}

/**
 * Validate a contract's section set against the required-section policy for
 * the given analyst type. A section is considered present if it has at least
 * one non-whitespace line. Extra stage sections (present but not required for
 * this type) are flagged. Forbidden phrases are reported with word-boundary
 * matching across all section bodies.
 */
export function validateContractSections(
  sections: ContractSections,
  analystType: AnalystType,
): ContractValidationResult {
  const required = REQUIRED_SECTIONS_BY_TYPE[analystType];
  const requiredSet = new Set<StageKey>(required);

  const missingSections: string[] = [];
  if (!sections.general.trim()) missingSections.push('General');
  for (const key of required) {
    if (!sections.stages[key].trim()) missingSections.push(STAGE_HEADING_LABELS[key]);
  }
  if (!sections.adaptations.trim()) missingSections.push('Adaptations');

  const extraSections: string[] = [];
  for (const key of Object.keys(sections.stages) as StageKey[]) {
    if (sections.stages[key].trim() && !requiredSet.has(key)) {
      extraSections.push(STAGE_HEADING_LABELS[key]);
    }
  }

  const forbiddenPhrases: string[] = [];
  const bodies = [
    sections.general,
    sections.adaptations,
    ...Object.values(sections.stages),
  ].join('\n');
  const lower = bodies.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`);
    if (re.test(lower)) forbiddenPhrases.push(phrase);
  }

  return {
    valid: missingSections.length === 0 && forbiddenPhrases.length === 0 && extraSections.length === 0,
    missingSections,
    forbiddenPhrases,
    extraSections,
  };
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
