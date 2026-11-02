import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const androidPackage = process.env.ANDROID_PACKAGE_NAME;
if (!androidPackage)
  throw new Error('ANDROID_PACKAGE_NAME must match the Firebase Android app');

const config: ExpoConfig = {
  name: 'Notifications Learning',
  slug: 'notifications',
  owner: 'balu16',
  version: '1.0.0',
  orientation: 'portrait',
  android: {
    package: androidPackage,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON || './google-services.json',
  },
  plugins: [
    [
      'expo-notifications',
      {
        defaultChannel: 'default',
        icon: './assets/notification-icon.png',
        color: '#1d3650',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: process.env.APP_VARIANT === 'development',
        },
      },
    ],
  ],
  ...(process.env.EAS_PROJECT_ID
    ? { extra: { eas: { projectId: process.env.EAS_PROJECT_ID } } }
    : {}),
};

export default config;
