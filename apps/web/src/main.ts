import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import { Capacitor } from '@capacitor/core';

/* Ionic CSS */
import '@ionic/vue/css/ionic.bundle.css';

import App from './App.vue';
import { router } from './router';
import { bootstrapAuth } from './auth/bootstrap-auth';

async function configureNativePlugins() {
  if (!Capacitor.isNativePlatform()) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setOverlaysWebView({ overlay: true });
}

async function start() {
  const app = createApp(App);
  app.use(createPinia());
  app.use(IonicVue, { mode: 'md' });

  // Auto-login MUST run before the router is installed. The router.beforeEach
  // guard reads localStorage during the initial navigation triggered by
  // router.isReady(); if the token isn't in place yet, the guard redirects
  // to /login and the user lands on the manual login page even though
  // bootstrapAuth would have logged them in a moment later.
  // Pinia is installed above so useAuthStore() works inside bootstrapAuth.
  await bootstrapAuth();

  app.use(router);
  await router.isReady();
  app.mount('#app');

  // Configure native plugins and hide splash screen after mount
  await configureNativePlugins();
  if (Capacitor.isNativePlatform()) {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  }
}

start().catch((err) => {
  console.error('[main] startup failed:', err);
});
