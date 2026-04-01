<script setup lang="ts">
import { onMounted } from 'vue';
import { usePortfolioStore } from '../stores/portfolio.store';
import {
  IonCard, IonCardContent, IonGrid, IonRow, IonCol,
  IonChip, IonList, IonItem, IonLabel, IonButton, IonNote,
} from '@ionic/vue';

const portfolio = usePortfolioStore();

onMounted(async () => {
  await Promise.all([
    portfolio.fetchMyPortfolio(),
    portfolio.fetchMyPositions('open'),
    portfolio.fetchMyQueue(),
    portfolio.fetchLeaderboard(),
  ]).catch(() => {});
});

function pnlColor(val: unknown): string {
  const n = Number(val);
  if (n > 0) return 'color:var(--ion-color-success)';
  if (n < 0) return 'color:var(--ion-color-danger)';
  return '';
}

function formatCurrency(val: unknown): string {
  const n = Number(val);
  return n >= 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}
</script>

<template>
  <div>
    <h1 style="margin-bottom:16px">Portfolio</h1>

    <!-- My Portfolio Summary -->
    <ion-grid v-if="portfolio.myPortfolio">
      <ion-row>
        <ion-col size="12" size-md="3">
          <ion-card>
            <ion-card-content style="text-align:center">
              <div style="font-size:1.5rem;font-weight:bold">{{ formatCurrency(portfolio.myPortfolio['current_balance']) }}</div>
              <div style="opacity:0.7">Balance</div>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="12" size-md="3">
          <ion-card>
            <ion-card-content style="text-align:center">
              <div style="font-size:1.5rem;font-weight:bold" :style="pnlColor(portfolio.myPortfolio['total_realized_pnl'])">
                {{ formatCurrency(portfolio.myPortfolio['total_realized_pnl']) }}
              </div>
              <div style="opacity:0.7">Realized P&amp;L</div>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="12" size-md="3">
          <ion-card>
            <ion-card-content style="text-align:center">
              <div style="font-size:1.5rem;font-weight:bold" :style="pnlColor(portfolio.myPortfolio['total_unrealized_pnl'])">
                {{ formatCurrency(portfolio.myPortfolio['total_unrealized_pnl']) }}
              </div>
              <div style="opacity:0.7">Unrealized P&amp;L</div>
            </ion-card-content>
          </ion-card>
        </ion-col>
        <ion-col size="12" size-md="3">
          <ion-card>
            <ion-card-content style="text-align:center">
              <div style="font-size:1.5rem;font-weight:bold">{{ portfolio.myPositions.length }}</div>
              <div style="opacity:0.7">Open Positions</div>
            </ion-card-content>
          </ion-card>
        </ion-col>
      </ion-row>
    </ion-grid>

    <!-- Trade Queue -->
    <h2 style="margin-top:16px;margin-bottom:8px">Queued Trades ({{ portfolio.myQueue.length }})</h2>
    <ion-list v-if="portfolio.myQueue.length > 0">
      <ion-item v-for="t in portfolio.myQueue" :key="String(t['id'])">
        <ion-label>
          <h3>{{ t['symbol'] }}</h3>
          <p>
            <ion-chip :color="t['direction'] === 'long' ? 'success' : 'danger'" style="font-size:0.7rem;height:20px">{{ t['direction'] }}</ion-chip>
            Qty: {{ t['quantity'] }}
          </p>
          <p style="font-size:0.75rem">{{ new Date(String(t['queued_at'])).toLocaleString() }}</p>
        </ion-label>
        <ion-button slot="end" fill="clear" size="small" color="danger" @click="portfolio.cancelTrade(String(t['id']))">Cancel</ion-button>
      </ion-item>
    </ion-list>
    <ion-note v-else color="primary" style="display:block;padding:12px">No queued trades. Trades execute at 5 PM ET settlement.</ion-note>

    <!-- Open Positions -->
    <h2 style="margin-top:16px;margin-bottom:8px">Open Positions</h2>
    <ion-list v-if="portfolio.myPositions.length > 0">
      <ion-item v-for="p in portfolio.myPositions" :key="String(p['id'])">
        <ion-label>
          <h3>{{ p['symbol'] }}</h3>
          <p>
            <ion-chip :color="p['direction'] === 'long' ? 'success' : 'danger'" style="font-size:0.7rem;height:20px">{{ p['direction'] }}</ion-chip>
            Qty: {{ p['quantity'] }} | Entry: ${{ Number(p['entry_price']).toFixed(2) }} | Current: ${{ Number(p['current_price']).toFixed(2) }}
          </p>
          <p :style="pnlColor(p['unrealized_pnl'])">P&amp;L: {{ formatCurrency(p['unrealized_pnl']) }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
    <ion-note v-else color="primary" style="display:block;padding:12px">No open positions.</ion-note>

    <!-- Analyst Leaderboard -->
    <h2 style="margin-top:16px;margin-bottom:8px">Analyst Leaderboard</h2>
    <ion-list v-if="portfolio.leaderboard.length > 0">
      <ion-item v-for="(a, i) in portfolio.leaderboard" :key="String(a['id'])">
        <div slot="start" style="font-size:1.25rem;font-weight:bold;min-width:30px">{{ i + 1 }}</div>
        <ion-label>
          <h3 style="font-weight:bold">{{ a['analyst_name'] }}</h3>
          <p>
            Balance: {{ formatCurrency(a['current_balance']) }} |
            <span :style="pnlColor(a['pnl_percent'])">{{ Number(a['pnl_percent']).toFixed(2) }}%</span> |
            Win Rate: {{ a['win_rate'] }}%
          </p>
          <p>
            <ion-chip
              :color="a['status'] === 'active' ? 'success' : a['status'] === 'suspended' ? 'danger' : a['status'] === 'probation' ? 'warning' : 'medium'"
              style="font-size:0.7rem;height:20px"
            >{{ a['status'] }}</ion-chip>
          </p>
        </ion-label>
      </ion-item>
    </ion-list>
    <ion-note v-else color="primary" style="display:block;padding:12px">No analyst portfolios yet. Portfolios are created when analysts make predictions.</ion-note>
  </div>
</template>
