import '@/popup/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MetricsDashboard } from '@/admin/MetricsDashboard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MetricsDashboard />
  </StrictMode>,
);
