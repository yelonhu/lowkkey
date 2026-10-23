import { LoginGate } from './account/CustomerAccount.tsx';
import { PrivacyPage } from './account/Privacy.tsx';
import { ServicePage } from './account/ServicePages.tsx';
import { Showroom } from './shell/Showroom.tsx';
import { lazy, Suspense } from 'react';

// The styleguide is a development page; production builds leave it out entirely.
const Styleguide = import.meta.env.DEV ? lazy(() => import('./styleguide/Styleguide.tsx')) : null;

// Public pages answer by path; everything signed-in lives in the showroom shell.
export function App() {
  if (location.pathname === '/privacy') return <PrivacyPage />;
  if (location.pathname === '/support' || location.pathname === '/terms')
    return <ServicePage kind={location.pathname === '/support' ? 'support' : 'terms'} />;
  if (import.meta.env.DEV && location.pathname === '/__preview/login') return <LoginGate preview />;
  if (import.meta.env.DEV && Styleguide && location.pathname === '/__preview/styleguide')
    return (
      <Suspense fallback={null}>
        <Styleguide />
      </Suspense>
    );
  return <Showroom />;
}
