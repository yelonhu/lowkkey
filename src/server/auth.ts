import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { localeSchema, timezoneSchema, uuidSchema } from '../domain/primitives.ts';
import type { MiddlewareHandler } from 'hono';

export type VerifiedIdentity = { issuer: string; subject: string; email: string; session?: { hash: string; expiresAt: string } };
export type IdentityVerifier = (request: Request) => Promise<VerifiedIdentity>;
export const memberSchema = z.strictObject({ id: uuidSchema, verifiedSubject: z.string(), emailNormalized: z.email(), role: z.enum(['admin', 'member']), status: z.enum(['invited', 'active', 'suspended', 'deletion_pending', 'deleted']), locale: localeSchema, timezone: timezoneSchema });
export type Member = z.infer<typeof memberSchema>;
export type AuthContext = Readonly<Pick<Member, 'id' | 'role' | 'locale' | 'timezone'> & { status: 'active' }>;
export type AuthEnvironment<Bindings extends object = object> = { Bindings: Bindings; Variables: { auth: AuthContext } };
export type MemberLookup = (verifiedSubject: string) => Promise<Member | null>;
export const subjectKey = (identity: Pick<VerifiedIdentity, 'issuer' | 'subject'>) => JSON.stringify([identity.issuer, identity.subject]);
export const normalizeEmail = (email: string) => z.email().parse(email.trim().toLowerCase());
export function accessVerifier(config: { teamDomain: string; audience: string }, resolver?: JWTVerifyGetKey, now?: () => Date): IdentityVerifier {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.teamDomain) || !config.audience.trim()) throw new Error('INVALID_ACCESS_CONFIG');
  const issuer = `https://${config.teamDomain}`;
  const keys = resolver ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
  return async request => {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) throw new Error('AUTH_REQUIRED');
    const { payload } = await jwtVerify(token, keys, { issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['sub', 'email', 'exp', 'iat'], currentDate: now?.() });
    if (!payload.sub || typeof payload.email !== 'string') throw new Error('AUTH_REQUIRED');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return { issuer, subject: payload.sub, email: normalizeEmail(payload.email), session: {
      hash: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), expiresAt: new Date(payload.exp! * 1000).toISOString(),
    } };
  };
}
export function authentication<Bindings extends object = object>(verifier: IdentityVerifier, lookup: MemberLookup): MiddlewareHandler<AuthEnvironment<Bindings>> {
  return async (context, next) => {
    let identity: VerifiedIdentity;
    try { identity = await verifier(context.req.raw); } catch { return context.json({ error: { code: 'AUTH_REQUIRED', messageKey: 'errors.authRequired', retryable: false }, meta: { requestId: crypto.randomUUID() } }, 401); }
    const row = await lookup(subjectKey(identity));
    const parsed = memberSchema.safeParse(row);
    if (!parsed.success || parsed.data.verifiedSubject !== subjectKey(identity) || parsed.data.emailNormalized !== identity.email) return context.json({ error: { code: 'AUTH_REQUIRED', messageKey: 'errors.authRequired', retryable: false }, meta: { requestId: crypto.randomUUID() } }, 401);
    if (parsed.data.status !== 'active') return context.json({ error: { code: 'MEMBER_SUSPENDED', messageKey: 'errors.memberSuspended', retryable: false }, meta: { requestId: crypto.randomUUID() } }, 403);
    const { id, role, locale, timezone } = parsed.data;
    context.set('auth', Object.freeze({ id, role, locale, timezone, status: 'active' }));
    await next();
  };
}
