import type { ErrorCode } from '../domain/contracts.ts';

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 503, public readonly params: Record<string, string | number | boolean | null> = {}) {
    super(code);
    this.name = 'DomainError';
  }
}
