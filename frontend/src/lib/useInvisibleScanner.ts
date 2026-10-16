import { useEffect, useRef } from 'react';

export function useInvisibleScanner(onScan: (sku: string, raw: string, event: KeyboardEvent) => boolean | void, enabled = true) {
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastKeyTime = 0;
    const listen = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const now = Date.now();
      if (now - lastKeyTime > 50) buffer = '';
      if (event.key === 'Enter') {
        const raw = buffer.trim();
        buffer = '';
        if (raw.length > 3) {
          const sku = raw.split('  ')[0].trim();
          if (handler.current(sku, raw, event) === true) event.preventDefault();
        }
      } else if (event.key.length === 1) {
        buffer += event.key;
      }
      lastKeyTime = now;
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [enabled]);
}
