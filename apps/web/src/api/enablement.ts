import { useApi } from '../composables/useApi';

export interface EnabledTriple {
  id: string;
  authorUserId: string | null;
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  enabledAt: string;
}

export interface AvailableTriple {
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  isEnabled: boolean;
  authorUserId: string | null;
}

export function useEnablementApi() {
  const api = useApi();

  return {
    fetchEnabledTriples: () =>
      api.get<EnabledTriple[]>('/portfolio/enabled-triples'),

    fetchAvailableTriples: (instrumentId?: string) => {
      const qs = instrumentId ? `?instrumentId=${instrumentId}` : '';
      return api.get<AvailableTriple[]>(`/portfolio/available-triples${qs}`);
    },

    enableTriple: (analystId: string, instrumentId: string, authorUserId?: string) =>
      api.post<EnabledTriple>('/portfolio/enable-triple', {
        analystId,
        instrumentId,
        ...(authorUserId ? { authorUserId } : {}),
      }),

    disableTriple: (analystId: string, instrumentId: string, authorUserId?: string) =>
      api.post<{ disabled: boolean }>('/portfolio/disable-triple', {
        analystId,
        instrumentId,
        ...(authorUserId ? { authorUserId } : {}),
      }),
  };
}
