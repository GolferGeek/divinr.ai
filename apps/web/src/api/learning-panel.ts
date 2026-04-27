import { useApi } from '../composables/useApi';
import type { MasteryLevel } from '../mastery/mastery-config';

export interface LearningPanelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  citations: Array<{ source: string; title: string; content: string }>;
  llmUsageId: string | null;
  feedback: {
    messageId: string;
    feedback: 'helpful' | 'unhelpful';
    note: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface LearningPanelThread {
  id: string;
  title: string;
  originSurfaceKey: string | null;
  createdAt: string;
  updatedAt: string;
  messages: LearningPanelMessage[];
}

export interface LearningPanelUsageStatus {
  totalCalls: number;
  totalCostCents: number;
  callLimit: number;
  costLimitCents: number;
  warningThresholdRatio: number;
  warning: boolean;
  blocked: boolean;
}

export interface LearningPanelMasterySummary {
  currentLevel: MasteryLevel;
  effectiveLevel: MasteryLevel;
  nextLevel: MasteryLevel | null;
  visibleSurfaces: string[];
  nextSuggestedSteps: string[];
}

export function useLearningPanelApi() {
  const api = useApi('/api');

  return {
    getBootstrap: (surfaceKey?: string) =>
      api.get<{
        enabled: boolean;
        modelProvider: string;
        modelName: string;
        webResearchEnabled: boolean;
        starterPrompts: string[];
        mastery: LearningPanelMasterySummary;
        usage: LearningPanelUsageStatus;
        threads: Array<{
          id: string;
          title: string;
          originSurfaceKey: string | null;
          lastMessageAt: string;
          preview: string;
        }>;
      }>(`/learning-panel/bootstrap${surfaceKey ? `?surfaceKey=${encodeURIComponent(surfaceKey)}` : ''}`),
    createThread: (body: {
      originSurfaceKey?: string;
      initialMessage: string;
      instrumentId?: string;
    }) => api.post<{ thread: LearningPanelThread; usage: LearningPanelUsageStatus }>('/learning-panel/threads', body),
    getThread: (threadId: string) =>
      api.get<{ thread: LearningPanelThread }>(`/learning-panel/threads/${threadId}`),
    appendMessage: (
      threadId: string,
      body: { message: string; surfaceKey?: string; instrumentId?: string },
    ) => api.post<{ thread: LearningPanelThread; usage: LearningPanelUsageStatus }>(`/learning-panel/threads/${threadId}/messages`, body),
    submitFeedback: (
      messageId: string,
      body: { feedback: 'helpful' | 'unhelpful'; note?: string },
    ) => api.post<{
      feedback: {
        messageId: string;
        feedback: 'helpful' | 'unhelpful';
        note: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/learning-panel/messages/${messageId}/feedback`, body),
  };
}
