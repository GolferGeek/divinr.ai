import { Inject, Injectable, Logger } from '@nestjs/common';
import { InviteSchemaService } from '../auth/invite-schema.service';
import { BillingSchemaService } from '../billing/billing-schema.service';
import { ClubSchemaService } from '../clubs/club-schema.service';
import { CredentialsSchemaService } from '../credentials/credentials-schema.service';
import { CurriculumSchemaService } from '../curriculum/curriculum-schema.service';
import { FirstTouchSchemaService } from '../first-touch/first-touch-schema.service';
import { LearningPanelSchemaService } from '../learning-panel/learning-panel-schema.service';
import { MarketsSchemaService } from '../markets/schema/markets-schema.service';
import { MasterySchemaService } from '../mastery/mastery-schema.service';
import { MessagingSchemaService } from '../messaging/messaging-schema.service';
import { OnboardingSchemaService } from '../onboarding/onboarding-schema.service';
import { ServiceApiKeyService } from '../auth/service-api-key.service';
import { TournamentSchemaService } from '../tournaments/tournament-schema.service';

export interface SchemaBootstrapTaskResult {
  key: string;
  status: 'ok';
  durationMs: number;
}

@Injectable()
export class SchemaBootstrapService {
  private readonly logger = new Logger(SchemaBootstrapService.name);

  constructor(
    @Inject(BillingSchemaService) private readonly billingSchema: BillingSchemaService,
    @Inject(ClubSchemaService) private readonly clubSchema: ClubSchemaService,
    @Inject(CredentialsSchemaService) private readonly credentialsSchema: CredentialsSchemaService,
    @Inject(CurriculumSchemaService) private readonly curriculumSchema: CurriculumSchemaService,
    @Inject(FirstTouchSchemaService) private readonly firstTouchSchema: FirstTouchSchemaService,
    @Inject(InviteSchemaService) private readonly inviteSchema: InviteSchemaService,
    @Inject(LearningPanelSchemaService) private readonly learningPanelSchema: LearningPanelSchemaService,
    @Inject(MarketsSchemaService) private readonly marketsSchema: MarketsSchemaService,
    @Inject(MasterySchemaService) private readonly masterySchema: MasterySchemaService,
    @Inject(MessagingSchemaService) private readonly messagingSchema: MessagingSchemaService,
    @Inject(OnboardingSchemaService) private readonly onboardingSchema: OnboardingSchemaService,
    @Inject(ServiceApiKeyService) private readonly serviceApiKeyService: ServiceApiKeyService,
    @Inject(TournamentSchemaService) private readonly tournamentSchema: TournamentSchemaService,
  ) {}

  async runAll(): Promise<SchemaBootstrapTaskResult[]> {
    const results: SchemaBootstrapTaskResult[] = [];
    for (const task of this.getTasks()) {
      const startedAt = Date.now();
      this.logger.log(`bootstrap starting: ${task.key}`);
      await task.run();
      const durationMs = Date.now() - startedAt;
      this.logger.log(`bootstrap finished: ${task.key} (${durationMs}ms)`);
      results.push({ key: task.key, status: 'ok', durationMs });
    }
    return results;
  }

  private getTasks(): Array<{ key: string; run: () => Promise<void> }> {
    return [
      { key: 'billing', run: () => this.billingSchema.ensureSchema() },
      { key: 'onboarding', run: () => this.onboardingSchema.ensureSchema() },
      { key: 'markets', run: () => this.marketsSchema.bootstrap() },
      { key: 'messaging', run: () => this.messagingSchema.ensureSchema() },
      { key: 'clubs', run: () => this.clubSchema.ensureSchema() },
      { key: 'tournaments', run: () => this.tournamentSchema.ensureSchema() },
      { key: 'curriculum', run: () => this.curriculumSchema.ensureSchema() },
      { key: 'credentials', run: () => this.credentialsSchema.ensureSchema() },
      { key: 'invites', run: () => this.inviteSchema.ensureSchema() },
      { key: 'first-touch', run: () => this.firstTouchSchema.ensureSchema() },
      { key: 'learning-panel', run: () => this.learningPanelSchema.ensureSchema() },
      { key: 'mastery', run: () => this.masterySchema.ensureSchema() },
      { key: 'service-api-keys', run: () => this.serviceApiKeyService.ensureSchema() },
    ];
  }
}
