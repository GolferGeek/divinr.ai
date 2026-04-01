import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LLMService } from './llm.service';
import { LLMController } from './llm.controller';
import { CIDAFMModule } from './cidafm/cidafm.module';
import { ProvidersModule } from './providers/providers.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { UsageModule } from './usage/usage.module';
import { SovereignPolicyModule } from './config/sovereign-policy.module';
import { ModelConfigurationModule } from './config/model-configuration.module';
import { FeatureFlagModule } from '@/config/feature-flag.module';
import { CentralizedRoutingService } from './centralized-routing.service';
import { RunMetadataService } from './run-metadata.service';
import { ProviderConfigService } from './provider-config.service';
import { SecretRedactionService } from './secret-redaction.service';
import { PIIPatternService } from './pii-pattern.service';
import { PseudonymizationService } from './pseudonymization.service';
import { LocalModelStatusService } from './local-model-status.service';
import { LocalLLMService } from './local-llm.service';
import { MemoryManagerService } from './memory-manager.service';
import { ModelMonitorService } from './model-monitor.service';
import { ProductionOptimizationController } from './production-optimization.controller';
import { SanitizationController } from './sanitization.controller';
import { LlmUsageController } from './llm-usage.controller';
import { PIIService } from './pii/pii.service';
import { DictionaryPseudonymizerService } from './pii/dictionary-pseudonymizer.service';
import { PatternRedactionService } from './pii/pattern-redaction.service';
import { LLMServiceFactory } from './services/llm-service-factory';
import { LLMPricingService } from './llm-pricing.service';
import { ObservabilityPlaneModule } from '@orchestratorai/planes/observability';
import { LLMGenerationService } from './services/llm-generation.service';
import { LLMImageService } from './services/llm-image.service';
import { LLMVideoService } from './services/llm-video.service';
import { OllamaDiscoveryService } from './ollama-discovery.service';
import { OllamaStartupService } from './ollama-startup.service';

@Module({
  imports: [
    HttpModule,
    SovereignPolicyModule,
    FeatureFlagModule,
    ModelConfigurationModule,
    // LLM Sub-modules
    CIDAFMModule,
    ProvidersModule,
    EvaluationModule,
    UsageModule,
    ObservabilityPlaneModule,
  ],
  controllers: [
    LLMController,
    LlmUsageController,
    ProductionOptimizationController,
    SanitizationController,
  ],
  providers: [
    LLMService,
    CentralizedRoutingService,
    RunMetadataService,
    ProviderConfigService,
    SecretRedactionService,
    PIIPatternService,
    PseudonymizationService,
    LocalModelStatusService,
    LocalLLMService,
    MemoryManagerService,
    ModelMonitorService,
    PIIService,
    DictionaryPseudonymizerService,
    PatternRedactionService,
    LLMServiceFactory,
    LLMPricingService,
    // Focused LLM Services (decomposed from LLMService)
    LLMGenerationService,
    LLMImageService,
    LLMVideoService,
    // Ollama Discovery and Startup Services
    OllamaDiscoveryService,
    OllamaStartupService,
    // Note: LLM Provider Services (OpenAI, Anthropic, etc.) are NOT registered as providers
    // They are manually instantiated by LLMServiceFactory with specific configurations
  ],
  exports: [
    LLMService,
    CentralizedRoutingService,
    RunMetadataService,
    ProviderConfigService,
    SecretRedactionService,
    PIIPatternService,
    PseudonymizationService,
    LocalModelStatusService,
    LocalLLMService,
    MemoryManagerService,
    ModelMonitorService,
    PIIService,
    DictionaryPseudonymizerService,
    PatternRedactionService,
    LLMServiceFactory,
    LLMPricingService,
    // Focused LLM Services (exported for direct use)
    LLMGenerationService,
    LLMImageService,
    LLMVideoService,
    // Ollama Discovery and Startup Services
    OllamaDiscoveryService,
    OllamaStartupService,
  ],
})
export class LLMModule {}
