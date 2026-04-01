/**
 * Simple Ollama Test - Golf Blog Post
 *
 * This is our baseline test that we'll perfect and then replicate for all providers.
 * Tests a real-world scenario: generating a blog post about playing golf in the rain.
 */

import { Logger } from '@nestjs/common';
import { OllamaLLMService } from './ollama-llm.service';
import { createMockExecutionContext } from '@orchestrator-ai/transport-types';

const logger = new Logger('TestOllamaGolf');
import {
  LLMServiceConfig,
  GenerateResponseParams,
  LLMResponse,
} from './llm-interfaces';

import { PIIService } from '../pii/pii.service';
import { DictionaryPseudonymizerService } from '../pii/dictionary-pseudonymizer.service';
import { RunMetadataService } from '../run-metadata.service';
import { ProviderConfigService } from '../provider-config.service';
import { HttpService } from '@nestjs/axios';

// Mock dependencies for testing (we'll keep this simple for now)
const mockDependencies = {
  piiService: {
    detectAndProcessPII: () =>
      Promise.resolve({
        processedText: 'test',
        piiMetadata: undefined,
      }),
  } as unknown as PIIService,
  dictionaryPseudonymizerService:
    {} as unknown as DictionaryPseudonymizerService,
  runMetadataService: {} as unknown as RunMetadataService,
  providerConfigService: {} as unknown as ProviderConfigService,
  httpService: {
    post: () => ({
      // Mock Ollama response
      toPromise: () =>
        Promise.resolve({
          data: {
            response:
              '# Playing Golf in the Rain: A Wet Adventure\n\nPlaying golf in the rain can be both challenging and rewarding. Here are some tips for making the most of your rainy day round:\n\n## Essential Gear\n- Waterproof rain gear\n- Golf umbrella\n- Extra towels\n- Waterproof gloves\n\n## Playing Tips\n1. Adjust your stance for wet conditions\n2. Take shorter swings for better control\n3. Focus on course management\n4. Stay positive and enjoy the unique experience\n\nRemember, some of the most memorable rounds happen in less-than-perfect weather!',
            model: 'llama3.2:3b',
            created_at: new Date().toISOString(),
            done: true,
            total_duration: 5000000000, // 5 seconds in nanoseconds
            load_duration: 1000000000, // 1 second
            prompt_eval_count: 25,
            prompt_eval_duration: 500000000,
            eval_count: 150,
            eval_duration: 3500000000,
          },
        }),
    }),
    get: () => ({
      toPromise: () =>
        Promise.resolve({
          data: {
            models: [{ name: 'llama3.2:3b' }, { name: 'llama3.2:1b' }],
          },
        }),
    }),
  } as unknown as HttpService,
};

/**
 * Test configuration for Ollama
 */
const testConfig: LLMServiceConfig = {
  provider: 'ollama',
  model: 'llama3.2:3b', // Popular, reasonably sized model
  temperature: 0.7,
  maxTokens: 1000,
  baseUrl: 'http://localhost:11434',
};

/**
 * The test prompt we'll use across all providers
 */
const testPrompt = {
  systemPrompt:
    'You are a helpful assistant who writes engaging blog posts. Write in a friendly, informative tone.',
  userMessage: 'Write me a blog post about playing golf in the rain',
};

/**
 * Main test function
 */
export async function testOllamaGolfBlogPost(): Promise<{
  success: boolean;
  response?: LLMResponse;
  error?: string;
  metrics: {
    duration: number;
    tokensPerSecond?: number;
    cost: number;
    wordCount?: number;
  };
}> {
  logger.log('Testing Ollama with Golf Blog Post Prompt');
  logger.log('==============================================');
  logger.log(`Model: ${testConfig.model}`);
  logger.log(`Prompt: "${testPrompt.userMessage}"`);

  const startTime = Date.now();

  try {
    // Create Ollama service
    const ollamaService = new OllamaLLMService(
      testConfig,
      mockDependencies.piiService,
      mockDependencies.dictionaryPseudonymizerService,
      mockDependencies.runMetadataService,
      mockDependencies.providerConfigService,
      mockDependencies.httpService,
    );

    // Check Ollama health first
    logger.log('Checking Ollama health...');
    const health = await ollamaService.checkHealth();

    if (!health.healthy) {
      throw new Error(
        'Ollama server is not healthy. Make sure Ollama is running on localhost:11434',
      );
    }

    logger.log(`Ollama is healthy (version: ${health.version})`);
    logger.log(`Available models: ${health.models?.join(', ') || 'none'}`);

    // Create ExecutionContext for the test
    const mockContext = createMockExecutionContext({
      conversationId: `golf-test-${Date.now()}`,
    });

    // Prepare request parameters
    const params: GenerateResponseParams = {
      systemPrompt: testPrompt.systemPrompt,
      userMessage: testPrompt.userMessage,
      config: testConfig,
      options: {
        preferLocal: true, // This will set tier to 'local'
        executionContext: mockContext,
      },
    };

    // Generate response
    logger.log('Generating blog post...');
    const response = await ollamaService.generateResponse(mockContext, params);

    const duration = Date.now() - startTime;

    // Calculate metrics
    const wordCount = response.content.split(/\s+/).length;
    const tokensPerSecond =
      response.metadata.usage.outputTokens > 0
        ? (response.metadata.usage.outputTokens / duration) * 1000
        : undefined;

    // Print results
    logger.log('Success!');
    logger.log('Metrics:');
    logger.log(`   Duration: ${duration}ms`);
    logger.log(`   Input tokens: ${response.metadata.usage.inputTokens}`);
    logger.log(`   Output tokens: ${response.metadata.usage.outputTokens}`);
    logger.log(`   Total tokens: ${response.metadata.usage.totalTokens}`);
    logger.log(`   Tokens/sec: ${tokensPerSecond?.toFixed(2) || 'N/A'}`);
    logger.log(`   Word count: ${wordCount}`);
    logger.log(
      `   Cost: $${response.metadata.usage.cost?.toFixed(4) || '0.0000'} (local model)`,
    );

    // Print performance details from Ollama
    if (response.metadata.providerSpecific) {
      const perf = response.metadata.providerSpecific;
      logger.log('Ollama Performance Details:');
      const totalDuration = Number(perf.total_duration);
      if (Number.isFinite(totalDuration)) {
        logger.log(
          `   Total duration: ${(totalDuration / 1_000_000).toFixed(0)}ms`,
        );
      }
      const loadDuration = Number(perf.load_duration);
      if (Number.isFinite(loadDuration)) {
        logger.log(
          `   Model load time: ${(loadDuration / 1_000_000).toFixed(0)}ms`,
        );
      }
      const promptEvalDuration = Number(perf.prompt_eval_duration);
      if (Number.isFinite(promptEvalDuration)) {
        logger.log(
          `   Prompt eval time: ${(promptEvalDuration / 1_000_000).toFixed(0)}ms`,
        );
      }
      const evalDuration = Number(perf.eval_duration);
      if (Number.isFinite(evalDuration)) {
        logger.log(
          `   Generation time: ${(evalDuration / 1_000_000).toFixed(0)}ms`,
        );
      }
      const modelStatus =
        typeof perf.model_status === 'string'
          ? perf.model_status
          : perf.model_status && typeof perf.model_status === 'object'
            ? JSON.stringify(perf.model_status)
            : 'unknown';
      logger.log(`   Model status: ${modelStatus}`);
    }

    logger.log('Generated Blog Post:');
    logger.log('========================');
    logger.log(response.content);
    logger.log('========================');

    return {
      success: true,
      response,
      metrics: {
        duration,
        tokensPerSecond,
        cost: response.metadata.usage.cost || 0,
        wordCount,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error(`Test failed (${duration}ms): ${errorMessage}`);

    // Provide helpful troubleshooting info
    if (errorMessage.includes('ECONNREFUSED')) {
      logger.log('Troubleshooting:');
      logger.log('   - Make sure Ollama is installed and running');
      logger.log('   - Try: ollama serve');
      logger.log('   - Check if the model is available: ollama list');
      logger.log('   - Pull the model if needed: ollama pull llama3.2:3b');
    }

    return {
      success: false,
      error: errorMessage,
      metrics: {
        duration,
        cost: 0,
      },
    };
  }
}

/**
 * Run the test if this file is executed directly
 */
if (require.main === module) {
  testOllamaGolfBlogPost()
    .then((result) => {
      if (result.success) {
        logger.log('Test completed successfully!');
        process.exit(0);
      } else {
        logger.error('Test failed!');
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error(`Unexpected error: ${String(error)}`);
      process.exit(1);
    });
}
