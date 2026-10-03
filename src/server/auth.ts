import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

const remoteKeys=new Map<string,JWTVerifyGetKey>();
export type Identity = { issuer: string; subject: string; email: string };
export type IdentityVerifier = (request: Request) => Promise<Identity>;
export const subjectKey = (identity: Identity): string => JSON.stringify([identity.issuer, identity.subject]);
export function accessVerifier(config: { teamDomain: string; audience: string }, resolver?: JWTVerifyGetKey): IdentityVerifier {
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.teamDomain) || !config.audience) throw new Error('INVALID_ACCESS_CONFIG');
  const issuer = `https://${config.teamDomain}`;
  let keys=resolver??remoteKeys.get(issuer);
  if(!keys){keys=createRemoteJWKSet(new URL('/cdn-cgi/access/certs',issuer));remoteKeys.set(issuer,keys);}
  return async request => {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) throw new Error('AUTH_REQUIRED');
    const { payload } = await jwtVerify(token, keys, { issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['sub','email','exp','iat'] });
    if (!payload.sub || typeof payload.email !== 'string') throw new Error('AUTH_REQUIRED');
    return { issuer, subject: payload.sub, email: payload.email.trim().toLowerCase() };
  };
}
