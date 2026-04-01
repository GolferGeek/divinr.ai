import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { StocksPredictionPlane } from '@divinr/prediction-planes';
import type { PredictionPlane, DashboardLayout, CardFieldDefinition, PredictionDisplayConfig } from '@divinr/prediction-planes';

const planeRegistry: Record<string, PredictionPlane> = {
  financial: new StocksPredictionPlane(),
};

export const useDomainStore = defineStore('domain', () => {
  const activeDomain = ref(localStorage.getItem('divinr_domain') || 'financial');
  const activeUniverse = ref(localStorage.getItem('divinr_universe') || 'stocks');

  function setDomain(domain: string, universe?: string) {
    activeDomain.value = domain;
    localStorage.setItem('divinr_domain', domain);
    if (universe) {
      activeUniverse.value = universe;
      localStorage.setItem('divinr_universe', universe);
    }
  }

  const plane = computed<PredictionPlane | null>(
    () => planeRegistry[activeDomain.value] ?? null,
  );

  const dashboardLayout = computed<DashboardLayout | null>(
    () => plane.value?.presentation.getDashboardLayout() ?? null,
  );

  const instrumentCardFields = computed<CardFieldDefinition[]>(
    () => plane.value?.presentation.getInstrumentCardFields() ?? [],
  );

  const predictionDisplayFormat = computed<PredictionDisplayConfig | null>(
    () => plane.value?.presentation.getPredictionDisplayFormat() ?? null,
  );

  const visualizationTypes = computed(
    () => plane.value?.presentation.getVisualizationTypes() ?? [],
  );

  return {
    activeDomain, activeUniverse, setDomain,
    plane, dashboardLayout, instrumentCardFields,
    predictionDisplayFormat, visualizationTypes,
  };
});
