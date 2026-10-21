import { LoginGate } from './account/CustomerAccount.tsx';
import { PrivacyPage } from './account/Privacy.tsx';
import { ServicePage } from './account/ServicePages.tsx';
import { Showroom } from './shell/Showroom.tsx';
import { Styleguide } from './styleguide/Styleguide.tsx';

// Public pages answer by path; everything signed-in lives in the showroom shell.
export function App() {
  if (location.pathname === '/privacy') return <PrivacyPage />;
  if (location.pathname === '/support' || location.pathname === '/terms')
    return <ServicePage kind={location.pathname === '/support' ? 'support' : 'terms'} />;
  if (import.meta.env.DEV && location.pathname === '/__preview/login') return <LoginGate preview />;
  if (import.meta.env.DEV && location.pathname === '/__preview/styleguide') return <Styleguide />;
  return <Showroom />;
}
