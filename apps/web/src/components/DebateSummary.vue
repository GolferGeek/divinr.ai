<script setup lang="ts">
import { ref } from 'vue';
import { useApi } from '../composables/useApi';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonGrid, IonRow, IonCol, IonChip, IonButton, IonNote, IonProgressBar,
} from '@ionic/vue';

const props = defineProps<{
  debate: Record<string, unknown> | null;
}>();

const api = useApi();

interface AgentReasoning {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  reasoningContent: string | null;
  reasoningTruncated: boolean;
}

interface ReasoningData {
  blue: AgentReasoning | null;
  red: AgentReasoning | null;
  arbiter: AgentReasoning | null;
}

const reasoningData = ref<ReasoningData | null>(null);
const reasoningLoading = ref(false);
const reasoningError = ref<string | null>(null);
const expandedAgents = ref<Set<string>>(new Set());

function asObj(val: unknown): Record<string, unknown> {
  return (val as Record<string, unknown>) ?? {};
}
function asArr(val: unknown): string[] {
  return (val as string[]) ?? [];
}

function hasLlmUsageId(role: string): boolean {
  if (!props.debate) return false;
  const transcript = (props.debate['transcript'] ?? []) as Array<{ role: string; llm_usage_id: string | null }>;
  return transcript.some(t => t.role === role && t.llm_usage_id);
}

async function fetchReasoning() {
  if (reasoningData.value || reasoningLoading.value || !props.debate) return;
  reasoningLoading.value = true;
  reasoningError.value = null;
  try {
    reasoningData.value = await api.get<ReasoningData>(`/risk-debates/${props.debate['id']}/reasoning`);
  } catch (err) {
    reasoningError.value = err instanceof Error ? err.message : String(err);
  }
  reasoningLoading.value = false;
}

function toggleAgent(role: string) {
  const next = new Set(expandedAgents.value);
  if (next.has(role)) {
    next.delete(role);
  } else {
    next.add(role);
    fetchReasoning();
  }
  expandedAgents.value = next;
}

function agentReasoning(role: string): AgentReasoning | null {
  if (!reasoningData.value) return null;
  return (reasoningData.value as Record<string, AgentReasoning | null>)[role] ?? null;
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

              <!-- Reasoning toggle -->
              <div v-if="hasLlmUsageId('blue')" style="margin-top:12px">
                <ion-button size="small" fill="clear" @click="toggleAgent('blue')">
                  {{ expandedAgents.has('blue') ? 'Hide Reasoning' : 'Show Reasoning' }}
                </ion-button>
                <template v-if="expandedAgents.has('blue')">
                  <ion-progress-bar v-if="reasoningLoading" type="indeterminate" style="margin:8px 0" />
                  <ion-note v-if="reasoningError" color="danger" style="display:block;font-size:0.75rem;margin-top:4px">{{ reasoningError }}</ion-note>
                  <div v-else-if="agentReasoning('blue')" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--ion-color-light)">
                    <ion-chip color="medium" style="font-size:0.6rem;height:18px">{{ agentReasoning('blue')!.provider }} / {{ agentReasoning('blue')!.model }}</ion-chip>
                    <div style="font-size:0.7rem;opacity:0.6;margin:4px 0">
                      input: {{ agentReasoning('blue')!.inputTokens ?? '—' }} | output: {{ agentReasoning('blue')!.outputTokens ?? '—' }} | reasoning: {{ agentReasoning('blue')!.reasoningTokens ?? '—' }}
                    </div>
                    <pre v-if="agentReasoning('blue')!.reasoningContent" style="white-space:pre-wrap;font-size:0.75rem;line-height:1.5;margin:4px 0 0 0;max-height:400px;overflow-y:auto">{{ agentReasoning('blue')!.reasoningContent }}</pre>
                    <ion-note v-else style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                  </div>
                  <ion-note v-else-if="!reasoningLoading && !reasoningError" style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                </template>
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

              <!-- Reasoning toggle -->
              <div v-if="hasLlmUsageId('red')" style="margin-top:12px">
                <ion-button size="small" fill="clear" @click="toggleAgent('red')">
                  {{ expandedAgents.has('red') ? 'Hide Reasoning' : 'Show Reasoning' }}
                </ion-button>
                <template v-if="expandedAgents.has('red')">
                  <ion-progress-bar v-if="reasoningLoading" type="indeterminate" style="margin:8px 0" />
                  <ion-note v-if="reasoningError" color="danger" style="display:block;font-size:0.75rem;margin-top:4px">{{ reasoningError }}</ion-note>
                  <div v-else-if="agentReasoning('red')" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--ion-color-light)">
                    <ion-chip color="medium" style="font-size:0.6rem;height:18px">{{ agentReasoning('red')!.provider }} / {{ agentReasoning('red')!.model }}</ion-chip>
                    <div style="font-size:0.7rem;opacity:0.6;margin:4px 0">
                      input: {{ agentReasoning('red')!.inputTokens ?? '—' }} | output: {{ agentReasoning('red')!.outputTokens ?? '—' }} | reasoning: {{ agentReasoning('red')!.reasoningTokens ?? '—' }}
                    </div>
                    <pre v-if="agentReasoning('red')!.reasoningContent" style="white-space:pre-wrap;font-size:0.75rem;line-height:1.5;margin:4px 0 0 0;max-height:400px;overflow-y:auto">{{ agentReasoning('red')!.reasoningContent }}</pre>
                    <ion-note v-else style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                  </div>
                  <ion-note v-else-if="!reasoningLoading && !reasoningError" style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                </template>
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

              <!-- Reasoning toggle -->
              <div v-if="hasLlmUsageId('arbiter')" style="margin-top:12px">
                <ion-button size="small" fill="clear" @click="toggleAgent('arbiter')">
                  {{ expandedAgents.has('arbiter') ? 'Hide Reasoning' : 'Show Reasoning' }}
                </ion-button>
                <template v-if="expandedAgents.has('arbiter')">
                  <ion-progress-bar v-if="reasoningLoading" type="indeterminate" style="margin:8px 0" />
                  <ion-note v-if="reasoningError" color="danger" style="display:block;font-size:0.75rem;margin-top:4px">{{ reasoningError }}</ion-note>
                  <div v-else-if="agentReasoning('arbiter')" style="margin-top:8px;padding:8px;border-radius:6px;background:var(--ion-color-light)">
                    <ion-chip color="medium" style="font-size:0.6rem;height:18px">{{ agentReasoning('arbiter')!.provider }} / {{ agentReasoning('arbiter')!.model }}</ion-chip>
                    <div style="font-size:0.7rem;opacity:0.6;margin:4px 0">
                      input: {{ agentReasoning('arbiter')!.inputTokens ?? '—' }} | output: {{ agentReasoning('arbiter')!.outputTokens ?? '—' }} | reasoning: {{ agentReasoning('arbiter')!.reasoningTokens ?? '—' }}
                    </div>
                    <pre v-if="agentReasoning('arbiter')!.reasoningContent" style="white-space:pre-wrap;font-size:0.75rem;line-height:1.5;margin:4px 0 0 0;max-height:400px;overflow-y:auto">{{ agentReasoning('arbiter')!.reasoningContent }}</pre>
                    <ion-note v-else style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                  </div>
                  <ion-note v-else-if="!reasoningLoading && !reasoningError" style="display:block;font-size:0.75rem;margin-top:4px">No extended reasoning captured for this agent.</ion-note>
                </template>
              </div>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-card-content>
  </ion-card>
</template>
