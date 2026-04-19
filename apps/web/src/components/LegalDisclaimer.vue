<script setup lang="ts">
import { computed } from 'vue';
import { DISCLAIMERS, type DisclaimerVariant } from '../onboarding/disclaimers';

const props = withDefaults(
  defineProps<{
    variant?: DisclaimerVariant;
  }>(),
  { variant: 'short' },
);

const text = computed(() => DISCLAIMERS[props.variant]);
</script>

<template>
  <p class="legal-disclaimer" :data-variant="props.variant">{{ text }}</p>
</template>

<style scoped>
.legal-disclaimer {
  font-size: 0.78rem;
  line-height: 1.4;
  opacity: 0.7;
  margin: 0;
}
</style>
