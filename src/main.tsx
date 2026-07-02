import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './theme.css';

// Apply the saved theme before first paint so there's no light flash.
document.documentElement.dataset.theme = localStorage.getItem('polygon-theme') ?? 'light';

// Clerk is optional: without VITE_CLERK_PUBLISHABLE_KEY, Polygon runs in solo
// mode — local-first, no accounts, exactly the original behavior.
const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {pk ? (
      <ClerkProvider publishableKey={pk} afterSignOutUrl="/">
        <App clerkEnabled />
      </ClerkProvider>
    ) : (
      <App clerkEnabled={false} />
    )}
  </StrictMode>,
);
