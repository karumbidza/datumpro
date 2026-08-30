'use client';

import { useEffect, useState } from 'react';

const OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
};

/** Render a stored (UTC) ISO instant in the VIEWER's local timezone, with the TZ
 *  label — so "10:00 AM" always means 10:00 the reader's time, not the server's.
 *  Formats after mount (server renders a neutral placeholder) to avoid a
 *  server(UTC)/client(local) hydration mismatch. */
export function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, OPTS));
  }, [iso]);
  return <span suppressHydrationWarning>{text || '…'}</span>;
}
