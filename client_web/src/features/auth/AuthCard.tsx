import { useState, type FormEvent } from 'react';
import { AuthConfigurationError, configureAuth } from '../../lib/auth';
import {
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';

type Mode = 'signIn' | 'signUp' | 'confirm' | 'newPassword';
type Delivery = { deliveryMedium?: string; destination?: string };

function normalizePhone(value: string): string | undefined {
  const compact = value.trim().replace(/[\s()-]/g, '');
  const international = /^\d{10}$/.test(compact) ? `+91${compact}` : compact;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : undefined;
}

function deliveryMessage(details?: Delivery, resent = false): string {
  const action = resent
    ? 'A new confirmation code was sent'
    : 'A confirmation code was sent';
  if (!details?.deliveryMedium || details.deliveryMedium === 'UNKNOWN')
    return resent
      ? 'A new confirmation code has been sent.'
      : 'Check your email or phone for the confirmation code.';
  const destination = details.destination ? ` to ${details.destination}` : '';
  const medium = details.deliveryMedium === 'EMAIL' ? 'email' : 'SMS';
  return `${action} by ${medium}${destination}.`;
}

function errorMessage(error: unknown): string {
  if (error instanceof AuthConfigurationError) return error.message;
  const name = error instanceof Error ? error.name : '';
  const messages: Record<string, string> = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'Incorrect email or password.',
    UsernameExistsException: 'An account with this email already exists.',
    CodeMismatchException: 'That confirmation code is incorrect.',
    ExpiredCodeException: 'That code has expired. Request a new one.',
    InvalidPasswordException:
      'The password does not meet the user pool requirements.',
    LimitExceededException: 'Too many attempts. Please wait and try again.',
    InvalidParameterException:
      'Check your email and phone number and try again.',
    CodeDeliveryFailureException:
      'The confirmation code could not be sent. Please try again later.',
    AliasExistsException:
      'This email or phone number is already used by another account.',
  };
  return (
    messages[name] ??
    'Unable to complete the request. Check your connection and try again.'
  );
}
export type SignInRole = 'user' | 'admin';
export function AuthCard({ onSignedIn }: { onSignedIn: (role: SignInRole) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [role, setRole] = useState<SignInRole>('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [requiredAttributes, setRequiredAttributes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const needsPhone = mode === 'signUp' || (mode === 'newPassword' && requiredAttributes.includes('phone_number'));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const phoneNumber = needsPhone ? normalizePhone(phone) : undefined;
    if (needsPhone && !phoneNumber) {
      setError(
        'Enter a valid phone number with its country code, or a 10-digit Indian mobile number.',
      );
      return;
    }
    if ((mode === 'signUp' || mode === 'newPassword') && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      configureAuth();
      if (mode === 'signUp') {
        const result = await signUp({
          username: email.trim(),
          password,
          options: {
            userAttributes: { email: email.trim(), phone_number: phoneNumber },
          },
        });
        if (result.isSignUpComplete) {
          setMode('signIn');
          setMessage('Your account is ready. Sign in to continue.');
        } else {
          setMode('confirm');
          setMessage(
            deliveryMessage(
              'codeDeliveryDetails' in result.nextStep
                ? result.nextStep.codeDeliveryDetails
                : undefined,
            ),
          );
        }
      } else if (mode === 'newPassword') {
        const attributes: Record<string, string> = {};
        if (requiredAttributes.includes('email')) attributes.email = email.trim();
        if (requiredAttributes.includes('phone_number') && phoneNumber) attributes.phone_number = phoneNumber;
        const result = await confirmSignIn({
          challengeResponse: password,
          ...(Object.keys(attributes).length ? { options: { userAttributes: attributes } } : {}),
        });
        if (result.isSignedIn) await finishSignIn();
        else setError('Your password was updated, but your account requires another sign-in step.');
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
          await finishSignIn();
        } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
          setMode('confirm');
          setMessage('Confirm your account before signing in.');
        } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          const required = result.nextStep.missingAttributes ?? [];
          if (required.some((attribute) => attribute !== 'email' && attribute !== 'phone_number')) {
            setError('Your account requires additional profile details that this sign-in form does not support.');
          } else {
            setRequiredAttributes(required);
            setPassword('');
            setConfirmPassword('');
            setMode('newPassword');
            setMessage('Your temporary password must be replaced before you can sign in.');
          }
        } else {
          const messages: Record<string, string> = {
            CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED:
              'Your account uses a temporary password and must set a new password to finish signing in.',
            RESET_PASSWORD:
              'Your account requires a password reset before you can sign in.',
            CONFIRM_SIGN_IN_WITH_SMS_CODE:
              'Your account requires an SMS verification code to finish signing in.',
            CONFIRM_SIGN_IN_WITH_EMAIL_CODE:
              'Your account requires an email verification code to finish signing in.',
            CONFIRM_SIGN_IN_WITH_TOTP_CODE:
              'Your account requires an authenticator code to finish signing in.',
            CONTINUE_SIGN_IN_WITH_MFA_SELECTION:
              'Your account requires a verification method to finish signing in.',
            CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION:
              'Your account requires a verification method to be set up before signing in.',
            CONTINUE_SIGN_IN_WITH_TOTP_SETUP:
              'Your account requires an authenticator to be set up before signing in.',
            CONTINUE_SIGN_IN_WITH_EMAIL_SETUP:
              'Your account requires email verification to be set up before signing in.',
            CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION:
              'Your account requires a sign-in method to be selected.',
            CONFIRM_SIGN_IN_WITH_PASSWORD:
              'Your account requires a password confirmation to finish signing in.',
            CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE:
              'Your account requires an additional custom sign-in step.',
          };
          setError(messages[result.nextStep.signInStep] ?? 'Your account requires an additional sign-in step.');
        }
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
  async function finishSignIn() {
    const session = await fetchAuthSession();
    const hasEmail = typeof session.tokens?.idToken?.payload.email === 'string';
    try {
      await onSignedIn(role);
    } catch (cause) {
      await signOut().catch(() => undefined);
      setError(cause instanceof Error && cause.message === 'ROLE_MISMATCH'
        ? `This account does not have the ${role} role. Select the correct account type and try again.`
        : hasEmail
        ? 'Sign-in succeeded, but the server could not verify your session. Please try again.'
        : 'Your Cognito app client must have permission to read your email address.');
    }
  }
  async function resend() {
    setBusy(true);
    setError('');
    try {
      const details = await resendSignUpCode({ username: email.trim() });
      setMessage(deliveryMessage(details, true));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-shell">
      <div className="brand-mark">N</div>
      <p className="eyebrow">FCM LEARNING LAB</p>
      <h1>Stay in the loop.</h1>
      <p className="muted">
        Sign in to explore notifications across your devices.
      </p>
      <form className="card auth-card" onSubmit={submit}>
        <h2>
          {mode === 'signIn'
            ? 'Welcome back'
            : mode === 'signUp'
              ? 'Create an account'
              : mode === 'newPassword'
                ? 'Set a new password'
              : 'Confirm your account'}
        </h2>
        {mode === 'signIn' && (
          <fieldset className="sign-in-role">
            <legend>Sign in as</legend>
            <label><input type="radio" name="sign-in-role" checked={role === 'user'} onChange={() => setRole('user')} /> User</label>
            <label><input type="radio" name="sign-in-role" checked={role === 'admin'} onChange={() => setRole('admin')} /> Admin</label>
          </fieldset>
        )}
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        {needsPhone && (
          <label>
            Phone number
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              value={phone}
              placeholder="10-digit Indian number or + country code"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
        )}
        {mode !== 'confirm' && (
          <label>
            {mode === 'newPassword' ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={
                mode === 'signUp' || mode === 'newPassword' ? 'new-password' : 'current-password'
              }
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        {(mode === 'signUp' || mode === 'newPassword') && (
          <>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            <p className="hint">
              Use at least 8 characters with uppercase, lowercase, a number, and
              a symbol. Your pool may require more. Indian 10-digit numbers
              default to +91.
            </p>
          </>
        )}
        {mode === 'confirm' && (
          <label>
            Confirmation code
            <input
              inputMode="numeric"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'signIn'
              ? 'Sign in'
              : mode === 'signUp'
                ? 'Create account'
                : mode === 'newPassword'
                  ? 'Set password'
                : 'Confirm'}
        </button>
        {mode === 'confirm' && (
          <button
            type="button"
            className="link"
            disabled={busy || !email}
            onClick={resend}
          >
            Resend code
          </button>
        )}
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError('');
            setMessage('');
          }}
        >
          {mode === 'signIn'
            ? 'Need an account? Sign up'
            : 'Already have an account? Sign in'}
        </button>
      </form>
    </section>
  );
}
