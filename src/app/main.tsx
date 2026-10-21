import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Instant open: a service worker keeps the shell, assets and fonts on the device. Facts always come live.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
