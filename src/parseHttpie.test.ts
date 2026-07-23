import { describe, expect, it } from 'vitest';
import type { RequestTabContext } from '@harborclient/sdk';
import { buildHttpieCommand } from './buildHttpie';
import { HttpieParseError, parseHttpie } from './parseHttpie';

/**
 * Returns a minimal request tab context for HTTPie round-trip tests.
 *
 * @param overrides - Partial context overrides.
 */
function sampleContext(overrides: Partial<RequestTabContext> = {}): RequestTabContext {
  const base: RequestTabContext = {
    readOnly: true,
    response: null,
    requestKey: 'GET https://example.com',
    collectionAuth: {
      type: 'none',
      basic: { username: '', password: '' },
      bearer: { token: '' }
    },
    collectionHeaders: [],
    variables: {},
    draft: {
      method: 'GET',
      url: 'https://example.com',
      params: [],
      headers: [],
      body: '',
      body_type: 'none',
      auth: {
        type: 'none',
        basic: { username: '', password: '' },
        bearer: { token: '' }
      }
    }
  };

  return {
    ...base,
    ...overrides,
    draft: { ...base.draft, ...overrides.draft },
    collectionAuth: overrides.collectionAuth ?? base.collectionAuth,
    collectionHeaders: overrides.collectionHeaders ?? base.collectionHeaders,
    variables: overrides.variables ?? base.variables
  };
}

describe('parseHttpie', () => {
  it('parses a simple GET with URL', () => {
    const parsed = parseHttpie("http 'https://example.com/search?q=hello'");
    expect(parsed.method).toBe('GET');
    expect(parsed.url).toBe('https://example.com/search?q=hello');
    expect(parsed.bodyType).toBe('none');
    expect(parsed.body).toBe('');
  });

  it('parses POST with method, headers, and JSON --raw body', () => {
    const command = [
      'http POST \\',
      "  'https://example.com/users' \\",
      "  'Content-Type: application/json' \\",
      "  'Authorization: Bearer token' \\",
      '  --raw \'{"ok":true}\''
    ].join('\n');

    const parsed = parseHttpie(command);
    expect(parsed.method).toBe('POST');
    expect(parsed.url).toBe('https://example.com/users');
    expect(parsed.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token'
    });
    expect(parsed.body).toBe('{"ok":true}');
    expect(parsed.bodyType).toBe('json');
  });

  it('parses query params from name==value items', () => {
    const parsed = parseHttpie("http 'https://example.com/search' q==hello");
    expect(parsed.params).toEqual([{ key: 'q', value: 'hello' }]);
    expect(parsed.url).toBe('https://example.com/search');
  });

  it('parses JSON field items with = and :=', () => {
    const parsed = parseHttpie("http POST 'https://example.com' name=Ada active:=true");
    expect(parsed.method).toBe('POST');
    expect(parsed.bodyType).toBe('json');
    expect(JSON.parse(parsed.body ?? '{}')).toEqual({ name: 'Ada', active: true });
  });

  it('parses urlencoded and multipart bodies', () => {
    const urlencoded = parseHttpie("http -f POST 'https://example.com' name=Ada role=admin");
    expect(urlencoded.bodyType).toBe('urlencoded');
    expect(JSON.parse(urlencoded.body ?? '[]')).toEqual([
      { key: 'name', value: 'Ada', enabled: true },
      { key: 'role', value: 'admin', enabled: true }
    ]);

    const multipart = parseHttpie(
      "http --multipart POST 'https://example.com' note=hi file@/tmp/upload.bin"
    );
    expect(multipart.bodyType).toBe('multipart');
    expect(JSON.parse(multipart.body ?? '[]')).toEqual([
      { key: 'note', value: 'hi', enabled: true, type: 'text', files: [] },
      { key: 'file', value: '', enabled: true, type: 'file', files: ['/tmp/upload.bin'] }
    ]);
  });

  it('maps -a credentials to a Basic Authorization header', () => {
    const parsed = parseHttpie("http -a 'alice:secret' 'https://example.com'");
    expect(parsed.headers?.Authorization).toBe(`Basic ${globalThis.btoa('alice:secret')}`);
  });

  it('defaults to POST when data items are present without a method', () => {
    const parsed = parseHttpie("http 'https://example.com' --raw 'hello'");
    expect(parsed.method).toBe('POST');
    expect(parsed.body).toBe('hello');
    expect(parsed.bodyType).toBe('text');
  });

  it('accepts https as the command binary', () => {
    const parsed = parseHttpie("https 'https://example.com'");
    expect(parsed.method).toBe('GET');
    expect(parsed.url).toBe('https://example.com');
  });

  it('unescapes embedded single quotes from shell quoting', () => {
    const parsed = parseHttpie("http POST 'https://example.com' --raw 'it'\\''s fine'");
    expect(parsed.body).toBe("it's fine");
  });

  it('rejects empty or non-httpie input', () => {
    expect(() => parseHttpie('')).toThrow(HttpieParseError);
    expect(() => parseHttpie('curl https://example.com')).toThrow(/must start with http/);
    expect(() => parseHttpie('http')).toThrow(/missing a URL/);
  });

  it('round-trips buildHttpieCommand output for GET with headers', () => {
    const command = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'GET',
          url: 'https://example.com/search',
          params: [{ key: 'q', value: 'hello world', enabled: true }],
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          body: '',
          body_type: 'none',
          auth: {
            type: 'none',
            basic: { username: '', password: '' },
            bearer: { token: '' }
          }
        }
      })
    );

    const parsed = parseHttpie(command);
    expect(parsed.method).toBe('GET');
    expect(parsed.url).toBe('https://example.com/search?q=hello+world');
    expect(parsed.headers?.Accept).toBe('application/json');
  });

  it('round-trips buildHttpieCommand output for POST JSON', () => {
    const command = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'POST',
          url: 'https://example.com',
          params: [],
          headers: [],
          body: '{"ok":true}',
          body_type: 'json',
          auth: {
            type: 'none',
            basic: { username: '', password: '' },
            bearer: { token: '' }
          }
        }
      })
    );

    const parsed = parseHttpie(command);
    expect(parsed.method).toBe('POST');
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.body).toBe('{"ok":true}');
    expect(parsed.bodyType).toBe('json');
    expect(parsed.headers?.['Content-Type']).toBe('application/json');
  });

  it('round-trips urlencoded and multipart bodies from buildHttpieCommand', () => {
    const urlencodedCommand = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'POST',
          url: 'https://example.com',
          params: [],
          headers: [],
          body: JSON.stringify([{ key: 'name', value: 'Ada', enabled: true }]),
          body_type: 'urlencoded',
          auth: {
            type: 'none',
            basic: { username: '', password: '' },
            bearer: { token: '' }
          }
        }
      })
    );

    const urlencoded = parseHttpie(urlencodedCommand);
    expect(urlencoded.bodyType).toBe('urlencoded');
    expect(JSON.parse(urlencoded.body ?? '[]')).toEqual([
      { key: 'name', value: 'Ada', enabled: true }
    ]);

    const multipartCommand = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'POST',
          url: 'https://example.com',
          params: [],
          headers: [],
          body: JSON.stringify([
            { key: 'note', value: 'hi', enabled: true, type: 'text', files: [] },
            { key: 'file', value: '', enabled: true, type: 'file', files: ['/tmp/upload.bin'] }
          ]),
          body_type: 'multipart',
          auth: {
            type: 'none',
            basic: { username: '', password: '' },
            bearer: { token: '' }
          }
        }
      })
    );

    const multipart = parseHttpie(multipartCommand);
    expect(multipart.bodyType).toBe('multipart');
    expect(JSON.parse(multipart.body ?? '[]')).toEqual([
      { key: 'note', value: 'hi', enabled: true, type: 'text', files: [] },
      { key: 'file', value: '', enabled: true, type: 'file', files: ['/tmp/upload.bin'] }
    ]);
  });
});
