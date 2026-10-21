import { customerAuth, type AuthBindings } from '../src/server/customer-auth.ts';

let attempt = 0;

// Only Google's network exchange is simulated. State, cookies, callback handling,
// identity association and signed sessions all run through the real auth stack.
export async function googleAttempt(
  env: AuthBindings,
  email: string,
  options: {
    verified?: boolean;
    subject?: string;
    cancel?: boolean;
    invalidState?: boolean;
    invalidCode?: boolean;
  } = {},
) {
  const ip = `192.0.2.${++attempt}`;
  const auth = customerAuth({
    ...env,
    GOOGLE_CLIENT_ID: 'isolated-test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'isolated-test',
  });
  const context = await auth.$context;
  const providers = context.socialProviders;
  if (!Array.isArray(providers)) throw new Error('Unexpected provider configuration');
  const provider = providers.find(p => p.id === 'google');
  if (!provider) throw new Error('Missing Google provider');
  provider.validateAuthorizationCode = async () => {
    if (options.invalidCode) throw new Error('Rejected test code');
    return { accessToken: 'test-only-token', scopes: ['openid', 'email', 'profile'] };
  };
  provider.getUserInfo = async () => ({
    user: { email, emailVerified: options.verified ?? true, name: 'Test user' },
    data: { sub: options.subject ?? email, email, email_verified: options.verified ?? true, name: 'Test user' },
  });
  const origin = env.APP_ORIGIN!;
  const start = await auth.handler(
    new Request(origin + '/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: origin + '/#next',
        errorCallbackURL: origin + '/?authError=1',
      }),
    }),
  );
  if (!start.ok) throw new Error('Google start failed: ' + start.status);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const callback = new URL(origin + '/api/auth/callback/google');
  callback.searchParams.set('state', options.invalidState ? 'wrong-state' : state);
  callback.searchParams.set(options.cancel ? 'error' : 'code', options.cancel ? 'access_denied' : 'test-code');
  const cookie = start.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
  const response = await auth.handler(new Request(callback, { headers: { Cookie: cookie, 'cf-connecting-ip': ip } }));
  return {
    response,
    auth,
    cookie: response.headers
      .getSetCookie()
      .map(c => c.split(';')[0])
      .join('; '),
    callback,
    cookieBefore: cookie,
  };
}
export async function googleLogin(env: AuthBindings, email: string) {
  const result = await googleAttempt(env, email);
  if (!result.response.headers.get('Location')?.endsWith('/#next') || !result.cookie.includes('session_token'))
    throw new Error('Google callback failed: ' + result.response.headers.get('Location'));
  return result.cookie;
}
