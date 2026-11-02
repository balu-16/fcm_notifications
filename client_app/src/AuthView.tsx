import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  confirmSignUp,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';
import { styles } from './styles';

type Mode = 'signIn' | 'signUp' | 'confirm';
function errorMessage(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  const messages: Record<string, string> = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'Incorrect email or password.',
    UsernameExistsException: 'An account with this email already exists.',
    CodeMismatchException: 'That confirmation code is incorrect.',
    ExpiredCodeException: 'That code expired. Request another.',
    InvalidPasswordException:
      'The password does not meet the user pool requirements.',
    LimitExceededException: 'Too many attempts. Please wait and try again.',
  };
  return (
    messages[name] ??
    'Unable to complete the request. Check your connection and configuration.'
  );
}
export function AuthView({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit() {
    if (
      !email.trim() ||
      (mode !== 'confirm' && !password) ||
      (mode === 'confirm' && !code.trim())
    ) {
      setError('Complete all fields.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signUp') {
        const result = await signUp({
          username: email.trim(),
          password,
          options: { userAttributes: { email: email.trim() } },
        });
        if (result.isSignUpComplete) {
          setMode('signIn');
          setMessage('Your account is ready. Sign in to continue.');
        } else {
          setMode('confirm');
          setMessage('Check your email for the confirmation code.');
        }
      } else if (mode === 'confirm') {
        await confirmSignUp({
          username: email.trim(),
          confirmationCode: code.trim(),
        });
        setMode('signIn');
        setMessage('Your account is confirmed. Sign in to continue.');
      } else {
        const result = await signIn({ username: email.trim(), password });
        if (result.isSignedIn) {
          try {
            await onSignedIn();
          } catch (cause) {
            await signOut().catch(() => undefined);
            throw cause;
          }
        } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
          setMode('confirm');
          setMessage('Confirm your account before signing in.');
        } else
          setError(
            'This account requires an additional sign-in step that this demo does not support.',
          );
      }
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.name === 'UserNotConfirmedException'
      ) {
        setMode('confirm');
        setMessage('Confirm your account before signing in.');
      } else setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError('');
    try {
      await resendSignUpCode({ username: email.trim() });
      setMessage('A new code has been sent.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>FCM LEARNING LAB</Text>
      <Text style={styles.title}>
        {mode === 'signIn'
          ? 'Welcome back'
          : mode === 'signUp'
            ? 'Create an account'
            : 'Confirm your email'}
      </Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      {mode !== 'confirm' && (
        <>
          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            secureTextEntry
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
        </>
      )}
      {mode === 'signUp' && (
        <Text style={styles.hint}>
          Use at least 8 characters with uppercase, lowercase, a number, and a
          symbol. Your pool may require more.
        </Text>
      )}
      {mode === 'confirm' && (
        <>
          <Text style={styles.label}>Confirmation code</Text>
          <TextInput
            accessibilityLabel="Confirmation code"
            keyboardType="number-pad"
            style={styles.input}
            value={code}
            onChangeText={setCode}
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!message && <Text style={styles.message}>{message}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={[styles.button, busy && styles.disabled]}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {mode === 'signIn'
              ? 'Sign in'
              : mode === 'signUp'
                ? 'Create account'
                : 'Confirm'}
          </Text>
        )}
      </Pressable>
      {mode === 'confirm' && (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !email}
          onPress={() => void resend()}
        >
          <Text style={styles.link}>Resend code</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          setError('');
          setMessage('');
        }}
      >
        <Text style={styles.link}>
          {mode === 'signIn'
            ? 'Need an account? Sign up'
            : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </View>
  );
}
