<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';
import LegalDisclaimer from '../components/LegalDisclaimer.vue';
import { useFirstTouch } from '../composables/useFirstTouch';

const router = useRouter();
useFirstTouch('pricing.overview');

onMounted(() => {
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
});
onUnmounted(() => {
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

const basicIncludes = [
  'Multi-analyst panels, risk debates, and arbitrated signals',
  'Full reasoning traces on every analysis',
  'Paper-trade signals with Kelly-sized positions',
  'Performance dashboards and per-analyst calibration',
  'Learning clubs, tournaments, messaging',
];
const authoringLines = [
  { label: 'Custom instrument', price: '$20/mo each' },
  { label: 'Custom analyst', price: '$60/mo each' },
  { label: 'Bring-your-own API key', price: '$10/mo platform fee' },
];
const studentAuthoringLines = [
  { label: 'Custom instrument', price: '$2/mo each' },
  { label: 'Custom analyst', price: '$6/mo each' },
];
</script>

<template>
  <div class="pricing">
    <header class="topbar">
      <span class="brand">Divinr</span>
      <button class="btn-ghost" @click="router.push('/login')">Sign in</button>
    </header>

    <section class="hero">
      <h1>One plan. Everything included.</h1>
      <p class="subhead">
        Divinr Basic is $50/month. Start with a 30-day free trial — no card required.
      </p>
    </section>

    <section class="cards" data-testid="pricing-cards">
      <div class="card card-basic" data-testid="pricing-card-basic">
        <div class="card-head">
          <h2>Divinr Basic</h2>
          <div class="price">
            <span class="amount">$50</span><span class="per">/month</span>
          </div>
          <p class="trial-note">30-day free trial</p>
        </div>
        <ul class="includes">
          <li v-for="line in basicIncludes" :key="line">
            <ion-icon :icon="checkmarkCircleOutline" class="check" />
            <span>{{ line }}</span>
          </li>
        </ul>
        <button class="btn-primary" data-testid="start-free-trial" @click="router.push('/login')">
          Start free trial
        </button>
      </div>

      <div class="card card-authoring" data-testid="pricing-card-authoring">
        <div class="card-head">
          <h2>Make it yours</h2>
          <p class="subhead-sm">Optional add-ons. Only charged while active.</p>
        </div>
        <ul class="addons">
          <li v-for="line in authoringLines" :key="line.label">
            <span class="addon-label">{{ line.label }}</span>
            <span class="addon-price">{{ line.price }}</span>
          </li>
        </ul>
        <p class="note">
          Author your own analysts and instruments on top of Basic. Cancel any time —
          billing stops the month the item is deactivated.
        </p>
      </div>

      <div class="card card-student" data-testid="pricing-card-student">
        <div class="card-head">
          <h2>Students</h2>
          <p class="subhead-sm">.edu email gets you 90% off authored content. No Basic monthly.</p>
        </div>
        <ul class="addons">
          <li v-for="line in studentAuthoringLines" :key="line.label">
            <span class="addon-label">{{ line.label }}</span>
            <span class="addon-price">{{ line.price }}</span>
          </li>
        </ul>
        <p class="note">
          Sign up with your .edu email and you only pay for what you author — at 10% of
          the regular per-item price. A student with zero authored items owes $0/month.
          Status is re-checked monthly.
        </p>
      </div>
    </section>

    <footer class="pricing-footer">
      <LegalDisclaimer variant="full" />
    </footer>
  </div>
</template>

<style scoped>
.pricing {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  background: #fff;
  min-height: 100vh;
}

.topbar {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.brand { font-weight: 700; font-size: 1.2rem; }
.btn-ghost {
  background: transparent;
  border: 1px solid #1a1a2e;
  color: #1a1a2e;
  padding: 8px 18px;
  border-radius: 6px;
  cursor: pointer;
}

.hero {
  text-align: center;
  padding: 48px 24px 32px;
  max-width: 720px;
  margin: 0 auto;
}
.hero h1 { font-size: 2.4rem; margin: 0 0 12px; }
.subhead { font-size: 1.1rem; color: #444; }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
  max-width: 1040px;
  margin: 24px auto 48px;
  padding: 0 24px;
}

.card {
  border: 1px solid #e0e0e8;
  border-radius: 12px;
  padding: 32px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.card-head h2 { margin: 0 0 8px; font-size: 1.4rem; }
.card-head .subhead-sm { color: #666; margin: 0; font-size: 0.95rem; }

.price { margin: 12px 0 4px; }
.price .amount { font-size: 2.6rem; font-weight: 700; }
.price .per { color: #666; font-size: 1rem; }
.trial-note { color: #2a7a2a; font-weight: 600; margin: 0 0 16px; }

.includes, .addons {
  list-style: none;
  padding: 0;
  margin: 20px 0;
}
.includes li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
  color: #222;
}
.check { color: #2a7a2a; font-size: 1.2rem; flex-shrink: 0; }

.addons li {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f4;
}
.addon-price { font-weight: 600; }

.note { color: #666; font-size: 0.9rem; margin-top: 16px; }

.btn-primary {
  width: 100%;
  background: #1a1a2e;
  color: #fff;
  border: none;
  padding: 14px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}
.btn-primary:hover { background: #0f3460; }

.pricing-footer {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
}
</style>
