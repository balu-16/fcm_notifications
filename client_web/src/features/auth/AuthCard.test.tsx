// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AuthCard } from './AuthCard';
import { confirmSignIn, fetchAuthSession, signIn, signOut, signUp } from 'aws-amplify/auth';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  fetchAuthSession: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('authentication card', () => {
  it('passes the selected admin role to the server-backed sign-in check', async () => {
    vi.mocked(signOut).mockResolvedValueOnce(undefined);
    vi.mocked(signIn).mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    vi.mocked(fetchAuthSession).mockResolvedValueOnce({ tokens: { idToken: { payload: { email: 'a@example.test' }, toString: () => 'id' }, accessToken: { payload: {}, toString: () => 'access' } } });
    const onSignedIn = vi.fn(async () => { throw new Error('ROLE_MISMATCH'); });
    render(<AuthCard onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'Example@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/does not have the admin role/));
    expect(onSignedIn).toHaveBeenCalledWith('admin');
    expect(signOut).toHaveBeenCalled();
  });
  it('allows an administrator with a temporary password to set a new one', async () => {
    vi.mocked(signIn).mockResolvedValueOnce({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } });
    vi.mocked(confirmSignIn).mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    vi.mocked(fetchAuthSession).mockResolvedValueOnce({ tokens: { idToken: { payload: { email: 'admin@example.test' }, toString: () => 'id-token' },
      accessToken: { payload: {}, toString: () => 'access-token' } } });
    const onSignedIn = vi.fn(async () => undefined);
    render(<AuthCard onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'Temporary@123' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword@123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'NewPassword@123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
    expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'NewPassword@123' });
  });

  it('explains when a signed-in user’s ID token omits the email claim', async () => {
    vi.mocked(signIn).mockResolvedValueOnce({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    vi.mocked(fetchAuthSession).mockResolvedValueOnce({ tokens: { idToken: { payload: {}, toString: () => 'id-token' },
      accessToken: { payload: {}, toString: () => 'access-token' } } });
    vi.mocked(signOut).mockResolvedValueOnce(undefined);
    render(<AuthCard onSignedIn={async () => { throw new Error('server rejected session'); }} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.test' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'Example@123' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/permission to read your email/));
    expect(signOut).toHaveBeenCalledOnce();
  });

  function fillSignUp(phone: string, confirmation: string) {
    fireEvent.click(
      screen.getByRole('button', { name: 'Need an account? Sign up' }),
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: phone },
    });
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
      target: { value: 'Example@123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: confirmation },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  }

  it('rejects mismatched passwords and invalid phone numbers before sign-up', () => {
    render(<AuthCard onSignedIn={async () => undefined} />);
    fillSignUp('9999988888', 'Different@123');
    expect(screen.getByRole('alert').textContent).toMatch(
      /Passwords do not match/,
    );
    expect(signUp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Example@123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByRole('alert').textContent).toMatch(/valid phone number/);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('sends a normalized phone to Cognito and displays its actual verification channel', async () => {
    vi.mocked(signUp).mockResolvedValueOnce({
      isSignUpComplete: false,
      nextStep: {
        signUpStep: 'CONFIRM_SIGN_UP',
        codeDeliveryDetails: {
          deliveryMedium: 'EMAIL',
          destination: 't***@example.test',
        },
      },
    });
    render(<AuthCard onSignedIn={async () => undefined} />);
    fillSignUp('9999988888', 'Example@123');
    await waitFor(() =>
      expect(screen.getByLabelText('Confirmation code')).toBeTruthy(),
    );
    expect(signUp).toHaveBeenCalledWith({
      username: 'test@example.test',
      password: 'Example@123',
      options: {
        userAttributes: {
          email: 'test@example.test',
          phone_number: '+919999988888',
        },
      },
    });
    expect(screen.getByRole('status').textContent).toMatch(
      /by email to t\*\*\*@example.test/,
    );
  });

  it('reports SMS when Cognito chooses SMS verification', async () => {
    vi.mocked(signUp).mockResolvedValueOnce({
      isSignUpComplete: false,
      nextStep: {
        signUpStep: 'CONFIRM_SIGN_UP',
        codeDeliveryDetails: { deliveryMedium: 'SMS', destination: '***8888' },
      },
    });
    render(<AuthCard onSignedIn={async () => undefined} />);
    fillSignUp('+91 99999 88888', 'Example@123');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/by SMS/),
    );
  });

  it('routes an unconfirmed Cognito user to the confirmation form', async () => {
    vi.mocked(signIn).mockRejectedValueOnce(
      Object.assign(new Error('not confirmed'), {
        name: 'UserNotConfirmedException',
      }),
    );
    render(<AuthCard onSignedIn={async () => undefined} />);
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Confirmation code')).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeTruthy();
  });
});
