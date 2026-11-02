import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseOptions,
} from 'firebase/app';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

export const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export async function setupMessaging(): Promise<{
  messaging: Messaging;
  worker: ServiceWorkerRegistration;
}> {
  if (!window.isSecureContext || !(await isSupported()))
    throw new Error(
      'Push is unavailable in this browser or on this non-secure origin.',
    );
  if (
    !firebaseConfig.apiKey ||
    !firebaseConfig.projectId ||
    !firebaseConfig.messagingSenderId ||
    !firebaseConfig.appId ||
    !import.meta.env.VITE_FIREBASE_VAPID_KEY
  ) {
    throw new Error('Firebase web configuration is incomplete.');
  }
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const params = new URLSearchParams(
    Object.entries(firebaseConfig).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  // Service workers execute outside Vite's module graph, so their public config is passed in the registration URL.
  const worker = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${params}`,
    { scope: '/' },
  );
  return { messaging: getMessaging(app), worker };
}
