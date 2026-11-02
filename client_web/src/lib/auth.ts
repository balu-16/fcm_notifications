import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';

let configured = false;
export function configureAuth(): void {
  if (configured) return;
  const region = import.meta.env.VITE_COGNITO_REGION;
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (
    !region ||
    !userPoolId ||
    !userPoolClientId ||
    !userPoolId.startsWith(`${region}_`)
  )
    throw new Error('Cognito configuration is missing');
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
  const session = await fetchAuthSession({ forceRefresh });
  return session.tokens?.idToken?.toString();
}
export async function clearSession(): Promise<void> {
  await signOut();
}
