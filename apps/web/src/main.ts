import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';

/* Ionic CSS */
import '@ionic/vue/css/ionic.bundle.css';

import App from './App.vue';
import { router } from './router';

const app = createApp(App);
app.use(createPinia());
app.use(IonicVue, { mode: 'md' });
app.use(router);

router.isReady().then(() => {
  app.mount('#app');
});
