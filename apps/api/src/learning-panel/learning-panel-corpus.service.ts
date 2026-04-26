import { Injectable, Logger } from '@nestjs/common';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface LearningPanelCorpusChunk {
  source: string;
  title: string;
  content: string;
}

interface FeatureSection {
  heading: string;
  bullets: Array<{ title: string; content: string }>;
}

@Injectable()
export class LearningPanelCorpusService {
  private readonly logger = new Logger(LearningPanelCorpusService.name);
  private featureSectionsPromise: Promise<Map<string, FeatureSection>> | null = null;

  getStarterPrompts(surfaceKey?: string): string[] {
    if (surfaceKey?.startsWith('risk')) {
      return [
        'How do your risk analysts determine their red and blue strategy?',
        'Why is this signal considered risky?',
        'What should I look at before making a trade?',
      ];
    }

    if (surfaceKey?.startsWith('tournament')) {
      return [
        'How do tournaments work?',
        'What is the difference between my portfolio and tournament positions?',
        'What should I learn before joining a tournament?',
      ];
    }

    return [
      'What should I learn first in this system?',
      'What is the difference between my portfolio and analyst portfolios?',
      'How do your analysts decide what matters most?',
    ];
  }

  async getRelevantChunks(surfaceKey?: string): Promise<LearningPanelCorpusChunk[]> {
    const chunks: LearningPanelCorpusChunk[] = [
      {
        source: 'learning-panel.policy',
        title: 'Learning Panel policy',
        content:
          'The Learning Panel is a Divinr-grounded educational assistant. ' +
          'It explains analyses, signals, risk reasoning, portfolios, clubs, tournaments, and visible app capabilities. ' +
          'It does not perform open web research and does not provide investment advice.',
      },
      {
        source: 'learning-panel.core-loop',
        title: 'Core loop',
        content:
          'The core user loop is reading analyses and signals, understanding risk, making paper trades where available, and comparing a user portfolio with analyst portfolios.',
      },
    ];

    const sectionMap = await this.loadFeatureSections();
    for (const heading of this.sectionHeadingsForSurface(surfaceKey)) {
      const section = sectionMap.get(heading);
      if (!section) continue;
      for (const bullet of section.bullets.slice(0, 4)) {
        chunks.push({
          source: `docs.features.${this.slugify(heading)}.${this.slugify(bullet.title)}`,
          title: `${section.heading} — ${bullet.title}`,
          content: bullet.content,
        });
      }
    }

    if (surfaceKey === 'chat') {
      chunks.push({
        source: 'learning-panel.chat-surface',
        title: 'Learning Panel surface',
        content:
          'The Learning Panel is available from the main shell from the beginning. Users can ask what the system does, what to learn next, how analysts and risk work, and how clubs or tournaments fit into the product.',
      });
    }

    if (surfaceKey?.startsWith('risk')) {
      chunks.push({
        source: 'learning-panel.risk',
        title: 'Risk explanation',
        content:
          'Divinr frames risk as structured disagreement. Red and blue agents argue opposing cases and an arbiter synthesizes what matters most.',
      });
    }

    if (surfaceKey?.startsWith('portfolio') || surfaceKey === 'portfolios') {
      chunks.push({
        source: 'learning-panel.portfolios',
        title: 'Portfolios',
        content:
          'User portfolios and analyst portfolios are paper portfolios. They help compare how different analysts and user-enabled triples perform over time.',
      });
    }

    return chunks;
  }

  private async loadFeatureSections(): Promise<Map<string, FeatureSection>> {
    if (!this.featureSectionsPromise) {
      this.featureSectionsPromise = this.readFeatureSections().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to load docs/features.md for Learning Panel corpus: ${message}`);
        return new Map<string, FeatureSection>();
      });
    }
    return this.featureSectionsPromise;
  }

  private async readFeatureSections(): Promise<Map<string, FeatureSection>> {
    const docPath = await this.resolveFeaturesPath();
    const markdown = await readFile(docPath, 'utf8');
    const lines = markdown.split(/\r?\n/);
    const sections = new Map<string, FeatureSection>();
    let current: FeatureSection | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('## ')) {
        current = { heading: line.slice(3).trim(), bullets: [] };
        sections.set(current.heading, current);
        continue;
      }

      if (!current || !line.startsWith('- **')) {
        continue;
      }

      const bulletMatch = line.match(/^- \*\*(.+?)\*\* — (.+)$/);
      if (!bulletMatch) {
        continue;
      }

      current.bullets.push({
        title: bulletMatch[1]!.trim(),
        content: bulletMatch[2]!.trim(),
      });
    }

    return sections;
  }

  private async resolveFeaturesPath(): Promise<string> {
    const candidates = [
      resolve(__dirname, '../../../../docs/features.md'),
      resolve(__dirname, '../../../../../docs/features.md'),
      resolve(process.cwd(), 'docs/features.md'),
      resolve(process.cwd(), '../../docs/features.md'),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    throw new Error('docs/features.md not found from known locations');
  }

  private sectionHeadingsForSurface(surfaceKey?: string): string[] {
    if (!surfaceKey) {
      return ['Analysis & Signal', 'Learning System', 'Onboarding & Explainability'];
    }

    if (surfaceKey.startsWith('risk')) {
      return ['Analysis & Signal', 'Learning System'];
    }

    if (surfaceKey.startsWith('portfolio') || surfaceKey === 'portfolios') {
      return ['Analysis & Signal', 'Platform'];
    }

    if (surfaceKey.startsWith('tournament') || surfaceKey === 'tournaments') {
      return ['Social', 'Platform'];
    }

    if (surfaceKey.startsWith('club') || surfaceKey === 'clubs') {
      return ['Social', 'Onboarding & Explainability'];
    }

    if (surfaceKey.startsWith('analyst') || surfaceKey === 'analysts') {
      return ['Analysis & Signal', 'Learning System', 'Onboarding & Explainability'];
    }

    if (surfaceKey.startsWith('instrument') || surfaceKey === 'instruments') {
      return ['Analysis & Signal', 'Authoring (power users)'];
    }

    if (surfaceKey === 'chat') {
      return ['Onboarding & Explainability', 'Analysis & Signal', 'Social'];
    }

    return ['Analysis & Signal', 'Learning System', 'Platform'];
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
