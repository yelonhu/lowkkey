import { z } from 'zod';
const emailInput = z.strictObject({ recipient: z.email(), subject: z.string().max(200), text: z.string().max(10000) });
export type EmailPreview = { mode: 'preview'; html: string; text: string; subject: string };
export function previewEmail(input: z.infer<typeof emailInput>): EmailPreview {
  const parsed = emailInput.parse(input);
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
  return { mode: 'preview', subject: parsed.subject, text: parsed.text, html: `<!doctype html><html><body><h1>${escape(parsed.subject)}</h1><p>${escape(parsed.text).replace(/\n/g, '<br>')}</p></body></html>` };
}
