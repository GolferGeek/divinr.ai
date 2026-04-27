<script setup lang="ts">
import LearningPanelSurface from '../components/LearningPanelSurface.vue';
</script>

<template>
  <div class="chat-route">
    <LearningPanelSurface surface-key="chat" />
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
