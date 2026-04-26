import { useApi } from '../composables/useApi';

export interface LearningPanelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  citations: Array<{ source: string; title: string; content: string }>;
  llmUsageId: string | null;
}

export interface LearningPanelThread {
  id: string;
  title: string;
  originSurfaceKey: string | null;
  createdAt: string;
  updatedAt: string;
  messages: LearningPanelMessage[];
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
    }) => api.post<{ thread: LearningPanelThread }>('/learning-panel/threads', body),
    getThread: (threadId: string) =>
      api.get<{ thread: LearningPanelThread }>(`/learning-panel/threads/${threadId}`),
    appendMessage: (
      threadId: string,
      body: { message: string; surfaceKey?: string; instrumentId?: string },
    ) => api.post<{ thread: LearningPanelThread }>(`/learning-panel/threads/${threadId}/messages`, body),
  };
}
