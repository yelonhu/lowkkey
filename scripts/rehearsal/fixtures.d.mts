import type { z } from 'zod';
import type { PlanInput, SessionInput, WeightInput, CurationInput } from '@lowkkey/protocol';
export const fixturePlans: z.input<typeof PlanInput>[];
export const fixtureSessions: z.input<typeof SessionInput>[];
export const fixtureWeights: z.input<typeof WeightInput>[];
export function seedShowroom(tool: (name: string, args: unknown) => Promise<unknown>): Promise<void>;

export const fixtureToday: string;
export const fixtureWeek: string;
export const fixtureCuration: z.input<typeof CurationInput>;
