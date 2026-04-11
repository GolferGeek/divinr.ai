import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.divinr.app',
  appName: 'Divinr AI',
  webDir: 'dist',
  ios: {
    preferredContentMode: 'mobile',
  },
};

export default config;
