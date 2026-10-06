import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export function createCorsOptions(environment: NodeJS.ProcessEnv = process.env): CorsOptions {
  const origins = new Set<string>(['https://olten.vercel.app']);
  if (environment.NODE_ENV !== 'production') {
    ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'].forEach(origin => origins.add(origin));
  }
  const configuredOrigins = [environment.CORS_ORIGINS, environment.FRONTEND_URL].filter(Boolean).join(',');
  for (const rawOrigin of configuredOrigins.split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(rawOrigin);
    const localHost = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:'))) {
      throw new Error('CORS_ORIGINS must contain exact HTTPS origins, or localhost development origins.');
    }
    origins.add(url.origin);
  }
  return {
    origin: (origin, callback) => callback(null, !origin || origins.has(origin)),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-company', 'x-username', 'Cache-Control', 'Range', 'If-Range'],
    exposedHeaders: ['Accept-Ranges', 'Content-Range', 'Content-Length', 'Content-Disposition', 'Content-Encoding', 'ETag'],
    credentials: false,
    maxAge: 600,
  };
}
