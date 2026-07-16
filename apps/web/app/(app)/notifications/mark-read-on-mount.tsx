'use client';

import { useEffect, useRef } from 'react';
import { markAllNotificationsRead } from './actions';

/** Clears the unread badge when the feed is opened — fires the mark-read action
 *  once on mount. */
export function MarkReadOnMount() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markAllNotificationsRead();
  }, []);
  return null;
}
