import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App.tsx';
import { makeI18n } from '../i18n/index.ts';
import { detectLocale } from '../i18n/locale.ts';
import './style.css';
const element = document.getElementById('root');
if (!element) throw new Error('Application root is missing');
createRoot(element).render(<I18nextProvider i18n={makeI18n(detectLocale(navigator.languages))}><App /></I18nextProvider>);
