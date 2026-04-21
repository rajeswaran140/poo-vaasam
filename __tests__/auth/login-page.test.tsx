/**
 * Login Page Tests
 *
 * Tests for AWS Cognito authentication UI and redirect behavior
 */

import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import LoginPage from '@/app/login/page';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock Amplify UI React
jest.mock('@aws-amplify/ui-react', () => ({
  Authenticator: ({ children }: any) => (
    <div data-testid="authenticator">
      {typeof children === 'function' ? children() : children}
    </div>
  ),
  ThemeProvider: ({ children }: any) => <div>{children}</div>,
  useAuthenticator: jest.fn(),
}));

// Mock Amplify config
jest.mock('@/lib/amplify-config', () => ({}));

// Mock CSS import
jest.mock('@aws-amplify/ui-react/styles.css', () => ({}));

describe('Login Page', () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });

    // Mock window.location
    delete (window as any).location;
    window.location = {
      search: '',
      href: 'https://tamilagaval.com/login',
    } as any;
  });

  describe('Rendering', () => {
    it('should render login page with Tamil branding', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
      });

      render(<LoginPage />);

      expect(screen.getByText('தமிழகவல்')).toBeInTheDocument();
      expect(screen.getByText('Admin Portal')).toBeInTheDocument();
      expect(screen.getByText('© 2026 தமிழகவல் - Admin Dashboard')).toBeInTheDocument();
    });

    it('should render Authenticator component', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
      });

      render(<LoginPage />);

      expect(screen.getByTestId('authenticator')).toBeInTheDocument();
    });

    it('should apply purple gradient background', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
      });

      const { container } = render(<LoginPage />);
      const mainDiv = container.firstChild as HTMLElement;

      expect(mainDiv).toHaveClass('bg-gradient-to-br');
      expect(mainDiv).toHaveClass('from-purple-100');
    });
  });

  describe('Authentication Redirect', () => {
    it('should redirect to /admin when user is authenticated without redirect param', async () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it('should redirect to original destination when redirect param present', async () => {
      window.location.search = '?redirect=/admin/content/new';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin/content/new');
      });
    });

    it('should sanitize redirect param to only allow /admin paths', async () => {
      window.location.search = '?redirect=/malicious-site';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it('should prevent external redirect attacks', async () => {
      window.location.search = '?redirect=https://evil.com/admin';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it('should show redirecting message when authenticated', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      expect(screen.getByText('Redirecting to admin dashboard...')).toBeInTheDocument();
    });
  });

  describe('Unauthenticated State', () => {
    it('should not redirect when user is not authenticated', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
      });

      render(<LoginPage />);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should not show redirecting message when not authenticated', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
      });

      render(<LoginPage />);

      expect(screen.queryByText('Redirecting to admin dashboard...')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined user gracefully', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: undefined,
      });

      expect(() => render(<LoginPage />)).not.toThrow();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should handle multiple redirect params (use first)', async () => {
      window.location.search = '?redirect=/admin/content&redirect=/admin/tags';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin/content');
      });
    });

    it('should handle redirect param with query string', async () => {
      window.location.search = '?redirect=/admin/content?type=POEMS';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        // Note: Browser URLSearchParams parses this, so ? becomes encoded
        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/admin/content'));
      });
    });

    it('should handle empty redirect param', async () => {
      window.location.search = '?redirect=';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });
  });

  describe('Security', () => {
    it('should reject redirect to public routes', async () => {
      window.location.search = '?redirect=/songs';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it('should reject javascript: protocol in redirect', async () => {
      window.location.search = '?redirect=javascript:alert(1)';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });

    it('should reject data: protocol in redirect', async () => {
      window.location.search = '?redirect=data:text/html,<script>alert(1)</script>';

      (useAuthenticator as jest.Mock).mockReturnValue({
        user: { username: 'test@example.com' },
      });

      render(<LoginPage />);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/admin');
      });
    });
  });
});
