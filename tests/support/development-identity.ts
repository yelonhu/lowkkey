import type { IdentityVerifier, VerifiedIdentity } from '../../src/server/auth.ts';
export function developmentIdentity(environment: string, identity: VerifiedIdentity): IdentityVerifier {
  if (!['development', 'test'].includes(environment)) throw new Error('DEVELOPMENT_IDENTITY_FORBIDDEN');
  return async () => ({ ...identity });
}
