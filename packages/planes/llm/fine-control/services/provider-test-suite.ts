/**
 * Provider Test Suite
 *
 * This file demonstrates how to test all your LLM providers using the standardized
 * BaseLLMService interface. This is exactly what you mentioned - being able to
 * easily test all your models and providers!
 */

import { Logger } from '@nestjs/common';
import {
  LLMServiceConfig,
  LLMResponse,
  ProviderHealthStatus,
} from './llm-interfaces';
import { testOpenAIService } from './openai-llm.service';
import { testAnthropicService } from './anthropic-llm.service';
import { testOllamaService } from './ollama-llm.service';
import { testGrokService } from './grok-llm.service';
import { testGoogleService } from './google-llm.service';

const suiteLogger = new Logger('ProviderTestSuite');

/**
 * Provider test configuration
 */
interface ProviderTestConfig {
  name: string;
  config: LLMServiceConfig;
  enabled: boolean;
  testPrompts: {
    simple: string;
    complex: string;
    creative: string;
  };
}

/**
 * Test results interface
 */
interface TestResult {
  provider: string;
  model: string;
  success: boolean;
  response?: LLMResponse;
  error?: string;
  duration: number;
  cost?: number;
}

/**
 * Comprehensive test suite for all providers
 */
export class ProviderTestSuite {
  private readonly logger = new Logger(ProviderTestSuite.name);
  private readonly testConfigs: ProviderTestConfig[] = [
    {
      name: 'OpenAI GPT-4o Mini',
      config: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.OPENAI_API_KEY,
      testPrompts: {
        simple: 'Hello, how are you?',
        complex: 'Explain quantum computing in simple terms.',
        creative: 'Write a short poem about artificial intelligence.',
      },
    },
    {
      name: 'OpenAI GPT-4o',
      config: {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.OPENAI_API_KEY,
      testPrompts: {
        simple: 'Hello, how are you?',
        complex: 'Analyze the pros and cons of renewable energy.',
        creative: 'Create a story about a robot learning to paint.',
      },
    },
    {
      name: 'Anthropic Claude 3.5 Sonnet',
      config: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.ANTHROPIC_API_KEY,
      testPrompts: {
        simple: 'Hello, how are you today?',
        complex: 'Discuss the ethical implications of AI in healthcare.',
        creative: 'Write a haiku about machine learning.',
      },
    },
    {
      name: 'Anthropic Claude 3.5 Haiku',
      config: {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.ANTHROPIC_API_KEY,
      testPrompts: {
        simple: 'Hello, how are you today?',
        complex: 'Explain the concept of neural networks.',
        creative: 'Write a limerick about coding.',
      },
    },
    {
      name: 'Ollama Llama 3.2 3B',
      config: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        temperature: 0.7,
        maxTokens: 1000,
        baseUrl: 'http://localhost:11434',
      },
      enabled: true, // Always try Ollama, will fail gracefully if not available
      testPrompts: {
        simple: 'Hello, tell me about yourself.',
        complex: 'What are the benefits of running AI models locally?',
        creative: 'Write a short story about a local AI assistant.',
      },
    },
    {
      name: 'Ollama Llama 3.2 1B',
      config: {
        provider: 'ollama',
        model: 'llama3.2:1b',
        temperature: 0.7,
        maxTokens: 500,
        baseUrl: 'http://localhost:11434',
      },
      enabled: true,
      testPrompts: {
        simple: 'Hi there!',
        complex: 'Explain machine learning briefly.',
        creative: 'Write a tweet about AI.',
      },
    },
    {
      name: 'Grok Beta',
      config: {
        provider: 'grok',
        model: 'grok-beta',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.XAI_API_KEY,
      testPrompts: {
        simple: 'Hello Grok, how are you?',
        complex: 'What makes you different from other AI models?',
        creative: 'Write a witty response about the future of AI.',
      },
    },
    {
      name: 'Google Gemini 1.5 Flash',
      config: {
        provider: 'google',
        model: 'gemini-1.5-flash',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.GOOGLE_API_KEY,
      testPrompts: {
        simple: 'Hello, how can you help me?',
        complex: 'Explain the advantages of multimodal AI systems.',
        creative:
          'Write a poem about the intersection of technology and creativity.',
      },
    },
    {
      name: 'Google Gemini 1.5 Pro',
      config: {
        provider: 'google',
        model: 'gemini-1.5-pro',
        temperature: 0.7,
        maxTokens: 1000,
      },
      enabled: !!process.env.GOOGLE_API_KEY,
      testPrompts: {
        simple: 'Hello, how can you help me?',
        complex:
          'Analyze the current state of artificial general intelligence research.',
        creative:
          'Create a detailed story about AI helping solve climate change.',
      },
    },
  ];

  /**
   * Run tests for all enabled providers
   */
  async runAllTests(): Promise<TestResult[]> {
    this.logger.log('Starting comprehensive provider test suite...');

    const results: TestResult[] = [];

    for (const testConfig of this.testConfigs) {
      if (!testConfig.enabled) {
        this.logger.log(`Skipping ${testConfig.name} (not enabled)`);
        continue;
      }

      this.logger.log(`Testing ${testConfig.name}...`);

      // Test simple prompt
      const simpleResult = await this.testProvider(
        testConfig,
        'You are a helpful assistant.',
        testConfig.testPrompts.simple,
      );
      results.push(simpleResult);

      // Test complex prompt (only if simple succeeded)
      if (simpleResult.success) {
        const complexResult = await this.testProvider(
          testConfig,
          'You are an expert educator who explains complex topics clearly.',
          testConfig.testPrompts.complex,
        );
        results.push(complexResult);

        // Test creative prompt (only if complex succeeded)
        if (complexResult.success) {
          const creativeResult = await this.testProvider(
            testConfig,
            'You are a creative writer and poet.',
            testConfig.testPrompts.creative,
          );
          results.push(creativeResult);
        }
      }

      this.logger.log(''); // Add spacing between providers
    }

    // Print summary
    this.printTestSummary(results);

    return results;
  }

  /**
   * Test a specific provider with a prompt
   */
  private async testProvider(
    testConfig: ProviderTestConfig,
    systemPrompt: string,
    userMessage: string,
  ): Promise<TestResult> {
    const startTime = Date.now();

    try {
      let response: LLMResponse;

      const systemPreview =
        systemPrompt.length > 60
          ? `${systemPrompt.slice(0, 60)}...`
          : systemPrompt;
      const userPreview =
        userMessage.length > 60
          ? `${userMessage.slice(0, 60)}...`
          : userMessage;
      this.logger.log(
        `  Prompts -> system: "${systemPreview}", user: "${userPreview}"`,
      );

      // Route to appropriate service based on provider
      switch (testConfig.config.provider) {
        case 'openai':
          response = await testOpenAIService();
          break;
        case 'anthropic':
          response = await testAnthropicService();
          break;
        case 'ollama':
          response = await testOllamaService();
          break;
        case 'grok':
          response = await testGrokService();
          break;
        case 'google':
          response = await testGoogleService();
          break;
        default:
          throw new Error(`Unknown provider: ${testConfig.config.provider}`);
      }

      const duration = Date.now() - startTime;

      this.logger.log(`  Success (${duration}ms)`);
      this.logger.log(
        `     Response: ${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}`,
      );
      this.logger.log(
        `     Tokens: ${response.metadata.usage.inputTokens} -> ${response.metadata.usage.outputTokens}`,
      );
      if (response.metadata.usage.cost) {
        this.logger.log(
          `     Cost: $${response.metadata.usage.cost.toFixed(4)}`,
        );
      }

      return {
        provider: testConfig.config.provider,
        model: testConfig.config.model,
        success: true,
        response,
        duration,
        cost: response.metadata.usage.cost,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`  Failed (${duration}ms): ${errorMessage}`);

      return {
        provider: testConfig.config.provider,
        model: testConfig.config.model,
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Print test summary
   */
  private printTestSummary(results: TestResult[]): void {
    this.logger.log('Test Summary');
    this.logger.log('================');

    const byProvider = results.reduce(
      (acc, result) => {
        if (!acc[result.provider]) {
          acc[result.provider] = { total: 0, success: 0, totalCost: 0 };
        }
        const providerStats = acc[result.provider]!; // We just ensured it exists above
        providerStats.total++;
        if (result.success) {
          providerStats.success++;
          providerStats.totalCost += result.cost || 0;
        }
        return acc;
      },
      {} as Record<
        string,
        { total: number; success: number; totalCost: number }
      >,
    );

    for (const [provider, stats] of Object.entries(byProvider)) {
      const successRate = ((stats.success / stats.total) * 100).toFixed(1);
      this.logger.log(
        `${provider.toUpperCase()}: ${stats.success}/${stats.total} (${successRate}%) - Cost: $${stats.totalCost.toFixed(4)}`,
      );
    }

    const totalTests = results.length;
    const totalSuccess = results.filter((r) => r.success).length;
    const totalCost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
    const overallSuccessRate = ((totalSuccess / totalTests) * 100).toFixed(1);

    this.logger.log(
      `Overall: ${totalSuccess}/${totalTests} (${overallSuccessRate}%) - Total Cost: $${totalCost.toFixed(4)}`,
    );
  }

  /**
   * Check health of all providers
   */
  async checkProviderHealth(): Promise<ProviderHealthStatus[]> {
    this.logger.log('Checking provider health...');

    const healthChecks: ProviderHealthStatus[] = [];

    // Check OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const startTime = Date.now();
        await testOpenAIService();
        const latency = Date.now() - startTime;

        healthChecks.push({
          provider: 'openai',
          status: 'healthy',
          latency,
          lastChecked: new Date().toISOString(),
        });
        this.logger.log(`OpenAI: Healthy (${latency}ms)`);
      } catch (error) {
        healthChecks.push({
          provider: 'openai',
          status: 'unhealthy',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(
          `OpenAI: Unhealthy - ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.log('OpenAI: Skipped (no API key)');
    }

    // Check Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const startTime = Date.now();
        await testAnthropicService();
        const latency = Date.now() - startTime;

        healthChecks.push({
          provider: 'anthropic',
          status: 'healthy',
          latency,
          lastChecked: new Date().toISOString(),
        });
        this.logger.log(`Anthropic: Healthy (${latency}ms)`);
      } catch (error) {
        healthChecks.push({
          provider: 'anthropic',
          status: 'unhealthy',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(
          `Anthropic: Unhealthy - ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.log('Anthropic: Skipped (no API key)');
    }

    // Check Ollama
    try {
      const startTime = Date.now();
      await testOllamaService();
      const latency = Date.now() - startTime;

      healthChecks.push({
        provider: 'ollama',
        status: 'healthy',
        latency,
        lastChecked: new Date().toISOString(),
      });
      this.logger.log(`Ollama: Healthy (${latency}ms)`);
    } catch (error) {
      healthChecks.push({
        provider: 'ollama',
        status: 'unhealthy',
        lastChecked: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.logger.error(
        `Ollama: Unhealthy - ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Check Grok
    if (process.env.XAI_API_KEY) {
      try {
        const startTime = Date.now();
        await testGrokService();
        const latency = Date.now() - startTime;

        healthChecks.push({
          provider: 'grok',
          status: 'healthy',
          latency,
          lastChecked: new Date().toISOString(),
        });
        this.logger.log(`Grok: Healthy (${latency}ms)`);
      } catch (error) {
        healthChecks.push({
          provider: 'grok',
          status: 'unhealthy',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(
          `Grok: Unhealthy - ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.log('Grok: Skipped (no API key)');
    }

    // Check Google
    if (process.env.GOOGLE_API_KEY) {
      try {
        const startTime = Date.now();
        await testGoogleService();
        const latency = Date.now() - startTime;

        healthChecks.push({
          provider: 'google',
          status: 'healthy',
          latency,
          lastChecked: new Date().toISOString(),
        });
        this.logger.log(`Google: Healthy (${latency}ms)`);
      } catch (error) {
        healthChecks.push({
          provider: 'google',
          status: 'unhealthy',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(
          `Google: Unhealthy - ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.log('Google: Skipped (no API key)');
    }

    return healthChecks;
  }

  /**
   * Performance benchmark across providers
   */
  async runPerformanceBenchmark(): Promise<void> {
    this.logger.log('Running performance benchmark...');

    const benchmarkPrompt =
      'Write a brief explanation of artificial intelligence.';
    const systemPrompt = 'You are a helpful assistant.';

    const results: Array<{
      provider: string;
      model: string;
      duration: number;
      tokensPerSecond: number;
      cost: number;
    }> = [];

    this.logger.log(
      `System prompt: "${systemPrompt}" | Benchmark prompt: "${benchmarkPrompt}"`,
    );

    for (const testConfig of this.testConfigs.filter((c) => c.enabled)) {
      try {
        const startTime = Date.now();

        let response: LLMResponse;

        switch (testConfig.config.provider) {
          case 'openai':
            response = await testOpenAIService();
            break;
          case 'anthropic':
            response = await testAnthropicService();
            break;
          case 'ollama':
            response = await testOllamaService();
            break;
          case 'grok':
            response = await testGrokService();
            break;
          case 'google':
            response = await testGoogleService();
            break;
          default:
            continue;
        }

        const duration = Date.now() - startTime;
        const tokensPerSecond =
          (response.metadata.usage.outputTokens / duration) * 1000;

        results.push({
          provider: testConfig.config.provider,
          model: testConfig.config.model,
          duration,
          tokensPerSecond,
          cost: response.metadata.usage.cost || 0,
        });

        this.logger.log(
          `${testConfig.name}: ${duration}ms, ${tokensPerSecond.toFixed(2)} tokens/sec, $${(response.metadata.usage.cost || 0).toFixed(4)}`,
        );
      } catch (_error) {
        this.logger.error(
          `${testConfig.name}: Failed - ${_error instanceof Error ? _error.message : 'Unknown error'}`,
        );
      }
    }

    // Sort by performance
    results.sort((a, b) => b.tokensPerSecond - a.tokensPerSecond);

    this.logger.log('Performance Ranking:');
    results.forEach((result, index) => {
      this.logger.log(
        `${index + 1}. ${result.provider}/${result.model}: ${result.tokensPerSecond.toFixed(2)} tokens/sec`,
      );
    });
  }
}

/**
 * Main test runner function
 */
export async function runProviderTests(): Promise<void> {
  const testSuite = new ProviderTestSuite();

  suiteLogger.log('LLM Provider Test Suite');
  suiteLogger.log('===========================');

  // Check health first
  await testSuite.checkProviderHealth();

  // Run comprehensive tests
  await testSuite.runAllTests();

  // Run performance benchmark
  await testSuite.runPerformanceBenchmark();

  suiteLogger.log('Test suite completed!');
}

// ProviderTestSuite is already exported above
