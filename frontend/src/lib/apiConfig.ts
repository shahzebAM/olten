const PRODUCTION_API_URL = 'https://olten-production.up.railway.app';

export function resolveApiConfig(configuredUrl: string | undefined, development: boolean) {
  const fallback = development ? 'http://localhost:3000' : PRODUCTION_API_URL;
  if (!configuredUrl?.trim()) return { baseUrl: fallback, error: '' };
  try {
    const parsed = new URL(configuredUrl.trim());
    const localHost = parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(parsed.hostname);
    if (parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.protocol !== 'https:' && !(development && localHost && parsed.protocol === 'http:'))
      || (!development && localHost)) throw new Error('Invalid API URL');
    return { baseUrl: parsed.toString().replace(/\/+$/, ''), error: '' };
  } catch {
    return { baseUrl: fallback, error: 'The configured backend URL is invalid. Check VITE_API_BASE_URL; using the default backend.' };
  }
}
