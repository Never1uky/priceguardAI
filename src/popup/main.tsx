import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { agentLog, flushAgentLogs } from '@/lib/debug-log';
import { App } from './App';
import './index.css';

agentLog('popup/main.tsx:boot', 'popup bundle loaded', {
  version: chrome.runtime.getManifest().version,
}, 'A');
void flushAgentLogs();
void chrome.runtime.sendMessage({ type: 'DUMP_AGENT_LOGS' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
