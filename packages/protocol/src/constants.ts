// Plain values shared by every runtime. This module must stay free of zod so the
// browser bundle can import it without pulling in schema validation.
export const PROTOCOL_VERSION = '6.0.0';
export const LB_PER_KG = 2.20462;
export const NOTE_LIMIT = 20_000;
export const PRIVACY_VERSION = '2026-10-13-notes-write';
/** The cards the AI may arrange on the board, in any order. */
export const BOARD_CARDS = ['next', 'week', 'body', 'letter', 'medal'] as const;
export type BoardCard = (typeof BOARD_CARDS)[number];
