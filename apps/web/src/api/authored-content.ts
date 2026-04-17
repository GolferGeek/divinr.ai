import { useApi } from '../composables/useApi';

export function useAuthoredContentApi() {
  const api = useApi();

  return {
    listMyAnalysts: () => api.get<any[]>('/analysts/mine'),
    createAnalyst: (body: { slug: string; displayName: string; personaPrompt: string }) =>
      api.post<any>('/analysts', body),
    deleteAnalyst: (id: string) => api.delete(`/analysts/${id}`),
    scaffoldAnalystContract: (id: string) =>
      api.post<{ contextMarkdown: string; versionId: string }>(`/analysts/${id}/contract/scaffold`),
    updateAnalystMetadata: (id: string, patch: { displayName?: string }) =>
      api.patch(`/analysts/${id}/metadata`, patch),

    listMyInstruments: () => api.get<any[]>('/instruments/mine'),
    createInstrument: (body: { symbol: string; name: string; assetType?: string }) =>
      api.post<any>('/instruments', body),
    deleteInstrument: (id: string) => api.delete(`/instruments/${id}`),
    scaffoldInstrumentContract: (id: string) =>
      api.post<{ contextMarkdown: string; versionId: string }>(`/instruments/${id}/contract/scaffold`),
  };
}
