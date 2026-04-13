<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  analyticsOutline, peopleOutline, shieldOutline, bulbOutline,
  trophyOutline, heartOutline, notificationsOutline, briefcaseOutline,
  gitNetworkOutline, chatbubblesOutline, ribbonOutline, statsChartOutline,
} from 'ionicons/icons';
import { IonIcon } from '@ionic/vue';

const router = useRouter();

// Ionic sets body overflow:hidden — override for this public page
onMounted(() => {
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
});
onUnmounted(() => {
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

const features = [
  {
    icon: peopleOutline,
    title: 'Multi-Analyst Predictions',
    desc: 'Five specialized AI analysts make independent calls. An arbitrator synthesizes them into a consensus signal.',
  },
  {
    icon: shieldOutline,
    title: 'Risk Analysis & Debate',
    desc: 'Four risk dimensions scored through a structured bull/bear/arbiter debate. See the reasoning, not just the number.',
  },
  {
    icon: briefcaseOutline,
    title: 'Paper Trading',
    desc: 'Every prediction comes with Kelly-sized trade recommendations. Watch analyst portfolios compete against SPY.',
  },
  {
    icon: statsChartOutline,
    title: 'Performance & Calibration',
    desc: 'Track accuracy, win rates, and calibration across hundreds of predictions. Per-instrument drill-downs.',
  },
  {
    icon: bulbOutline,
    title: 'Self-Improving AI',
    desc: 'Three tiers of learning: autonomous micro-adjustments, audited corrections, and strategic contract rewrites.',
  },
  {
    icon: gitNetworkOutline,
    title: 'Analyst Coordination',
    desc: 'Correlation matrix, coverage gaps, and leave-one-out contribution scoring. See how your analysts work together.',
  },
  {
    icon: heartOutline,
    title: 'Personalized Affinity',
    desc: 'The platform learns which analysts match your thinking. Contrarian alerts when a trusted analyst disagrees.',
  },
  {
    icon: notificationsOutline,
    title: 'Real-Time Alerts',
    desc: 'Stop-loss triggers, sentiment shifts, and learning milestones pushed to your feed as they happen.',
  },
  {
    icon: chatbubblesOutline,
    title: 'Investment Clubs',
    desc: 'Form private groups. Prediction challenges, consensus polls, strategy journals, mentoring, and live chat.',
  },
  {
    icon: trophyOutline,
    title: 'Tournaments',
    desc: 'Compete on market analysis with virtual portfolios. Weekly sprints, season-long events, live leaderboards.',
  },
  {
    icon: ribbonOutline,
    title: 'Analyst Contracts',
    desc: 'Every AI analyst has a written contract you can read, edit, and version. Full audit trail on every change.',
  },
  {
    icon: analyticsOutline,
    title: 'Full Transparency',
    desc: 'Every prediction, every risk score, every learning adaptation — visible, explainable, challengeable.',
  },
];
</script>

<template>
  <div class="landing">
    <!-- Hero -->
    <header class="hero">
      <div class="hero-inner">
        <div class="hero-brand">Divinr</div>
        <nav class="hero-nav">
          <button class="nav-btn" @click="router.push('/login')">Log In</button>
        </nav>
      </div>
      <div class="hero-content">
        <h1>AI market analysis you can actually understand.</h1>
        <p class="hero-sub">
          Five specialized AI analysts. Transparent reasoning. Structured debate.
          A system that learns from its mistakes — and shows you how.
        </p>
        <div class="hero-actions">
          <button class="btn-primary" @click="router.push('/login')">Get Started</button>
        </div>
      </div>
    </header>

    <!-- Differentiator -->
    <section class="section differentiator">
      <div class="section-inner">
        <h2>Explainability over black boxes</h2>
        <p>
          Most AI trading tools give you a number and expect you to trust it.
          Divinr shows you the work. Every prediction traces back to independent analysts
          with documented reasoning. Every risk score comes from a structured debate.
          Every learning adaptation is visible.
        </p>
        <p>
          This isn't about replacing your judgment. It's about giving you better
          inputs to make your own decisions.
        </p>
      </div>
    </section>

    <!-- Features -->
    <section class="section features-section">
      <div class="section-inner">
        <h2>What's inside</h2>
        <div class="features-grid">
          <div v-for="f in features" :key="f.title" class="feature-card">
            <ion-icon :icon="f.icon" class="feature-icon" />
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- How it works -->
    <section class="section how-section">
      <div class="section-inner">
        <h2>How it works</h2>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <h3>Analysts predict</h3>
            <p>Five AI analysts independently analyze each instrument with their own strategy and reasoning.</p>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <h3>Debate and score</h3>
            <p>Risk agents debate worst-case scenarios. An arbitrator synthesizes everything into a consensus signal.</p>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <h3>You decide</h3>
            <p>See every rationale, every confidence level, every trade recommendation. Act on your own terms.</p>
          </div>
          <div class="step">
            <div class="step-num">4</div>
            <h3>The system learns</h3>
            <p>Nightly evaluations score predictions against real outcomes. The AI adapts — and you can see exactly how.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="section cta-section">
      <div class="section-inner">
        <h2>Ready to see the reasoning?</h2>
        <p>Join the beta and explore transparent AI market analysis.</p>
        <button class="btn-primary" @click="router.push('/login')">Get Started</button>
      </div>
    </section>

    <!-- Footer -->
    <footer class="landing-footer">
      <p>Divinr provides AI-generated analysis and signals for educational purposes. Not investment advice.</p>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  background: #fff;
}

/* Hero */
.hero {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff;
  padding: 0 24px;
  min-height: 520px;
  display: flex;
  flex-direction: column;
}

.hero-inner {
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
}

.hero-brand {
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.nav-btn {
  background: rgba(255,255,255,0.12);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.nav-btn:hover {
  background: rgba(255,255,255,0.2);
}

.hero-content {
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 40px 0 60px;
}

.hero-content h1 {
  font-size: 2.8rem;
  font-weight: 800;
  line-height: 1.15;
  max-width: 700px;
  margin: 0 0 20px;
  letter-spacing: -0.02em;
}

.hero-sub {
  font-size: 1.15rem;
  line-height: 1.6;
  max-width: 560px;
  opacity: 0.85;
  margin: 0 0 32px;
}

.hero-actions {
  display: flex;
  gap: 12px;
}

.btn-primary {
  background: #3880ff;
  color: #fff;
  border: none;
  padding: 14px 32px;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #2868d9;
}

/* Sections */
.section {
  padding: 80px 24px;
}

.section-inner {
  max-width: 1100px;
  margin: 0 auto;
}

.section h2 {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 16px;
  letter-spacing: -0.01em;
}

.section p {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #444;
  max-width: 680px;
}

/* Differentiator */
.differentiator {
  background: #f8f9fa;
}

/* Features */
.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
  margin-top: 32px;
}

.feature-card {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 28px;
  transition: box-shadow 0.2s;
}

.feature-card:hover {
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
}

.feature-icon {
  font-size: 1.6rem;
  color: #3880ff;
  margin-bottom: 12px;
}

.feature-card h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 8px;
}

.feature-card p {
  font-size: 0.9rem;
  line-height: 1.5;
  color: #666;
  margin: 0;
}

/* How it works */
.how-section {
  background: #f8f9fa;
}

.steps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 32px;
  margin-top: 32px;
}

.step {
  text-align: center;
}

.step-num {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #3880ff;
  color: #fff;
  font-size: 1.3rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.step h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0 0 8px;
}

.step p {
  font-size: 0.9rem;
  line-height: 1.5;
  color: #666;
  margin: 0 auto;
  max-width: 260px;
}

/* CTA */
.cta-section {
  text-align: center;
  padding: 80px 24px;
}

.cta-section h2 {
  margin-bottom: 8px;
}

.cta-section p {
  margin: 0 auto 24px;
  text-align: center;
}

/* Footer */
.landing-footer {
  text-align: center;
  padding: 24px;
  font-size: 0.75rem;
  color: #999;
  border-top: 1px solid #eee;
}

/* Mobile */
@media (max-width: 600px) {
  .hero-content h1 {
    font-size: 1.8rem;
  }

  .hero-sub {
    font-size: 1rem;
  }

  .section {
    padding: 48px 16px;
  }

  .section h2 {
    font-size: 1.5rem;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .steps {
    grid-template-columns: 1fr;
  }
}
</style>
