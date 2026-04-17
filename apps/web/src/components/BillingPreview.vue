<script setup lang="ts">
defineProps<{
  kind: string;
}>();

function kindLabel(kind: string): string {
  switch (kind) {
    case 'custom_analyst': return 'Authored Analyst';
    case 'custom_instrument': return 'Authored Instrument';
    case 'analyst_contract_override': return 'Analyst Contract Override';
    case 'instrument_contract_override': return 'Instrument Contract Override';
    case 'byo_platform_fee': return 'BYO Platform Fee';
    default: return kind;
  }
}
</script>

<template>
  <span>{{ kindLabel(kind) }}</span>
</template>
