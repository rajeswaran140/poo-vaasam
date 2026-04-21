'use client';

/**
 * Auth Provider
 *
 * Provides authentication context to the app
 */

import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import '@/lib/amplify-config';
import { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  return (
    <Authenticator.Provider>
      {children}
    </Authenticator.Provider>
  );
}
