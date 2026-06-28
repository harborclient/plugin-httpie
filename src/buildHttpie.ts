import type { RequestDraft, RequestTabContext } from '@harborclient/sdk';
import { resolveRequest } from '@harborclient/sdk/http';

type KeyValue = { key: string; value: string; enabled: boolean };

type FormDataPart = {
  key: string;
  value: string;
  enabled: boolean;
  type: 'text' | 'file';
  files: string[];
};

/**
 * Wraps a shell argument in single quotes with embedded quote escaping.
 *
 * @param value - Raw argument value.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Parses a serialized urlencoded body string into key-value rows.
 *
 * @param body - JSON array stored in the request body field.
 */
function parseUrlEncodedParts(body: string): KeyValue[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => {
      const record = row as Partial<KeyValue>;
      return {
        key: typeof record.key === 'string' ? record.key : '',
        value: typeof record.value === 'string' ? record.value : '',
        enabled: record.enabled !== false
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parses a serialized multipart body string into form parts.
 *
 * @param body - JSON array stored in the request body field.
 */
function parseFormParts(body: string): FormDataPart[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((part) => {
      const record = part as Partial<FormDataPart>;
      return {
        key: typeof record.key === 'string' ? record.key : '',
        value: typeof record.value === 'string' ? record.value : '',
        enabled: record.enabled !== false,
        type: record.type === 'file' ? 'file' : 'text',
        files: Array.isArray(record.files)
          ? record.files.filter((file): file is string => typeof file === 'string')
          : []
      };
    });
  } catch {
    return [];
  }
}

/**
 * Returns whether the draft should include a request body in the HTTPie command.
 *
 * @param draft - Active request draft.
 */
function shouldIncludeBody(draft: RequestDraft): boolean {
  if (draft.method === 'GET' || draft.method === 'HEAD') {
    return false;
  }
  if (draft.body_type === 'none' || !draft.body.trim()) {
    return false;
  }
  return true;
}

/**
 * Formats a urlencoded field for HTTPie `-f` mode.
 *
 * @param key - Field name.
 * @param value - Field value.
 */
function formatFormField(key: string, value: string): string {
  if (/[\s'"\\]/.test(value)) {
    return `${key}=${shellQuote(value)}`;
  }
  return `${key}=${value}`;
}

/**
 * Appends urlencoded body fields for HTTPie form mode.
 *
 * @param body - Serialized urlencoded rows JSON.
 * @param parts - Accumulated command tokens.
 */
function appendUrlEncodedBody(body: string, parts: string[]): void {
  const rows = parseUrlEncodedParts(body).filter((row) => row.enabled && row.key.trim());
  for (const row of rows) {
    parts.push(formatFormField(row.key.trim(), row.value));
  }
}

/**
 * Appends multipart body fields for HTTPie `--multipart` mode.
 *
 * @param body - Serialized multipart parts JSON.
 * @param parts - Accumulated command tokens.
 */
function appendMultipartBody(body: string, parts: string[]): void {
  const formParts = parseFormParts(body).filter((part) => part.enabled && part.key.trim());
  for (const part of formParts) {
    const key = part.key.trim();
    if (part.type === 'file') {
      for (const filePath of part.files) {
        parts.push(`${key}@${filePath}`);
      }
      continue;
    }
    parts.push(formatFormField(key, part.value));
  }
}

/**
 * Appends body-related HTTPie tokens based on body type.
 *
 * @param draft - Active request draft with substituted body content.
 * @param parts - Accumulated command tokens.
 */
function appendBodyTokens(draft: RequestDraft, parts: string[]): void {
  if (!shouldIncludeBody(draft)) {
    return;
  }

  if (draft.body_type === 'urlencoded') {
    appendUrlEncodedBody(draft.body, parts);
    return;
  }

  if (draft.body_type === 'multipart') {
    appendMultipartBody(draft.body, parts);
    return;
  }

  parts.push('--raw', shellQuote(draft.body));
}

/**
 * Builds an equivalent HTTPie command for the active request tab context.
 *
 * @param context - Read-only request tab context from HarborClient.
 */
export function buildHttpieCommand(context: RequestTabContext): string {
  const resolved = resolveRequest(context);
  const draftForBody: RequestDraft = {
    ...context.draft,
    body: resolved.body,
    method: resolved.method
  };
  const parts: string[] = ['http'];

  if (shouldIncludeBody(draftForBody)) {
    if (draftForBody.body_type === 'urlencoded') {
      parts.push('-f');
    } else if (draftForBody.body_type === 'multipart') {
      parts.push('--multipart');
    }
  }

  if (resolved.method.toUpperCase() !== 'GET') {
    parts.push(resolved.method.toUpperCase());
  }

  parts.push(shellQuote(resolved.url));

  for (const [key, value] of Object.entries(resolved.headers)) {
    if (draftForBody.body_type === 'multipart' && key.toLowerCase() === 'content-type') {
      continue;
    }
    parts.push(shellQuote(`${key}: ${value}`));
  }

  appendBodyTokens(draftForBody, parts);

  return parts.join(' ');
}
