import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

/* Ionic CSS */
import '@ionic/vue/css/ionic.bundle.css';

import App from './App.vue';
import { router } from './router';
import { bootstrapAuth } from './auth/bootstrap-auth';

const app = createApp(App);
app.use(createPinia());
app.use(IonicVue, { mode: 'md' });
app.use(router);

router.isReady().then(async () => {
  // Pinia must be installed before useTenantStore() can be called.
  await bootstrapAuth();
  app.mount('#app');
});
