// Run interactively from client_web; passwords and tokens stay in process memory.
import { Amplify } from 'aws-amplify';
import { signIn, fetchAuthSession, signOut } from 'aws-amplify/auth';
import { randomUUID } from 'node:crypto';

process.loadEnvFile('.env');
Amplify.configure({ Auth: { Cognito: {
  userPoolId: process.env.VITE_COGNITO_USER_POOL_ID,
  userPoolClientId: process.env.VITE_COGNITO_CLIENT_ID,
  loginWith: { email: true },
} } });

async function password() {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
  process.stdout.write('Admin password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const input = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    function cleanup() { process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); }
    process.stdin.on('data', input);
  });
}

async function main() {
  const result = await signIn({ username: 'balarakeshg16@gmail.com', password: await password() });
  if (!result.isSignedIn) throw new Error(`Additional Cognito sign-in step required: ${result.nextStep.signInStep}`);
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Cognito did not issue an ID token.');
  const base = process.env.VITE_API_URL;
  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(`API ${response.status}: ${typeof body.message === 'string' ? body.message : 'request failed'}`);
    return body;
  }
  try {
    const me = await api('/me');
    if (me.role !== 'admin') throw new Error('The account is not an administrator.');
    const users = await api(`/admin/users?${new URLSearchParams({search:'balarakeshg@gmail.com',page:'1',limit:'100'})}`);
    const user = users.items.find((item) => item.email.toLowerCase() === 'balarakeshg@gmail.com');
    if (!user) throw new Error('The normal user is not registered in the application.');
    const target = { type: 'users', userIds: [user.id] };
    const preview = await api('/admin/notifications/preview', { method: 'POST', body: JSON.stringify({ target }) });
    if (!preview.totalDevices) throw new Error('The normal user has no active registered devices.');
    const created = await api('/admin/notifications', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ title: 'Notification test', body: 'This is a real push notification test.', clickAction: '/', target }) });
    console.log(`Notification ${created.id} queued for ${created.totalDevices} device(s).`);
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const detail = await api(`/admin/notifications/${encodeURIComponent(created.id)}`);
      if (detail.deliveries.every((delivery) => delivery.status !== 'pending')) {
        for (const delivery of detail.deliveries) console.log(`${delivery.platform}: ${delivery.status}${delivery.errorCode ? ` (${delivery.errorCode})` : ''}`);
        if (detail.deliveries.some((delivery) => delivery.status !== 'sent')) process.exitCode = 1;
        return;
      }
    }
    console.log('Delivery is still pending. Check notification history in the admin dashboard.');
    process.exitCode = 1;
  } finally { await signOut().catch(() => undefined); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Unable to send notification.'); process.exitCode = 1; });
