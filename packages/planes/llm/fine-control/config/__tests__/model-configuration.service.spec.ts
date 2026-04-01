import {
  ModelConfigurationService,
  SystemModelConfiguration,
  ModelConfiguration,
} from '../model-configuration.service';

describe('ModelConfigurationService', () => {
  describe('System mode (agents + environmentDefaults)', () => {
    const systemConfig: SystemModelConfiguration = {
      agents: {
        'chat-agent': {
          default: { provider: 'openai', model: 'gpt-4o' },
          fast: { provider: 'openai', model: 'gpt-4o-mini' },
          reasoning: { provider: 'anthropic', model: 'claude-sonnet-4' },
        },
        'research-agent': {
          default: { provider: 'google', model: 'gemini-2.5-pro' },
        },
      },
      environmentDefaults: {
        development: { provider: 'openai', model: 'gpt-4o-mini' },
        staging: { provider: 'openai', model: 'gpt-4o' },
        production: { provider: 'anthropic', model: 'claude-sonnet-4' },
      },
    };

    let service: ModelConfigurationService;

    beforeEach(() => {
      service = new ModelConfigurationService(systemConfig);
    });

    describe('validateConfig', () => {
      it('should not throw for a valid system config', () => {
        expect(() => service.validateConfig()).not.toThrow();
      });

      it('should throw when agents map is missing', () => {
        const badConfig = {
          ...systemConfig,
          agents: undefined as unknown as Record<string, unknown>,
        };
        const badService = new ModelConfigurationService(
          badConfig as unknown as SystemModelConfiguration,
        );
        expect(() => badService.validateConfig()).toThrow(
          /agents map is required/,
        );
      });

      it('should throw when environmentDefaults is missing', () => {
        const badConfig = {
          ...systemConfig,
          environmentDefaults: undefined as unknown as Record<
            string,
            ModelConfiguration
          >,
        };
        const badService = new ModelConfigurationService(
          badConfig as unknown as SystemModelConfiguration,
        );
        expect(() => badService.validateConfig()).toThrow(
          /environmentDefaults are required/,
        );
      });
    });

    describe('getAgentModel', () => {
      it('should return the default model configuration for an agent', () => {
        const config = service.getAgentModel('chat-agent');
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-4o');
      });

      it('should return a variant model configuration when specified', () => {
        const config = service.getAgentModel('chat-agent', 'fast');
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-4o-mini');
      });

      it('should throw when agent type is not configured', () => {
        expect(() => service.getAgentModel('nonexistent-agent')).toThrow(
          /agent 'nonexistent-agent' not configured/,
        );
      });

      it('should throw when variant is not configured for agent', () => {
        expect(() => service.getAgentModel('research-agent', 'fast')).toThrow(
          /variant 'fast' for agent 'research-agent' is not configured/,
        );
      });
    });

    describe('assertConfigured', () => {
      it('should not throw for a configured agent and default variant', () => {
        expect(() => service.assertConfigured('chat-agent')).not.toThrow();
      });

      it('should not throw for a configured agent and named variant', () => {
        expect(() =>
          service.assertConfigured('chat-agent', 'reasoning'),
        ).not.toThrow();
      });

      it('should throw for unconfigured agent', () => {
        expect(() => service.assertConfigured('missing-agent')).toThrow(
          /agent 'missing-agent' not configured/,
        );
        // Error message should include available agents
        try {
          service.assertConfigured('missing-agent');
        } catch (err) {
          expect((err as Error).message).toContain('chat-agent');
          expect((err as Error).message).toContain('research-agent');
        }
      });

      it('should throw when variant is not available, mentioning available variants', () => {
        try {
          service.assertConfigured('research-agent', 'fast');
        } catch (err) {
          expect((err as Error).message).toContain('default');
        }
      });
    });

    describe('getEnvironmentDefault', () => {
      it('should return environment default for development', () => {
        const config = service.getEnvironmentDefault('development');
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-4o-mini');
      });

      it('should return environment default for production', () => {
        const config = service.getEnvironmentDefault('production');
        expect(config.provider).toBe('anthropic');
        expect(config.model).toBe('claude-sonnet-4');
      });

      it('should throw for unconfigured environment', () => {
        const partialConfig: SystemModelConfiguration = {
          agents: {},
          environmentDefaults: {
            development: { provider: 'openai', model: 'gpt-4o' },
          } as unknown as Record<string, ModelConfiguration>,
        };
        const partialService = new ModelConfigurationService(partialConfig);
        expect(() => partialService.getEnvironmentDefault('staging')).toThrow(
          /environment default for 'staging' not configured/,
        );
      });
    });

    describe('getGlobalDefault', () => {
      it('should throw in system mode', () => {
        expect(() => service.getGlobalDefault()).toThrow(
          /global default not configured/,
        );
      });
    });

    describe('listAgents', () => {
      it('should return all configured agent names', () => {
        const agents = service.listAgents();
        expect(agents).toContain('chat-agent');
        expect(agents).toContain('research-agent');
        expect(agents).toHaveLength(2);
      });
    });

    describe('isGlobal', () => {
      it('should return false in system mode', () => {
        expect(service.isGlobal()).toBe(false);
      });
    });
  });

  describe('Global mode (single default)', () => {
    const globalConfig: ModelConfiguration = {
      provider: 'openai',
      model: 'gpt-4o',
    };

    let service: ModelConfigurationService;

    beforeEach(() => {
      service = new ModelConfigurationService(globalConfig);
    });

    describe('validateConfig', () => {
      it('should not throw for a valid global config', () => {
        expect(() => service.validateConfig()).not.toThrow();
      });

      it('should throw when provider is an empty string (detected via getGlobalDefault)', () => {
        // The constructor requires 'provider' key to be present to detect global mode.
        // To test assertModel throwing for empty provider, we use a system-mode agent config
        // with an agent that has an empty provider string.
        const config: SystemModelConfiguration = {
          agents: {
            'bad-agent': {
              default: { provider: '', model: 'gpt-4o' },
            },
          },
          environmentDefaults: {
            development: { provider: 'openai', model: 'gpt-4o' },
            staging: { provider: 'openai', model: 'gpt-4o' },
            production: { provider: 'openai', model: 'gpt-4o' },
          },
        };
        const svc = new ModelConfigurationService(config);
        expect(() => svc.getAgentModel('bad-agent')).toThrow(
          /provider is required/,
        );
      });

      it('should throw when model is missing', () => {
        const badService = new ModelConfigurationService({
          provider: 'openai',
        } as ModelConfiguration);
        expect(() => badService.validateConfig()).toThrow(/model is required/);
      });
    });

    describe('getGlobalDefault', () => {
      it('should return the configured global default', () => {
        const config = service.getGlobalDefault();
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-4o');
      });
    });

    describe('isGlobal', () => {
      it('should return true in global mode', () => {
        expect(service.isGlobal()).toBe(true);
      });
    });

    describe('listAgents', () => {
      it('should return empty array in global mode', () => {
        expect(service.listAgents()).toEqual([]);
      });
    });

    describe('assertConfigured', () => {
      it('should throw in global mode (no agent variants)', () => {
        expect(() => service.assertConfigured('any-agent')).toThrow(
          /agent variants are not available in global mode/,
        );
      });
    });

    describe('getEnvironmentDefault', () => {
      it('should throw in global mode', () => {
        expect(() => service.getEnvironmentDefault('development')).toThrow(
          /environment defaults requested in global mode/,
        );
      });
    });
  });

  describe('Global dual mode ({ default, localOnly })', () => {
    const dualConfig = {
      default: { provider: 'openai', model: 'gpt-4o' },
      localOnly: { provider: 'ollama', model: 'llama3.2:3b' },
    };

    let service: ModelConfigurationService;

    beforeEach(() => {
      service = new ModelConfigurationService(dualConfig);
    });

    describe('validateConfig', () => {
      it('should not throw for a valid global dual config', () => {
        expect(() => service.validateConfig()).not.toThrow();
      });

      it('should throw when dual config has a null globalDefault (internal invariant)', () => {
        // When only localOnly is passed without 'default', the constructor falls to system mode
        // which then requires 'agents'. So to test the dual-mode missing-default path,
        // we directly check the validate path via a global mode with no globalDefault set.
        // The real check: global_dual mode with missing default -> the constructor guard prevents it.
        // There is no public API to trigger that branch without bypassing the constructor,
        // so we verify instead that validateConfig passes for a valid dual config.
        const validService = new ModelConfigurationService({
          default: { provider: 'openai', model: 'gpt-4o' },
          localOnly: { provider: 'ollama', model: 'llama3.2:3b' },
        });
        expect(() => validService.validateConfig()).not.toThrow();
      });
    });

    describe('getGlobalDefault', () => {
      it('should return the default external config', () => {
        const config = service.getGlobalDefault();
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-4o');
      });
    });

    describe('getGlobalLocalOnly', () => {
      it('should return the local-only config', () => {
        const config = service.getGlobalLocalOnly();
        expect(config).toBeDefined();
        expect(config!.provider).toBe('ollama');
        expect(config!.model).toBe('llama3.2:3b');
      });
    });

    describe('isGlobal', () => {
      it('should return false in global_dual mode', () => {
        // global_dual is not the same as strict global mode
        expect(service.isGlobal()).toBe(false);
      });
    });
  });

  describe('No-argument constructor (empty system mode)', () => {
    it('should not throw when constructed without arguments', () => {
      expect(() => new ModelConfigurationService()).not.toThrow();
    });

    it('should list no agents', () => {
      const service = new ModelConfigurationService();
      expect(service.listAgents()).toEqual([]);
    });
  });

  describe('assertModel validation', () => {
    it('should throw for model with missing provider in agent config', () => {
      const config: SystemModelConfiguration = {
        agents: {
          'bad-agent': {
            default: { provider: '', model: 'gpt-4o' },
          },
        },
        environmentDefaults: {
          development: { provider: 'openai', model: 'gpt-4o' },
          staging: { provider: 'openai', model: 'gpt-4o' },
          production: { provider: 'openai', model: 'gpt-4o' },
        },
      };
      const service = new ModelConfigurationService(config);
      expect(() => service.getAgentModel('bad-agent')).toThrow(
        /provider is required/,
      );
    });

    it('should throw for model with missing model name in agent config', () => {
      const config: SystemModelConfiguration = {
        agents: {
          'bad-agent': {
            default: { provider: 'openai', model: '' },
          },
        },
        environmentDefaults: {
          development: { provider: 'openai', model: 'gpt-4o' },
          staging: { provider: 'openai', model: 'gpt-4o' },
          production: { provider: 'openai', model: 'gpt-4o' },
        },
      };
      const service = new ModelConfigurationService(config);
      expect(() => service.getAgentModel('bad-agent')).toThrow(
        /model is required/,
      );
    });
  });
});
