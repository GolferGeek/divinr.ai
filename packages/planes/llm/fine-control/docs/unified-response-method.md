# Unified LLM Response Method Documentation

## Overview

The `generateUnifiedResponse` method is the new entry point for all LLM requests in the Orchestrator AI system. It consolidates the three existing response methods into a single unified interface that requires explicit provider and model specification and uses the new LLMServiceFactory architecture.

## Method Signature

```typescript
async generateUnifiedResponse(params: UnifiedGenerateResponseParams): Promise<string | LLMResponse>
```

## Parameters

### UnifiedGenerateResponseParams

```typescript
interface UnifiedGenerateResponseParams {
  provider: string; // Required: LLM provider (openai, anthropic, google, grok, ollama)
  model: string; // Required: Specific model name
  systemPrompt: string; // Required: System prompt for the LLM
  userMessage: string; // Required: User message/input
  options?: {
    temperature?: number; // Optional: Model temperature (0.0-2.0)
    maxTokens?: number; // Optional: Maximum tokens to generate
    callerType?: string; // Optional: Type of caller ('agent', 'api', 'user', 'system')
    callerName?: string; // Optional: Name of the caller for tracking
    conversationId?: string; // Optional: Conversation context ID
    sessionId?: string; // Optional: Session ID for tracking
    userId?: string; // Optional: User ID for usage tracking
    authToken?: string; // Optional: Authentication token
    currentUser?: any; // Optional: User object with id, email, etc.
    dataClassification?: string; // Optional: Data classification level
    includeMetadata?: boolean; // Optional: Return full response object vs string
  };
}
```

## Return Values

The method returns different types based on the `includeMetadata` option:

### String Response (default)

When `includeMetadata` is `false` or not specified:

```typescript
Promise<string>;
```

Returns only the generated content as a string.

### Full Response Object

When `includeMetadata` is `true`:

```typescript
Promise<LLMResponse>;
```

Returns a complete response object with metadata:

```typescript
interface LLMResponse {
  content: string;
  metadata: {
    provider: string;
    model: string;
    requestId: string;
    timestamp: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cost?: number;
    };
    timing: {
      startTime: number;
      endTime: number;
      duration: number;
    };
    status: 'completed' | 'error' | 'timeout';
    langsmithRunId?: string;
  };
}
```

## Supported Providers

| Provider    | Description             | Models                                          |
| ----------- | ----------------------- | ----------------------------------------------- |
| `openai`    | OpenAI GPT models       | gpt-4, gpt-3.5-turbo, gpt-4-turbo, etc.         |
| `anthropic` | Anthropic Claude models | claude-3-5-sonnet-20241022, claude-3-opus, etc. |
| `google`    | Google Gemini models    | gemini-pro, gemini-1.5-pro, etc.                |
| `grok`      | xAI Grok models         | grok-1, grok-beta, etc.                         |
| `ollama`    | Local Ollama models     | llama3.2:1b, mistral:7b, etc.                   |

## Usage Examples

### Basic Usage (String Response)

```typescript
const response = await llmService.generateUnifiedResponse({
  provider: 'ollama',
  model: 'llama3.2:1b',
  systemPrompt: 'You are a helpful assistant.',
  userMessage: 'What is the capital of France?',
});

console.log(response); // "The capital of France is Paris."
```

### Advanced Usage with Options

```typescript
const response = await llmService.generateUnifiedResponse({
  provider: 'openai',
  model: 'gpt-4',
  systemPrompt: 'You are a technical documentation writer.',
  userMessage: 'Explain how REST APIs work.',
  options: {
    temperature: 0.7,
    maxTokens: 500,
    callerType: 'agent',
    callerName: 'documentation-agent',
    conversationId: 'conv-123',
    userId: 'user-456',
    dataClassification: 'public',
    includeMetadata: true,
  },
});

console.log(response.content);
console.log(response.metadata.usage.totalTokens);
console.log(response.metadata.timing.duration);
```

### Agent Integration

```typescript
// In an agent service
async generateAgentResponse(userInput: string, agentConfig: AgentConfig) {
  return await this.llmService.generateUnifiedResponse({
    provider: agentConfig.preferredProvider,
    model: agentConfig.preferredModel,
    systemPrompt: agentConfig.systemPrompt,
    userMessage: userInput,
    options: {
      temperature: agentConfig.temperature,
      maxTokens: agentConfig.maxTokens,
      callerType: 'agent',
      callerName: agentConfig.name,
      conversationId: this.conversationId,
      userId: this.userId,
      includeMetadata: false // Agents typically just need the content
    }
  });
}
```

## Error Handling

The method performs comprehensive validation and throws descriptive errors:

### Parameter Validation Errors

```typescript
// Missing required parameters
throw new Error('Missing required parameter: provider is required');
throw new Error('Missing required parameter: model is required');
throw new Error('Missing required parameter: systemPrompt is required');
throw new Error('Missing required parameter: userMessage is required');

// Invalid provider
throw new Error(
  'Unsupported provider: invalid-provider. Supported providers: openai, anthropic, google, grok, ollama',
);
```

### LLM Service Errors

```typescript
// Wrapped with context
throw new Error('Unified LLM service error: [original error message]');
```

### Example Error Handling

```typescript
try {
  const response = await llmService.generateUnifiedResponse({
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: 'You are helpful.',
    userMessage: 'Hello!',
  });

  return response;
} catch (error) {
  if (error.message.includes('Missing required parameter')) {
    // Handle validation errors
    logger.error('Invalid parameters provided:', error.message);
    throw new BadRequestException(error.message);
  } else if (error.message.includes('Unsupported provider')) {
    // Handle provider errors
    logger.error('Invalid provider specified:', error.message);
    throw new BadRequestException(error.message);
  } else {
    // Handle LLM service errors
    logger.error('LLM service error:', error.message);
    throw new InternalServerErrorException('Failed to generate response');
  }
}
```

## Architecture Integration

### LLMServiceFactory Integration

The unified method delegates to the LLMServiceFactory:

```typescript
// Create service configuration
const config: LLMServiceConfig = {
  provider: params.provider,
  model: params.model,
  temperature: params.options?.temperature,
  maxTokens: params.options?.maxTokens,
};

// Use factory to generate response
const response = await this.llmServiceFactory.generateResponse(
  config,
  factoryParams,
);
```

### Backward Compatibility

The method maintains backward compatibility by:

1. **Deprecation Warnings**: Old methods issue deprecation warnings
2. **Internal Delegation**: Deprecated methods internally call the unified method
3. **Parameter Mapping**: Old parameter formats are mapped to new structure

```typescript
/**
 * @deprecated This method is deprecated. Please use generateUnifiedResponse instead.
 */
async generateResponse(systemPrompt: string, userMessage: string, options?: any): Promise<string> {
  // Issue deprecation warning
  this.logger.warn('generateResponse is deprecated. Use generateUnifiedResponse instead.');

  // Require explicit provider/model
  if (!options?.providerName || !options?.modelName) {
    throw new Error('Both provider and model must be explicitly specified...');
  }

  // Delegate to unified method
  return await this.generateUnifiedResponse({
    provider: options.providerName,
    model: options.modelName,
    systemPrompt,
    userMessage,
    options
  });
}
```

## Performance Considerations

### Response Time Optimization

- **Local Models**: Ollama models run locally with no network latency
- **External Providers**: Use connection pooling and request optimization
- **Caching**: Provider service instances are cached in the factory

### Token Usage Tracking

- **Input Tokens**: Estimated from system prompt + user message
- **Output Tokens**: Tracked from provider response
- **Cost Calculation**: Based on provider-specific pricing

### Memory Management

- **Service Instances**: Reused via factory caching
- **Large Responses**: Streamed when possible
- **Cleanup**: Automatic cleanup of temporary resources

## Security Features

### PII Protection

- **Dictionary-based Pseudonymization**: Applied for external providers
- **Local Processing**: Ollama models process data locally
- **Reversal**: Pseudonyms are reversed in responses

### Source Blinding

- **Header Stripping**: Remove identifying headers for external providers
- **Custom User Agent**: Use generic user agent strings
- **No-Train Headers**: Send training opt-out headers

### Data Classification

- **Classification Levels**: public, internal, confidential, restricted
- **Policy Enforcement**: Different handling based on classification
- **Audit Logging**: All requests are logged with classification

## Monitoring and Observability

### LangSmith Integration

- **Automatic Tracing**: All requests are traced when LangSmith is enabled
- **Run IDs**: Returned in metadata for correlation
- **Performance Metrics**: Detailed timing and usage data

### Usage Analytics

- **Caller Tracking**: Track usage by caller type and name
- **Cost Monitoring**: Track costs per user, session, and caller
- **Performance Metrics**: Response times, token usage, error rates

### Logging

```typescript
// Debug logging for troubleshooting
this.logger.debug(`🔍 [UNIFIED-LLM] generateUnifiedResponse called`, {
  provider: params.provider,
  model: params.model,
  callerType: params.options?.callerType,
  callerName: params.options?.callerName,
  includeMetadata: params.options?.includeMetadata,
});

// Error logging with context
this.logger.error(`🚨 [UNIFIED-LLM] Error in generateUnifiedResponse`, {
  provider: params.provider,
  model: params.model,
  error: error instanceof Error ? error.message : String(error),
});
```

## Migration Guide

### From generateResponse

```typescript
// OLD
const response = await llmService.generateResponse(
  'You are helpful.',
  'Hello!',
  { provider: 'openai', modelName: 'gpt-4' },
);

// NEW
const response = await llmService.generateUnifiedResponse({
  provider: 'openai',
  model: 'gpt-4',
  systemPrompt: 'You are helpful.',
  userMessage: 'Hello!',
});
```

### From generateCentralizedResponse

```typescript
// OLD
const response = await llmService.generateCentralizedResponse(
  'You are helpful.',
  'Hello!',
  { providerName: 'openai', modelName: 'gpt-4' },
  'auth-token',
  'session-123',
);

// NEW
const response = await llmService.generateUnifiedResponse({
  provider: 'openai',
  model: 'gpt-4',
  systemPrompt: 'You are helpful.',
  userMessage: 'Hello!',
  options: {
    authToken: 'auth-token',
    sessionId: 'session-123',
  },
});
```

## Best Practices

### Provider Selection

1. **Use Ollama for development**: Fast, free, and private
2. **Use OpenAI for production**: Reliable and high-quality
3. **Use Anthropic for reasoning**: Excellent for complex tasks
4. **Use Google for multimodal**: Good for text + image tasks

### Model Selection

1. **Small models for simple tasks**: Use efficient models like gpt-3.5-turbo
2. **Large models for complex tasks**: Use gpt-4 or claude-3-opus
3. **Local models for sensitive data**: Use Ollama for PII-heavy content
4. **Specialized models**: Use task-specific models when available

### Error Handling

1. **Always wrap in try-catch**: Handle both validation and service errors
2. **Provide meaningful error messages**: Help users understand what went wrong
3. **Log errors with context**: Include provider, model, and caller information
4. **Implement retry logic**: For transient errors like rate limits

### Performance Optimization

1. **Set appropriate maxTokens**: Avoid generating unnecessarily long responses
2. **Use appropriate temperature**: Lower for factual tasks, higher for creative tasks
3. **Include caller information**: Helps with usage analytics and debugging
4. **Use includeMetadata judiciously**: Only when you need the extra information

## Testing

### Unit Tests

```typescript
describe('generateUnifiedResponse', () => {
  it('should validate required parameters', async () => {
    await expect(
      service.generateUnifiedResponse({
        provider: '',
        model: 'test-model',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }),
    ).rejects.toThrow('Missing required parameter: provider is required');
  });
});
```

### Integration Tests

```typescript
describe('LLM Integration', () => {
  it('should work with Ollama when available', async () => {
    const response = await llmService.generateUnifiedResponse({
      provider: 'ollama',
      model: 'llama3.2:1b',
      systemPrompt: 'You are helpful.',
      userMessage: 'Say "test"',
      options: { maxTokens: 5 },
    });

    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });
});
```

### E2E Tests

```typescript
describe('API Integration', () => {
  it('should work through HTTP API', async () => {
    const response = await request(app.getHttpServer())
      .post('/llm/generate')
      .send({
        provider: 'ollama',
        model: 'llama3.2:1b',
        systemPrompt: 'You are helpful.',
        userMessage: 'Hello!',
        includeMetadata: true,
      })
      .expect(200);

    expect(response.body.content).toBeDefined();
    expect(response.body.metadata).toBeDefined();
  });
});
```
