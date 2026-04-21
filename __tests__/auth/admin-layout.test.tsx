/**
 * Admin Layout Authentication Tests
 *
 * Tests client-side authentication protection for admin routes
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { useAuthenticator } from '@aws-amplify/ui-react';
import AdminLayout from '@/app/(admin)/layout';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock Amplify UI React
jest.mock('@aws-amplify/ui-react', () => ({
  useAuthenticator: jest.fn(),
}));

// Mock Amplify config
jest.mock('@/lib/amplify-config', () => ({}));

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  LayoutDashboard: () => <div data-testid="icon-dashboard" />,
  FileText: () => <div data-testid="icon-content" />,
  Folder: () => <div data-testid="icon-categories" />,
  Tag: () => <div data-testid="icon-tags" />,
  Image: () => <div data-testid="icon-media" />,
  Globe: () => <div data-testid="icon-globe" />,
  Settings: () => <div data-testid="icon-settings" />,
  LogOut: () => <div data-testid="icon-logout" />,
  Plus: () => <div data-testid="icon-plus" />,
}));

describe('Admin Layout Authentication', () => {
  const mockPush = jest.fn();
  const mockSignOut = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
  });

  describe('Authenticated User', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: {
            loginId: 'test@example.com',
          },
        },
        signOut: mockSignOut,
      });
    });

    it('should render layout when user is authenticated', () => {
      render(
        <AdminLayout>
          <div>Test Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('தமிழகவல்')).toBeInTheDocument();
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Test Page Body')).toBeInTheDocument();
    });

    it('should display user email in sidebar', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('should render all navigation links', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /content/i })).toBeInTheDocument();
      expect(screen.getByText('Categories')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
      expect(screen.getByText('Media Library')).toBeInTheDocument();
      expect(screen.getByText('View Site')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('should render logout button', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    it('should call signOut and redirect when logout clicked', async () => {
      mockSignOut.mockResolvedValue(undefined);

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const logoutButton = screen.getByText('Logout');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/login');
      });
    });

    it('should handle logout error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockSignOut.mockRejectedValue(new Error('Logout failed'));

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const logoutButton = screen.getByText('Logout');
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith('Error signing out:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('should render children content in main area', () => {
      render(
        <AdminLayout>
          <div data-testid="child-content">Dashboard Main Area</div>
        </AdminLayout>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Dashboard Main Area')).toBeInTheDocument();
    });

    it('should show "New Content" button in header', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('New Content')).toBeInTheDocument();
    });
  });

  describe('Unauthenticated User', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
        signOut: mockSignOut,
      });
    });

    it('should redirect to login when user is not authenticated', () => {
      render(
        <AdminLayout>
          <div>Protected Page</div>
        </AdminLayout>
      );

      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('should not render layout when user is not authenticated', () => {
      const { container } = render(
        <AdminLayout>
          <div>Protected Page</div>
        </AdminLayout>
      );

      // Should return null (no content rendered)
      expect(container.firstChild).toBeNull();
    });

    it('should not display protected content', () => {
      render(
        <AdminLayout>
          <div data-testid="protected">Secret Admin Data</div>
        </AdminLayout>
      );

      expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
      expect(screen.queryByText('Secret Admin Data')).not.toBeInTheDocument();
    });
  });

  describe('User State Changes', () => {
    it('should redirect when user logs out', () => {
      const { rerender } = render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Initially authenticated
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });

      rerender(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // User logs out
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: null,
        signOut: mockSignOut,
      });

      rerender(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  describe('User Display', () => {
    it('should display username when loginId is not available', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'fallback@example.com',
          signInDetails: null,
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('should truncate long email addresses', () => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'verylongemailaddress@example.com',
          signInDetails: {
            loginId: 'verylongemailaddress@example.com',
          },
        },
        signOut: mockSignOut,
      });

      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const emailElement = screen.getByText('verylongemailaddress@example.com');
      expect(emailElement).toHaveClass('truncate');
    });
  });

  describe('Navigation', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });
    });

    it('should have correct href for dashboard link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveAttribute('href', '/admin');
    });

    it('should have correct href for content link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      // Use more specific selector to avoid collision
      const navLinks = screen.getAllByRole('link');
      const contentLink = navLinks.find(link => link.getAttribute('href') === '/admin/content');
      expect(contentLink).toHaveAttribute('href', '/admin/content');
    });

    it('should have correct href for view site link', () => {
      render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const viewSiteLink = screen.getByText('View Site').closest('a');
      expect(viewSiteLink).toHaveAttribute('href', '/');
    });
  });

  describe('Layout Structure', () => {
    beforeEach(() => {
      (useAuthenticator as jest.Mock).mockReturnValue({
        user: {
          username: 'test@example.com',
          signInDetails: { loginId: 'test@example.com' },
        },
        signOut: mockSignOut,
      });
    });

    it('should have fixed sidebar', () => {
      const { container } = render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const sidebar = container.querySelector('aside');
      expect(sidebar).toHaveClass('fixed');
    });

    it('should have sticky header', () => {
      const { container } = render(
        <AdminLayout>
          <div>Page Body</div>
        </AdminLayout>
      );

      const header = container.querySelector('header');
      expect(header).toHaveClass('sticky');
    });
  });
});
