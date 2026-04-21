'use client';

/**
 * Admin Login Page
 *
 * AWS Cognito authentication with Amplify Authenticator
 */

import { Authenticator, ThemeProvider, Theme, useAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import '@/lib/amplify-config';

const customTheme: Theme = {
  name: 'tamilagaval-theme',
  tokens: {
    colors: {
      brand: {
        primary: {
          10: { value: '#f3f4f6' },
          20: { value: '#e5e7eb' },
          40: { value: '#9ca3af' },
          60: { value: '#7c3aed' },
          80: { value: '#6d28d9' },
          90: { value: '#5b21b6' },
          100: { value: '#4c1d95' },
        },
      },
    },
  },
};

function LoginContent() {
  const { user } = useAuthenticator((context) => [context.user]);
  const router = useRouter();

  useEffect(() => {
    if (user) {
      // Check for redirect parameter in URL
      const searchParams = new URLSearchParams(window.location.search);
      const redirect = searchParams.get('redirect');
      // Redirect to original destination or default to admin dashboard
      router.push(redirect && redirect.startsWith('/admin') ? redirect : '/admin');
    }
  }, [user, router]);

  if (user) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-lg text-gray-600 font-tamil">
            Redirecting to admin dashboard...
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold font-kavivanar text-purple-800 mb-2">
            தமிழகவல்
          </h1>
          <p className="text-gray-600 font-tamil">Admin Portal</p>
        </div>

        {/* Authenticator */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <ThemeProvider theme={customTheme}>
            <Authenticator
              socialProviders={[]}
              loginMechanisms={['email']}
              signUpAttributes={['email']}
              formFields={{
                signIn: {
                  username: {
                    label: 'Email',
                    placeholder: 'Enter your email',
                  },
                  password: {
                    label: 'Password',
                    placeholder: 'Enter your password',
                  },
                },
                signUp: {
                  email: {
                    label: 'Email',
                    placeholder: 'Enter your email',
                    order: 1,
                  },
                  password: {
                    label: 'Password',
                    placeholder: 'Create a password',
                    order: 2,
                  },
                  confirm_password: {
                    label: 'Confirm Password',
                    placeholder: 'Re-enter your password',
                    order: 3,
                  },
                },
              }}
            >
              <LoginContent />
            </Authenticator>
          </ThemeProvider>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-sm text-gray-500 font-tamil">
            © 2026 தமிழகவல் - Admin Dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
