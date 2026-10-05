// Document citations may come from AI output. Only use verified Google viewer
// links; never pass executable URLs or credentials to an anchor or popup.
export function safeDocumentLink(value?: string): { href: string; driveFileId?: string } | null {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname)
      || url.username || url.password || url.port) return null;
    const pathId = url.pathname.match(/\/d\/([^/]+)/)?.[1];
    const candidate = pathId ? decodeURIComponent(pathId) : url.searchParams.get('id');
    const driveFileId = candidate && /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : undefined;
    return { href: url.href, driveFileId };
  } catch { return null; }
}
