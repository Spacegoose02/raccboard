import { useEffect, useState } from 'react';
import { api } from './api.js';

// Whether the server has AI helpers turned on; asked once per app load.
let status;
export function useAiEnabled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    status ??= api.get('/ai/status').then((s) => !!s.enabled).catch(() => false);
    status.then(setOn);
  }, []);
  return on;
}
