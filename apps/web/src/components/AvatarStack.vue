<!-- Renders up to 3 entrant avatar circles plus an optional +K overflow chip; used on tournament list cards. -->
<script setup lang="ts">
import { computed } from 'vue';

interface Entrant {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const props = defineProps<{
  entrants: Entrant[];
  overflow: number;
}>();

const visibleEntrants = computed<Entrant[]>(() => (props.entrants ?? []).slice(0, 3));
const overflowCount = computed<number>(() => Math.max(0, props.overflow ?? 0));

function initialFor(e: Entrant): string {
  const source = e.display_name ?? e.user_id ?? '';
  return source.slice(0, 1).toUpperCase() || '?';
}

function altFor(e: Entrant): string {
  return e.display_name ?? 'Entrant';
}

// Deterministic user_id → hue; keeps the same user the same color across cards/reloads.
function hueFor(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function bgFor(userId: string): string {
  return `hsl(${hueFor(userId)}, 55%, 50%)`;
}
</script>

<template>
  <div v-if="visibleEntrants.length > 0 || overflowCount > 0" class="avatar-stack">
    <template v-for="(e, i) in visibleEntrants" :key="e.user_id">
      <img
        v-if="e.avatar_url"
        class="avatar-circle"
        :class="{ stacked: i > 0 }"
        :src="e.avatar_url"
        :alt="altFor(e)"
      />
      <div
        v-else
        class="avatar-circle initials"
        :class="{ stacked: i > 0 }"
        :style="{ background: bgFor(e.user_id) }"
        :aria-label="altFor(e)"
      >{{ initialFor(e) }}</div>
    </template>
    <div
      v-if="overflowCount > 0"
      class="avatar-overflow"
      :aria-label="`+${overflowCount} more players`"
    >+{{ overflowCount }}</div>
  </div>
</template>

<style scoped>
.avatar-stack {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.avatar-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.75rem;
  color: #fff;
  border: 2px solid var(--ion-background-color, #fff);
  box-sizing: border-box;
  object-fit: cover;
}
.avatar-circle.stacked {
  margin-left: -8px;
}
.avatar-overflow {
  margin-left: -4px;
  padding: 0 8px;
  height: 22px;
  border-radius: 11px;
  background: var(--ion-color-light-shade, #e0e0e0);
  color: var(--ion-color-dark, #333);
  font-size: 0.7rem;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  border: 2px solid var(--ion-background-color, #fff);
  box-sizing: border-box;
}
</style>
