import 'react-native-get-random-values';
import '@aws-amplify/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

let configured = false;
export function configureAuth(): void {
  if (configured) return;
  const region = process.env.EXPO_PUBLIC_COGNITO_REGION;
  const userPoolId = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID;
  const userPoolClientId = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID;
  if (
    !region ||
    !userPoolId ||
    !userPoolClientId ||
    !userPoolId.startsWith(`${region}_`)
  )
    throw new Error('Cognito configuration is missing.');
  cognitoUserPoolsTokenProvider.setKeyValueStorage(AsyncStorage);
  Amplify.configure({
    Auth: {
      Cognito: { userPoolId, userPoolClientId, loginWith: { email: true } },
    },
  });
  configured = true;
}
export async function idToken(
  forceRefresh = false,
): Promise<string | undefined> {
  return (await fetchAuthSession({ forceRefresh })).tokens?.idToken?.toString();
}
export async function clearSession(): Promise<void> {
  await signOut();
}
