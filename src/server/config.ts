import { z } from 'zod';
import { localeSchema } from '../domain/primitives.ts';

export const publicConfigSchema = z.strictObject({
  APP_ENV: z.enum(['development', 'test']), APP_ORIGIN: z.url().refine(value => {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  }), DEFAULT_LOCALE: localeSchema,
});
export const localConfigSchema = publicConfigSchema.extend({ AI_MODE: z.literal('mock'), EMAIL_MODE: z.literal('preview') });
export const publicKeys = ['APP_ENV', 'APP_ORIGIN', 'DEFAULT_LOCALE'] as const;
export type LocalConfig = z.infer<typeof localConfigSchema>;
export function parseLocalConfig(input: Record<string, string | undefined>): LocalConfig {
  const result = localConfigSchema.safeParse({ APP_ENV: input.APP_ENV || 'development', APP_ORIGIN: input.APP_ORIGIN || 'http://127.0.0.1:5173', DEFAULT_LOCALE: input.DEFAULT_LOCALE || 'en', AI_MODE: input.AI_MODE || 'mock', EMAIL_MODE: input.EMAIL_MODE || 'preview' });
  if (!result.success) throw new Error('M0_LOCAL_CONFIGURATION_REJECTED');
  return result.data;
}
export function publicConfig(config: LocalConfig) {
  return publicConfigSchema.parse(Object.fromEntries(publicKeys.map(key => [key, config[key]])));
}
