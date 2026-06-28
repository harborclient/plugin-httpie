import { describe, expect, it } from 'vitest';
import type { RequestTabContext } from '@harborclient/sdk';
import { buildHttpieCommand } from './buildHttpie';

/**
 * Returns a minimal request tab context for HTTPie builder tests.
 *
 * @param overrides - Partial context overrides.
 */
function sampleContext(overrides: Partial<RequestTabContext> = {}): RequestTabContext {
  const base: RequestTabContext = {
    readOnly: true,
    response: null,
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

describe('buildHttpieCommand', () => {
  it('builds GET with merged query params', () => {
    const command = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'GET',
          url: 'https://example.com/search',
          params: [{ key: 'q', value: 'hello world', enabled: true }],
          headers: [],
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

    expect(command).toContain("'https://example.com/search?q=hello+world'");
    expect(command).not.toContain('GET');
  });

  it('builds POST with JSON body and auto Content-Type', () => {
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

    expect(command).toContain('POST');
    expect(command).toContain("'Content-Type: application/json'");
    expect(command).toContain('--raw \'{"ok":true}\'');
  });

  it('adds Bearer auth from the request Auth tab', () => {
    const command = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'GET',
          url: 'https://example.com',
          params: [],
          headers: [],
          body: '',
          body_type: 'none',
          auth: {
            type: 'bearer',
            basic: { username: '', password: '' },
            bearer: { token: 'abc123' }
          }
        }
      })
    );

    expect(command).toContain("'Authorization: Bearer abc123'");
  });

  it('inherits Basic auth from collection when request auth is none', () => {
    const command = buildHttpieCommand(
      sampleContext({
        collectionAuth: {
          type: 'basic',
          basic: { username: 'alice', password: 'secret' },
          bearer: { token: '' }
        },
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
      })
    );

    expect(command).toContain("'Authorization: Basic ");
    expect(command).toContain(globalThis.btoa('alice:secret'));
  });

  it('prefers a manual Authorization header over Auth tab credentials', () => {
    const command = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'GET',
          url: 'https://example.com',
          params: [],
          headers: [{ key: 'Authorization', value: 'Bearer manual', enabled: true }],
          body: '',
          body_type: 'none',
          auth: {
            type: 'bearer',
            basic: { username: '', password: '' },
            bearer: { token: 'ignored' }
          }
        }
      })
    );

    expect(command).toContain("'Authorization: Bearer manual'");
    expect(command).not.toContain('ignored');
  });

  it('emits urlencoded and multipart body fields', () => {
    const urlencoded = buildHttpieCommand(
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

    expect(urlencoded).toContain('-f POST');
    expect(urlencoded).toContain('name=Ada');

    const multipart = buildHttpieCommand(
      sampleContext({
        draft: {
          method: 'POST',
          url: 'https://example.com',
          params: [],
          headers: [],
          body: JSON.stringify([
            {
              key: 'note',
              value: 'hi',
              enabled: true,
              type: 'text',
              files: []
            },
            {
              key: 'file',
              value: '',
              enabled: true,
              type: 'file',
              files: ['/tmp/upload.bin']
            }
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

    expect(multipart).toContain('--multipart POST');
    expect(multipart).toContain('note=hi');
    expect(multipart).toContain('file@/tmp/upload.bin');
    expect(multipart).not.toContain('Content-Type');
  });

  it('substitutes collection and environment variables in url, auth, and body', () => {
    const command = buildHttpieCommand(
      sampleContext({
        variables: {
          baseUrl: 'https://api.example.com',
          apiBase: '/v1',
          idToken: 'token-abc',
          apiKey: 'key-123',
          apiSecret: 'secret-456'
        },
        draft: {
          method: 'POST',
          url: '{{baseUrl}}{{apiBase}}/auth/apiGrant',
          params: [],
          headers: [],
          body: '{\n  "key": "{{apiKey}}",\n  "secret": "{{apiSecret}}"\n}',
          body_type: 'json',
          auth: {
            type: 'bearer',
            basic: { username: '', password: '' },
            bearer: { token: '{{idToken}}' }
          }
        }
      })
    );

    expect(command).toContain("'https://api.example.com/v1/auth/apiGrant'");
    expect(command).toContain("'Authorization: Bearer token-abc'");
    expect(command).toContain('"key": "key-123"');
    expect(command).toContain('"secret": "secret-456"');
    expect(command).not.toContain('{{');
  });

  it('leaves unknown variable placeholders literal', () => {
    const command = buildHttpieCommand(
      sampleContext({
        variables: { known: 'resolved' },
        draft: {
          method: 'GET',
          url: 'https://example.com/{{known}}/{{missing}}',
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
      })
    );

    expect(command).toContain("'https://example.com/resolved/{{missing}}'");
  });
});
