import { Test, TestingModule } from '@nestjs/testing';
import { LegacyHitlRelayService } from '../legacy-hitl-relay.service';
import type {
  HumanInTheLoopResponse,
  HookEvent,
} from '../../observability-types';

// Mock the ws module
jest.mock('ws', () => ({
  WebSocket: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
  })),
}));

describe('LegacyHitlRelayService', () => {
  let service: LegacyHitlRelayService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LegacyHitlRelayService],
    }).compile();

    service = module.get<LegacyHitlRelayService>(LegacyHitlRelayService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendResponseToAgent', () => {
    it('should be a function', () => {
      expect(typeof service.sendResponseToAgent).toBe('function');
    });

    it('should reject on timeout when WebSocket never opens', async () => {
      // The mock WebSocket never fires 'open', so it should timeout
      const mockHookEvent: HookEvent = {
        source_app: 'test-app',
        session_id: 'session-123',
        hook_event_type: 'hitl',
        payload: {},
      };

      const response: HumanInTheLoopResponse = {
        response: 'Test response',
        hookEvent: mockHookEvent,
        respondedAt: Date.now(),
      };

      await expect(
        service.sendResponseToAgent('ws://test-ws-host:9999', response),
      ).rejects.toThrow('Timeout sending response to agent');
    }, 10000);
  });
});
