import { Inject, Injectable, Logger } from '@nestjs/common';
import { BillingSchemaService } from '../billing/billing-schema.service';
import { CredentialsSchemaService } from '../credentials/credentials-schema.service';
import { FirstTouchSchemaService } from '../first-touch/first-touch-schema.service';
import { LearningPanelSchemaService } from '../learning-panel/learning-panel-schema.service';
import { OnboardingSchemaService } from '../onboarding/onboarding-schema.service';
import { ServiceApiKeyService } from '../auth/service-api-key.service';

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
    @Inject(CredentialsSchemaService) private readonly credentialsSchema: CredentialsSchemaService,
    @Inject(FirstTouchSchemaService) private readonly firstTouchSchema: FirstTouchSchemaService,
    @Inject(LearningPanelSchemaService) private readonly learningPanelSchema: LearningPanelSchemaService,
    @Inject(OnboardingSchemaService) private readonly onboardingSchema: OnboardingSchemaService,
    @Inject(ServiceApiKeyService) private readonly serviceApiKeyService: ServiceApiKeyService,
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
      { key: 'credentials', run: () => this.credentialsSchema.ensureSchema() },
      { key: 'onboarding', run: () => this.onboardingSchema.ensureSchema() },
      { key: 'first-touch', run: () => this.firstTouchSchema.ensureSchema() },
      { key: 'learning-panel', run: () => this.learningPanelSchema.ensureSchema() },
      { key: 'service-api-keys', run: () => this.serviceApiKeyService.ensureSchema() },
    ];
  }
}
