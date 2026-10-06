import { createCorsOptions } from './cors.config';

describe('CORS allowlist', () => {
  const isAllowed = (origin: string | undefined, environment: NodeJS.ProcessEnv = { NODE_ENV: 'production' }) => {
    let allowed: unknown;
    const callback = createCorsOptions(environment).origin;
    if (typeof callback !== 'function') throw new Error('Expected origin callback');
    callback(origin, (_error, result) => { allowed = result; });
    return allowed;
  };

  it('allows the production frontend and server-to-server requests', () => {
    expect(isAllowed('https://olten.vercel.app')).toBe(true);
    expect(isAllowed(undefined)).toBe(true);
  });
  it('rejects unrelated sites, lookalike hostnames and unconfigured preview sites', () => {
    for (const origin of ['https://evil.example', 'https://olten.vercel.app.evil.example', 'https://olten-preview.vercel.app', 'null', 'http://localhost:5173']) {
      expect(isAllowed(origin)).toBe(false);
    }
  });
  it('allows exact configured preview origins and local development', () => {
    expect(isAllowed('https://olten-preview.vercel.app', { NODE_ENV: 'production', CORS_ORIGINS: 'https://olten-preview.vercel.app' })).toBe(true);
    expect(isAllowed('http://localhost:5173', { NODE_ENV: 'development' })).toBe(true);
  });
  it.each(['*', 'http://public.example', 'http://127.evil.example', 'https://site.example/path', 'https://user:password@site.example', 'https://site.example/?query=1'])('rejects unsafe configured origins', origin => {
    expect(() => createCorsOptions({ NODE_ENV: 'production', CORS_ORIGINS: origin })).toThrow();
  });
  it('uses bearer headers without permitting wildcard credentialed requests', () => {
    const options = createCorsOptions({ NODE_ENV: 'production' });
    expect(options.credentials).toBe(false);
    expect(options.allowedHeaders).toContain('Authorization');
    expect(options.maxAge).toBe(600);
  });

  it('permits authenticated progressive PDF requests and exposes their byte-range headers', () => {
    const options = createCorsOptions({ NODE_ENV: 'production' });
    expect(options.allowedHeaders).toEqual(expect.arrayContaining(['Authorization', 'x-company', 'Range', 'If-Range']));
    expect(options.exposedHeaders).toEqual(expect.arrayContaining(['Accept-Ranges', 'Content-Range', 'Content-Length', 'Content-Encoding', 'ETag']));
    expect(options.credentials).toBe(false);
    expect(isAllowed('https://evil.example')).toBe(false);
  });
});
