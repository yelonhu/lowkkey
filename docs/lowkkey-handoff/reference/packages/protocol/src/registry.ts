import { z } from 'zod';
import * as A from './api.ts';
import * as E from './entities.ts';
import { Source } from './primitives.ts';

/**
 * 给主要实体登记稳定 id。生成 JSON Schema / OpenAPI 时，它们会被提取为可复用的定义，
 * 其他语言（如 Python 后端）可以据此生成类型。
 */
const named: Record<string, z.ZodType> = {
  Source,
  Exercise: E.Exercise,
  Program: E.Program,
  Entry: E.Entry,
  EntryDraft: E.EntryDraft,
  Held: E.Held,
  Proposal: E.Proposal,
  Trigger: E.Trigger,
  Derived: E.Derived,
  Snapshot: E.Snapshot,
  StateResponse: A.StateResponse,
  WriteResult: A.WriteResult,
  ServerEvent: A.ServerEvent,
  ApiError: A.ApiError,
};

for (const [id, schema] of Object.entries(named)) {
  if (!z.globalRegistry.has(schema)) z.globalRegistry.add(schema, { id });
}

export const NAMED_SCHEMAS = named;
