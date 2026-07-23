import type { ApplyRequestDraftPayload, BodyType } from '@harborclient/sdk';

type FormDataPart = {
  key: string;
  value: string;
  enabled: boolean;
  type: 'text' | 'file';
  files: string[];
};

type KeyValue = {
  key: string;
  value: string;
  enabled: boolean;
};

/**
 * Known HTTP methods accepted as a positional HTTPie argument.
 */
const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT'
]);

/**
 * Error thrown when an HTTPie command cannot be parsed into a request draft.
 */
export class HttpieParseError extends Error {
  /**
   * Creates a parse failure with a user-facing message.
   *
   * @param message - Human-readable parse error.
   */
  constructor(message: string) {
    super(message);
    this.name = 'HttpieParseError';
  }
}

/**
 * Joins backslash-continued lines into a single HTTPie command string.
 *
 * @param input - Raw editor text that may include `\` line continuations.
 * @returns Flattened command text with continuations removed.
 */
function joinContinuations(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .reduce((acc, line, index, lines) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return acc;
      }
      const continues = line.endsWith('\\');
      const segment = continues ? line.slice(0, -1).trimEnd() : trimmed;
      const separator = acc && !acc.endsWith(' ') ? ' ' : '';
      const next = `${acc}${separator}${segment}`;
      if (continues && index < lines.length - 1) {
        return next;
      }
      return next;
    }, '')
    .trim();
}

/**
 * Tokenizes a shell-like HTTPie command, respecting single and double quotes.
 *
 * @param command - Flattened HTTPie command without line continuations.
 * @returns Argument tokens in order.
 * @throws {HttpieParseError} When quotes are unbalanced.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let i = 0;

  while (i < command.length) {
    const char = command[i];

    if (quote === "'") {
      if (char === "'") {
        // Builder escapes embedded single quotes as: '\''
        if (command.slice(i, i + 4) === `'\\''`) {
          current += "'";
          i += 4;
          continue;
        }
        quote = null;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (char === '\\' && i + 1 < command.length) {
        current += command[i + 1];
        i += 2;
        continue;
      }
      if (char === '"') {
        quote = null;
        i += 1;
        continue;
      }
      current += char;
      i += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      i += 1;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  if (quote) {
    throw new HttpieParseError('Unbalanced quotes in HTTPie command.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Returns the next argument after a flag token, or throws when missing.
 *
 * @param tokens - Full token list.
 * @param index - Index of the flag token.
 * @param flag - Flag name for error messages.
 * @returns The following argument value and the index to continue from.
 */
function takeArg(
  tokens: string[],
  index: number,
  flag: string
): { value: string; nextIndex: number } {
  const value = tokens[index + 1];
  if (value === undefined) {
    throw new HttpieParseError(`Missing value for ${flag}.`);
  }
  return { value, nextIndex: index + 2 };
}

/**
 * Encodes Basic credentials into an Authorization header value.
 *
 * @param userpass - `user:password` from `-a` / `--auth`.
 * @returns `Basic …` header value.
 */
function basicAuthHeader(userpass: string): string {
  return `Basic ${globalThis.btoa(userpass)}`;
}

/**
 * Returns whether a token looks like an HTTPie request item rather than a URL or method.
 *
 * @param token - Positional argument candidate.
 */
function isRequestItem(token: string): boolean {
  if (token.includes('==') || token.includes(':=') || token.includes('@')) {
    return true;
  }
  // Header: "Name: value" (colon with optional space after). Avoid matching URLs with ://.
  if (token.includes('://')) {
    return false;
  }
  const colon = token.indexOf(':');
  if (colon > 0) {
    return true;
  }
  const eq = token.indexOf('=');
  if (eq > 0) {
    return true;
  }
  return false;
}

/**
 * Classifies and splits an HTTPie request item into its separator kind and parts.
 *
 * Precedence: `==`, `:=`, `@`, `=` (data), `:` (header).
 *
 * @param token - Request item token.
 * @returns Discriminated item, or null when the token is not a request item.
 */
function parseRequestItem(
  token: string
):
  | { kind: 'query'; key: string; value: string }
  | { kind: 'json'; key: string; value: string }
  | { kind: 'data'; key: string; value: string }
  | { kind: 'file'; key: string; path: string }
  | { kind: 'header'; key: string; value: string }
  | null {
  const eqEq = token.indexOf('==');
  if (eqEq > 0) {
    return {
      kind: 'query',
      key: token.slice(0, eqEq),
      value: token.slice(eqEq + 2)
    };
  }

  const colonEq = token.indexOf(':=');
  if (colonEq > 0) {
    return {
      kind: 'json',
      key: token.slice(0, colonEq),
      value: token.slice(colonEq + 2)
    };
  }

  const at = token.indexOf('@');
  if (at > 0 && !token.includes('://')) {
    // Prefer file upload over bare `=` when both appear; HTTPie uses `name@path`.
    const eq = token.indexOf('=');
    if (eq === -1 || at < eq) {
      return {
        kind: 'file',
        key: token.slice(0, at),
        path: token.slice(at + 1)
      };
    }
  }

  const eq = token.indexOf('=');
  if (eq > 0 && !token.includes('://')) {
    return {
      kind: 'data',
      key: token.slice(0, eq),
      value: token.slice(eq + 1)
    };
  }

  if (token.includes('://')) {
    return null;
  }

  const colon = token.indexOf(':');
  if (colon > 0) {
    return {
      kind: 'header',
      key: token.slice(0, colon).trim(),
      value: token.slice(colon + 1).trim()
    };
  }

  return null;
}

/**
 * Serializes urlencoded rows into the draft body JSON format HarborClient stores.
 *
 * @param rows - Parsed form field pairs.
 */
function serializeUrlEncoded(rows: KeyValue[]): string {
  return JSON.stringify(rows);
}

/**
 * Serializes multipart parts into the draft body JSON format HarborClient stores.
 *
 * @param parts - Parsed form parts.
 */
function serializeMultipart(parts: FormDataPart[]): string {
  return JSON.stringify(parts);
}

/**
 * Infers HarborClient body type from collected HTTPie body flags and content.
 *
 * @param options - Body parse state.
 * @returns Body type for {@link ApplyRequestDraftPayload}.
 */
function inferBodyType(options: {
  hasMultipart: boolean;
  hasForm: boolean;
  hasJsonFields: boolean;
  rawBody: string | null;
}): BodyType {
  if (options.hasMultipart) {
    return 'multipart';
  }
  if (options.hasForm) {
    return 'urlencoded';
  }
  if (options.hasJsonFields) {
    return 'json';
  }
  if (options.rawBody == null || !options.rawBody.trim()) {
    return 'none';
  }
  try {
    JSON.parse(options.rawBody);
    return 'json';
  } catch {
    return 'text';
  }
}

/**
 * Parses a JSON field value from an HTTPie `:=` item.
 *
 * @param raw - Raw value after `:=`.
 * @returns Parsed JSON value, or the string when parsing fails.
 */
function parseJsonFieldValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Parses an HTTPie command into an {@link ApplyRequestDraftPayload} for the active request.
 *
 * Supports the flags emitted by {@link buildHttpieCommand} plus common variants users paste
 * (`-a`, `--form`, `name==value` query items, `name:=value` JSON fields).
 *
 * @param input - HTTPie command text from the editor.
 * @returns Draft fields to apply via `hc.host.applyRequestDraft`.
 * @throws {HttpieParseError} When the command is empty, not http/https, or malformed.
 */
export function parseHttpie(input: string): ApplyRequestDraftPayload {
  const flattened = joinContinuations(input);
  if (!flattened) {
    throw new HttpieParseError('HTTPie command is empty.');
  }

  const tokens = tokenize(flattened);
  if (tokens.length === 0) {
    throw new HttpieParseError('HTTPie command is empty.');
  }

  const first = tokens[0]?.toLowerCase();
  if (first !== 'http' && first !== 'https') {
    throw new HttpieParseError('Command must start with http or https.');
  }

  let method: string | undefined;
  let url: string | undefined;
  const headers: Record<string, string> = {};
  const queryParams: KeyValue[] = [];
  const urlEncodedRows: KeyValue[] = [];
  const formParts: FormDataPart[] = [];
  const jsonFields: Record<string, unknown> = {};
  let hasJsonFields = false;
  let formMode = false;
  let multipartMode = false;
  let rawBody: string | null = null;
  let hasFileItems = false;
  let hasDataItems = false;

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token === '-f' || token === '--form') {
      formMode = true;
      i += 1;
      continue;
    }

    if (token === '--multipart') {
      multipartMode = true;
      i += 1;
      continue;
    }

    if (token === '-j' || token === '--json') {
      // Default JSON mode — no-op but accepted for pasted commands.
      i += 1;
      continue;
    }

    if (token === '--raw') {
      const { value, nextIndex } = takeArg(tokens, i, token);
      rawBody = value;
      hasDataItems = true;
      i = nextIndex;
      continue;
    }

    if (token === '-a' || token === '--auth') {
      const { value, nextIndex } = takeArg(tokens, i, token);
      headers.Authorization = basicAuthHeader(value);
      i = nextIndex;
      continue;
    }

    // Ignore flags with a single argument we do not map.
    if (
      token === '-A' ||
      token === '--auth-type' ||
      token === '--session' ||
      token === '--session-read-only' ||
      token === '--timeout' ||
      token === '--proxy' ||
      token === '-o' ||
      token === '--output' ||
      token === '-d' ||
      token === '--download' ||
      token === '--max-redirects' ||
      token === '--style' ||
      token === '-p' ||
      token === '--print' ||
      token === '--pretty' ||
      token === '-c' ||
      token === '--cert' ||
      token === '--cert-key' ||
      token === '--verify'
    ) {
      i += 2;
      continue;
    }

    // Ignore common no-arg flags users paste from HTTPie docs / history.
    if (
      token === '-v' ||
      token === '--verbose' ||
      token === '--all' ||
      token === '--follow' ||
      token === '--offline' ||
      token === '-b' ||
      token === '--body' ||
      token === '-h' ||
      token === '--headers' ||
      token === '-m' ||
      token === '--stream' ||
      token === '--ignore-stdin' ||
      token === '-I' ||
      token === '--ignore-netrc' ||
      token === '--chunked' ||
      token === '--compress' ||
      token === '--continue' ||
      token === '-S' ||
      token === '--check-status'
    ) {
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      const next = tokens[i + 1];
      if (next && !next.startsWith('-') && next !== url) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // Positional METHOD before URL.
    if (!url && !method && HTTP_METHODS.has(token.toUpperCase()) && token === token.toUpperCase()) {
      method = token.toUpperCase();
      i += 1;
      continue;
    }

    // URL: first non-request-item positional token.
    if (!url && !isRequestItem(token)) {
      url = token;
      i += 1;
      continue;
    }

    const item = parseRequestItem(token);
    if (!item) {
      if (!url) {
        url = token;
        i += 1;
        continue;
      }
      throw new HttpieParseError(`Unexpected argument: ${token}`);
    }

    if (item.kind === 'query') {
      if (item.key.trim()) {
        queryParams.push({ key: item.key.trim(), value: item.value, enabled: true });
      }
      i += 1;
      continue;
    }

    if (item.kind === 'header') {
      if (item.key) {
        headers[item.key] = item.value;
      }
      i += 1;
      continue;
    }

    if (item.kind === 'file') {
      hasFileItems = true;
      hasDataItems = true;
      if (item.key.trim()) {
        formParts.push({
          key: item.key.trim(),
          value: '',
          enabled: true,
          type: 'file',
          files: [item.path]
        });
      }
      i += 1;
      continue;
    }

    if (item.kind === 'json') {
      hasJsonFields = true;
      hasDataItems = true;
      if (item.key.trim()) {
        jsonFields[item.key.trim()] = parseJsonFieldValue(item.value);
      }
      i += 1;
      continue;
    }

    // kind === 'data'
    hasDataItems = true;
    if (item.key.trim()) {
      if (formMode || multipartMode) {
        // Keep both lists so a later `@file` can promote form fields into multipart.
        formParts.push({
          key: item.key.trim(),
          value: item.value,
          enabled: true,
          type: 'text',
          files: []
        });
        urlEncodedRows.push({ key: item.key.trim(), value: item.value, enabled: true });
      } else {
        hasJsonFields = true;
        jsonFields[item.key.trim()] = item.value;
      }
    }
    i += 1;
  }

  if (!url) {
    throw new HttpieParseError('HTTPie command is missing a URL.');
  }

  const hasMultipart = multipartMode || hasFileItems;
  const hasForm = formMode && !hasMultipart;

  let body = '';
  if (hasMultipart) {
    body = serializeMultipart(formParts);
  } else if (hasForm) {
    body = serializeUrlEncoded(urlEncodedRows);
  } else if (hasJsonFields) {
    body = JSON.stringify(jsonFields);
  } else if (rawBody != null) {
    body = rawBody;
  }

  const bodyType = inferBodyType({
    hasMultipart,
    hasForm,
    hasJsonFields,
    rawBody: hasMultipart || hasForm || hasJsonFields ? body : rawBody
  });

  if (!method) {
    method = hasDataItems || (rawBody != null && rawBody.length > 0) ? 'POST' : 'GET';
  }

  const payload: ApplyRequestDraftPayload = {
    method,
    url,
    headers,
    body,
    bodyType: bodyType === 'none' && !body ? 'none' : bodyType
  };

  if (queryParams.length > 0) {
    payload.params = queryParams.map((row) => ({ key: row.key, value: row.value }));
  }

  return payload;
}
