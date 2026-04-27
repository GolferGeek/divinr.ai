<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import LearningPanelSurface from '../components/LearningPanelSurface.vue';

const route = useRoute();

const surfaceKey = computed(() => {
  const raw = route.query.surfaceKey;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'chat';
});

const hiddenPath = computed(() => {
  const raw = route.query.hiddenPath;
  return typeof raw === 'string' ? raw : '';
});

const requiredLevel = computed(() => {
  const raw = route.query.requiredLevel;
  return typeof raw === 'string' ? raw : '';
});
</script>

<template>
  <div class="chat-route">
    <LearningPanelSurface
      :surface-key="surfaceKey"
      :hidden-path="hiddenPath"
      :required-level="requiredLevel"
    />
  </div>
</template>

<style scoped>
.chat-route {
  height: calc(100vh - 120px);
  max-width: 1120px;
  margin: 0 auto;
}

@media (max-width: 768px) {
  .chat-route {
    height: calc(100vh - 88px);
  }
}
</style>
