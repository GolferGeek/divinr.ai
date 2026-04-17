import { useApi } from '../composables/useApi';

export function useBillingApi() {
  const api = useApi('/api');
  return {
    getBillingPreview: () => api.get<any>('/billing/preview'),
    getSubscription: () => api.get<any>('/billing/subscription'),
  };
}

export function useAuthoredContentApi() {
  const api = useApi();

  return {
    listMyAnalysts: () => api.get<any[]>('/analysts/mine'),
    createAnalyst: (body: { slug: string; displayName: string; personaPrompt: string }) =>
      api.post<any>('/analysts', body),
    deleteAnalyst: (id: string) => api.delete(`/analysts/${id}`),
    scaffoldAnalystContract: (id: string) =>
      api.post<{ contextMarkdown: string; versionId: string }>(`/analysts/${id}/contract/scaffold`),
    updateAnalystMetadata: (id: string, patch: {
      displayName?: string;
      llmProvider?: string | null;
      llmModel?: string | null;
      byoCredentialId?: string | null;
    }) => api.patch(`/analysts/${id}/metadata`, patch),

    listMyInstruments: () => api.get<any[]>('/instruments/mine'),
    createInstrument: (body: { symbol: string; name: string; assetType?: string }) =>
      api.post<any>('/instruments', body),
    deleteInstrument: (id: string) => api.delete(`/instruments/${id}`),
    scaffoldInstrumentContract: (id: string) =>
      api.post<{ contextMarkdown: string; versionId: string }>(`/instruments/${id}/contract/scaffold`),

    // Wiring (analyst↔instrument assignments)
    listMyWirings: () =>
      api.get<{
        analysts: any[];
        instruments: any[];
        wirings: { analystId: string; instrumentId: string }[];
      }>('/wiring/mine'),
    addWiring: (analystId: string, instrumentId: string) =>
      api.post('/wiring', { analystId, instrumentId }),
    removeWiring: (analystId: string, instrumentId: string) =>
      api.post('/wiring/remove', { analystId, instrumentId }),
  };
}

export function useCredentialsApi() {
  const api = useApi('/api');
  return {
    listCredentials: () => api.get<any[]>('/credentials/llm'),
    addCredential: (body: { provider: string; label: string; secret: string }) =>
      api.post('/credentials/llm', body),
    revokeCredential: (id: string) => api.delete(`/credentials/llm/${id}`),
  };
}
