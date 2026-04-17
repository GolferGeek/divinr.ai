import { useBillingSummaryStore, type ConfigurationOverride, type PredictionResult } from '../stores/billing-summary.store';

export function useCostPrediction() {
  const store = useBillingSummaryStore();

  async function predictForUser(userId: string): Promise<PredictionResult | null> {
    return await store.predictCost(userId);
  }

  async function predictWithOverride(userId: string, override: ConfigurationOverride): Promise<PredictionResult | null> {
    return await store.predictCost(userId, override);
  }

  return { predictForUser, predictWithOverride };
}
