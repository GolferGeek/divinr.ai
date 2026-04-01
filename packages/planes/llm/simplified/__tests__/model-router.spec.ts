import { ModelRouter } from '../model-router';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    delete process.env.SIMPLIFIED_LLM_ROUTING;
    router = new ModelRouter();
  });

  describe('commercial models -> openrouter', () => {
    it.each([
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-5',
      'claude-sonnet-4',
      'claude-opus-4.5',
      'gemini-2.5-pro',
      'grok-4',
      'o1',
      'o3',
    ])('routes %s to openrouter', (model) => {
      const result = router.route(model);
      expect(result.target).toBe('openrouter');
      expect(result.model).toBe(model);
    });
  });

  describe('open-source models -> ollama_cloud', () => {
    it.each([
      'llama-3.3-70b',
      'llama3.1:8b',
      'mistral-7b',
      'mixtral-8x7b',
      'qwen2.5:7b',
      'phi-3',
      'deepseek-coder',
      'codellama-34b',
    ])('routes %s to ollama_cloud', (model) => {
      const result = router.route(model);
      expect(result.target).toBe('ollama_cloud');
      expect(result.model).toBe(model);
    });
  });

  describe('sovereign mode', () => {
    it('forces all models to ollama_cloud', () => {
      const result = router.route('gpt-4o', true);
      expect(result.target).toBe('ollama_cloud');
      expect(result.reason).toBe('sovereign_mode');
    });
  });

  describe('overrides', () => {
    it('respects SIMPLIFIED_LLM_ROUTING overrides', () => {
      process.env.SIMPLIFIED_LLM_ROUTING = JSON.stringify({
        'gpt-4o': 'ollama_cloud',
      });
      const routerWithOverrides = new ModelRouter();
      const result = routerWithOverrides.route('gpt-4o');
      expect(result.target).toBe('ollama_cloud');
      expect(result.reason).toBe('explicit_override');
    });

    it('handles invalid JSON in overrides', () => {
      process.env.SIMPLIFIED_LLM_ROUTING = 'not-json';
      // Should not throw
      const routerWithBadOverrides = new ModelRouter();
      const result = routerWithBadOverrides.route('gpt-4o');
      expect(result.target).toBe('openrouter');
    });
  });

  describe('unknown models', () => {
    it('defaults to openrouter for unknown models', () => {
      const result = router.route('some-unknown-model');
      expect(result.target).toBe('openrouter');
      expect(result.reason).toBe('default');
    });
  });
});
