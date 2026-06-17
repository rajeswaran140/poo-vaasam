'use client';

/**
 * PerformerGate — the auth gate for the /performers portal.
 *
 * Reuses the same Cognito user pool as admin (the Authenticator.Provider is
 * mounted globally in the root layout), but presents a performer-branded
 * sign-in/sign-up INLINE: anonymous visitors see the login form in place, and
 * once authenticated the gate renders the portal children. No redirect dance —
 * deep links into /performers/* land back on the same URL after sign-in.
 *
 * Sign-up requires accepting a short performance-terms acknowledgement
 * (validated client-side; it blocks account creation when unticked). Durable
 * server-side persistence of that acceptance is a Phase-2 follow-up.
 *
 * This gate is presentation/session only — it is NOT the security boundary.
 * Every gated asset (lyrics, backing tracks) is served by an API route behind
 * `requirePerformer`; the gate just decides what UI to show.
 */

import {
  Authenticator,
  CheckboxField,
  ThemeProvider,
  useAuthenticator,
  type Theme,
} from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import '@/lib/amplify-config';
import { ReactNode } from 'react';
import { clearCognitoCookies } from '@/lib/client-auth';

const performerTheme: Theme = {
  name: 'tamilagaval-performers',
  tokens: {
    colors: {
      brand: {
        primary: {
          10: { value: '#fff7ed' },
          20: { value: '#ffedd5' },
          40: { value: '#fdba74' },
          60: { value: '#ea580c' },
          80: { value: '#c2410c' },
          90: { value: '#9a3412' },
          100: { value: '#7c2d12' },
        },
      },
    },
  },
};

const TERMS_LABEL =
  'I agree to use these songs for personal, non-commercial performance only, and not to redistribute the lyrics or backing tracks.';

/** Custom sign-up fields = the default ones + a required terms checkbox. */
const authComponents = {
  SignUp: {
    FormFields() {
      const { validationErrors } = useAuthenticator();
      return (
        <>
          <Authenticator.SignUp.FormFields />
          <CheckboxField
            name="acknowledgement"
            value="yes"
            label={TERMS_LABEL}
            errorMessage={validationErrors.acknowledgement as string | undefined}
            hasError={!!validationErrors.acknowledgement}
          />
        </>
      );
    },
  },
};

const authServices = {
  async validateCustomSignUp(formData: Record<string, string>) {
    if (!formData.acknowledgement) {
      return { acknowledgement: 'You must agree to the performance terms to continue.' };
    }
    return undefined;
  },
};

export function PerformerGate({ children }: { children: ReactNode }) {
  const { authStatus, user, signOut } = useAuthenticator((c) => [c.authStatus, c.user]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      /* signOut throws when revoking an already-expired token — ignore */
    }
    clearCognitoCookies();
  };

  if (authStatus === 'configuring') {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        <p className="font-tamil">ஏற்றுகிறது…</p>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 via-white to-orange-100/60 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="mb-1 font-kavivanar text-4xl font-bold text-orange-800">தமிழகவல்</h1>
            <p className="font-tamil text-gray-600">பாடகர் பகுதி · For Performers</p>
            <p className="mt-2 text-sm text-gray-500">
              Sign in to access lyrics and backing tracks to perform these songs.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-xl">
            <ThemeProvider theme={performerTheme}>
              <Authenticator
                loginMechanisms={['email']}
                signUpAttributes={['email']}
                components={authComponents}
                services={authServices}
              />
            </ThemeProvider>
          </div>
          <p className="mt-6 text-center text-xs text-gray-400 font-tamil">© 2026 தமிழகவல்</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <span className="font-kavivanar text-xl font-bold text-orange-800">தமிழகவல்</span>
            <span className="ml-2 font-tamil text-sm text-gray-500">பாடகர் பகுதி</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3 text-sm">
            {user?.username ? (
              <span className="hidden max-w-[12rem] truncate text-gray-500 sm:inline" title={user.username}>
                {user.username}
              </span>
            ) : null}
            <button
              onClick={handleSignOut}
              className="rounded-full border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
