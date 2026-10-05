const SESSION_KEY = 'olten_api_session';

type ApiSession = { accessToken: string; expiresAt: number };

export function setApiSession(accessToken: string, expiresAt: number) {
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    throw new Error('The server did not return a valid login session. Please try again.');
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken, expiresAt }));
}

export function clearApiSession() { sessionStorage.removeItem(SESSION_KEY); }

export function expireApiSession() {
  clearApiSession();
  window.dispatchEvent(new Event('olten-session-expired'));
}

export function getApiAuthHeaders(): Record<string, string> {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as ApiSession | null;
    if (!session || typeof session.accessToken !== 'string' || !Number.isFinite(session.expiresAt)
      || session.expiresAt * 1000 <= Date.now()) {
      clearApiSession();
      return {};
    }
    return { Authorization: `Bearer ${session.accessToken}` };
  } catch {
    clearApiSession();
    return {};
  }
}
