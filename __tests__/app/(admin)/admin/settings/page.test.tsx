/**
 * Admin Settings Page Tests
 *
 * Component tests for settings page
 */

import { render, screen } from '@testing-library/react';
import SettingsPage from '@/app/(admin)/admin/settings/page';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  Settings: () => <div data-testid="settings-icon">Settings</div>,
  Database: () => <div data-testid="database-icon">Database</div>,
  Shield: () => <div data-testid="shield-icon">Shield</div>,
  Bell: () => <div data-testid="bell-icon">Bell</div>,
  Globe: () => <div data-testid="globe-icon">Globe</div>,
}));

describe('Settings Page', () => {
  it('should render settings page header', () => {
    render(<SettingsPage />);

    // "Settings" appears in both the icon mock and the heading
    expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Manage your Tamil content platform settings')).toBeInTheDocument();
  });

  it('should display all settings categories', () => {
    render(<SettingsPage />);

    expect(screen.getByText('General Settings')).toBeInTheDocument();
    // "Database", "Security" appear in icon mocks too — use getAllByText
    expect(screen.getAllByText('Database').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Security').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('should render general settings section', () => {
    render(<SettingsPage />);

    expect(screen.getByText('தமிழகவல்')).toBeInTheDocument();
    expect(screen.getByText(/Default Language: Tamil/)).toBeInTheDocument();
    expect(screen.getByText(/Time Zone: Asia\/Kolkata/)).toBeInTheDocument();
  });

  it('should render database configuration section', () => {
    render(<SettingsPage />);

    expect(screen.getByText(/Table: TamilWebContent/)).toBeInTheDocument();
    expect(screen.getByText(/Region: ca-central-1/)).toBeInTheDocument();
    expect(screen.getByText(/Read Capacity: On-demand/)).toBeInTheDocument();
  });

  it('should render security settings section', () => {
    render(<SettingsPage />);

    expect(screen.getByText(/Auth Provider: AWS Cognito/)).toBeInTheDocument();
    expect(screen.getByText(/User Pool: ca-central-1_JPXdswqHE/)).toBeInTheDocument();
    expect(screen.getByText(/MFA: Disabled/)).toBeInTheDocument();
  });

  it('should render notifications section', () => {
    render(<SettingsPage />);

    expect(screen.getByText(/Email Notifications: Enabled/)).toBeInTheDocument();
    expect(screen.getByText(/New Content Alerts: Enabled/)).toBeInTheDocument();
    expect(screen.getByText(/Comment Moderation: Enabled/)).toBeInTheDocument();
  });

  it('should display under development notice', () => {
    render(<SettingsPage />);

    expect(screen.getByText('Under Development')).toBeInTheDocument();
    expect(
      screen.getByText(/Settings functionality is currently under development/i)
    ).toBeInTheDocument();
  });

  it('should show development notice details', () => {
    render(<SettingsPage />);

    expect(
      screen.getByText(/You can view current configuration but cannot modify settings yet/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Check back soon for updates/i)).toBeInTheDocument();
  });

  it('should render Back to Dashboard link', () => {
    render(<SettingsPage />);

    const dashboardLink = screen.getByRole('link', { name: /back to dashboard/i });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('href', '/admin');
  });

  it('should render all required icons', () => {
    render(<SettingsPage />);

    expect(screen.getByTestId('settings-icon')).toBeInTheDocument();
    expect(screen.getByTestId('database-icon')).toBeInTheDocument();
    expect(screen.getByTestId('shield-icon')).toBeInTheDocument();
    expect(screen.getByTestId('bell-icon')).toBeInTheDocument();
    expect(screen.getByTestId('globe-icon')).toBeInTheDocument();
  });

  it('should have proper card structure', () => {
    const { container } = render(<SettingsPage />);

    // Check for cards
    const cards = container.querySelectorAll('.bg-white.rounded-lg.shadow-sm');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('should display Tamil language in site title', () => {
    render(<SettingsPage />);

    const tamilText = screen.getByText('தமிழகவல்');
    expect(tamilText).toBeInTheDocument();
  });

  it('should show Coming Soon buttons for each section', () => {
    render(<SettingsPage />);

    const comingSoonButtons = screen.getAllByRole('button', { name: /coming soon/i });
    expect(comingSoonButtons.length).toBe(4); // One for each settings category
  });

  it('should display configuration details', () => {
    render(<SettingsPage />);

    expect(screen.getByText(/Configure site name, logo, and basic information/i)).toBeInTheDocument();
    expect(screen.getByText(/DynamoDB configuration and backup settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Authentication and authorization settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Email and system notification preferences/i)).toBeInTheDocument();
  });

  it('should have yellow warning styling for development notice', () => {
    const { container } = render(<SettingsPage />);

    const notice = container.querySelector('.bg-yellow-50.border-yellow-400');
    expect(notice).toBeInTheDocument();
  });

  it('should have colored border for each category card', () => {
    const { container } = render(<SettingsPage />);

    expect(container.querySelector('.border-purple-500')).toBeInTheDocument(); // General
    expect(container.querySelector('.border-blue-500')).toBeInTheDocument();   // Database
    expect(container.querySelector('.border-red-500')).toBeInTheDocument();    // Security
    expect(container.querySelector('.border-green-500')).toBeInTheDocument();  // Notifications
  });
});
