<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useOnboardingStore } from '../stores/onboarding.store';

const onboarding = useOnboardingStore();

let highlighted: Element[] = [];

function clearHighlights() {
  for (const el of highlighted) {
    el.classList.remove('tour-pulse');
  }
  highlighted = [];
}

function applyHighlights(selectors: string[]) {
  clearHighlights();
  for (const sel of selectors) {
    try {
      const nodes = document.querySelectorAll(sel);
      nodes.forEach((n) => {
        n.classList.add('tour-pulse');
        highlighted.push(n);
      });
    } catch {
      // Silent no-op on bad selectors — logged at dev time only via console.
    }
  }
}

watch(
  () => onboarding.pulseTargets,
  (selectors) => {
    if (!onboarding.active || !onboarding.docentVisible) {
      clearHighlights();
      return;
    }
    // Defer to next tick so the destination view has mounted its elements.
    setTimeout(() => applyHighlights(selectors ?? []), 0);
  },
  { immediate: true, deep: true },
);

watch(
  () => onboarding.docentVisible,
  (visible) => {
    if (!visible) clearHighlights();
    else applyHighlights(onboarding.pulseTargets ?? []);
  },
);

onBeforeUnmount(clearHighlights);
</script>

<template>
  <!-- Rendering-only component; styles live in the global stylesheet below. -->
  <span aria-hidden="true" style="display: none" />
</template>

<style>
/* Global style — tour-pulse class is applied to arbitrary DOM elements outside this component's scope. */
.tour-pulse {
  position: relative;
  outline: 2px solid var(--ion-color-primary, #3b82f6);
  outline-offset: 3px;
  border-radius: 4px;
  animation: tour-pulse-anim 1.8s ease-in-out infinite;
}

@keyframes tour-pulse-anim {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
  }
}
</style>
