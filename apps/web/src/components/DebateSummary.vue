<script setup lang="ts">
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip,
} from '@ionic/vue';

defineProps<{
  debate: Record<string, unknown> | null;
}>();

function asObj(val: unknown): Record<string, unknown> {
  return (val as Record<string, unknown>) ?? {};
}
function asArr(val: unknown): string[] {
  return (val as string[]) ?? [];
}
</script>

<template>
  <ion-card v-if="debate">
    <ion-card-header>
      <ion-card-title style="display:flex;align-items:center;gap:8px">
        Risk Debate
        <span style="flex:1" />
        <ion-chip :color="debate['status'] === 'completed' ? 'success' : 'warning'" style="font-size:0.7rem;height:24px">
          {{ debate['status'] }}
        </ion-chip>
        <div style="font-size:0.85rem">
          <span style="opacity:0.5">Pre-debate:</span> {{ debate['original_score'] }}
          <span style="margin:0 4px">→</span>
          <span style="font-weight:bold">{{ debate['final_score'] }}</span>
          <ion-chip
            :color="Number(debate['score_adjustment']) > 0 ? 'danger' : Number(debate['score_adjustment']) < 0 ? 'success' : 'medium'"
            style="font-size:0.7rem;height:20px;margin-left:4px"
          >
            {{ Number(debate['score_adjustment']) > 0 ? '+' : '' }}{{ debate['score_adjustment'] }}
          </ion-chip>
        </div>
      </ion-card-title>
    </ion-card-header>
    <ion-card-content>
      <ion-grid>
        <ion-row>
          <!-- Blue Agent -->
          <ion-col size="12" size-md="4">
            <div style="border-left:3px solid var(--ion-color-primary);padding-left:12px;margin-bottom:16px">
              <div style="font-size:0.9rem;font-weight:700;color:var(--ion-color-primary);margin-bottom:8px">Blue Agent (Defense)</div>
              <p style="font-size:0.85rem;line-height:1.5;margin-bottom:12px">
                {{ asObj(debate['blue_assessment'])['summary'] }}
              </p>

              <div v-if="asArr(asObj(debate['blue_assessment'])['key_findings']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Key Findings</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(f, i) in asArr(asObj(debate['blue_assessment'])['key_findings'])" :key="i" style="font-size:0.8rem;margin-bottom:4px">{{ f }}</li>
                </ul>
              </div>

              <div v-if="asArr(asObj(debate['blue_assessment'])['evidence_cited']).length">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Evidence Cited</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(e, i) in asArr(asObj(debate['blue_assessment'])['evidence_cited'])" :key="i" style="font-size:0.75rem;opacity:0.7;margin-bottom:2px">{{ e }}</li>
                </ul>
              </div>
            </div>
          </ion-col>

          <!-- Red Agent -->
          <ion-col size="12" size-md="4">
            <div style="border-left:3px solid var(--ion-color-danger);padding-left:12px;margin-bottom:16px">
              <div style="font-size:0.9rem;font-weight:700;color:var(--ion-color-danger);margin-bottom:8px">Red Agent (Challenge)</div>

              <div v-if="asArr(asObj(debate['red_challenges'])['challenges']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Challenges</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(c, i) in asArr(asObj(debate['red_challenges'])['challenges'])" :key="i" style="font-size:0.8rem;margin-bottom:4px">{{ c }}</li>
                </ul>
              </div>

              <div v-if="asArr(asObj(debate['red_challenges'])['blind_spots']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Blind Spots Identified</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(b, i) in asArr(asObj(debate['red_challenges'])['blind_spots'])" :key="i" style="font-size:0.8rem;margin-bottom:4px;color:var(--ion-color-danger)">{{ b }}</li>
                </ul>
              </div>

              <div v-if="asArr(asObj(debate['red_challenges'])['overstated_risks']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Overstated Risks</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(o, i) in asArr(asObj(debate['red_challenges'])['overstated_risks'])" :key="i" style="font-size:0.75rem;opacity:0.7;margin-bottom:2px">{{ o }}</li>
                </ul>
              </div>

              <div v-if="asArr(asObj(debate['red_challenges'])['understated_risks']).length">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Understated Risks</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(u, i) in asArr(asObj(debate['red_challenges'])['understated_risks'])" :key="i" style="font-size:0.75rem;color:var(--ion-color-warning);margin-bottom:2px">{{ u }}</li>
                </ul>
              </div>
            </div>
          </ion-col>

          <!-- Arbiter -->
          <ion-col size="12" size-md="4">
            <div style="border-left:3px solid var(--ion-color-success);padding-left:12px;margin-bottom:16px">
              <div style="font-size:0.9rem;font-weight:700;color:var(--ion-color-success);margin-bottom:8px">Arbiter (Synthesis)</div>
              <p style="font-size:0.85rem;line-height:1.5;margin-bottom:12px">
                {{ asObj(debate['arbiter_synthesis'])['final_assessment'] }}
              </p>

              <div v-if="asArr(asObj(debate['arbiter_synthesis'])['accepted_challenges']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Accepted Challenges</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(a, i) in asArr(asObj(debate['arbiter_synthesis'])['accepted_challenges'])" :key="i" style="font-size:0.8rem;margin-bottom:4px">{{ a }}</li>
                </ul>
              </div>

              <div v-if="asArr(asObj(debate['arbiter_synthesis'])['rejected_challenges']).length" style="margin-bottom:8px">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Rejected Challenges</div>
                <ul style="margin:0;padding-left:16px">
                  <li v-for="(r, i) in asArr(asObj(debate['arbiter_synthesis'])['rejected_challenges'])" :key="i" style="font-size:0.75rem;opacity:0.5;margin-bottom:2px;text-decoration:line-through">{{ r }}</li>
                </ul>
              </div>

              <div v-if="asObj(debate['arbiter_synthesis'])['adjustment_reasoning']" style="margin-top:8px;padding:8px;border-radius:8px;background:var(--ion-color-light)">
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:4px">Adjustment Reasoning</div>
                <p style="font-size:0.8rem;margin:0">{{ asObj(debate['arbiter_synthesis'])['adjustment_reasoning'] }}</p>
              </div>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-card-content>
  </ion-card>
</template>
