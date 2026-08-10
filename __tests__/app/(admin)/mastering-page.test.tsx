/** @jest-environment jsdom */
/**
 * /admin/mastering — the page shell.
 *
 * The studio and the install prompt have their own suites; this covers the one
 * thing the shell decides, which the UI audit flagged: the module has no
 * `md:`/`lg:` breakpoints and the admin layout puts no `max-w` on its content
 * wrapper, so unconstrained this page stretched to the full viewport on a
 * desktop. The cap lives here rather than in the layout because the data-dense
 * admin pages genuinely want the width.
 */

jest.mock('@/components/admin/MasteringStudio', () => ({
  MasteringStudio: () => <div data-testid="studio" />,
}));
jest.mock('@/components/admin/MasteringInstall', () => ({
  MasteringInstall: () => <div data-testid="install" />,
}));

import { render, screen } from '@testing-library/react';
import AdminMasteringPage from '@/app/(admin)/admin/mastering/page';

describe('AdminMasteringPage shell', () => {
  it('renders the install prompt above the studio', () => {
    render(<AdminMasteringPage />);
    const install = screen.getByTestId('install');
    const studio = screen.getByTestId('studio');
    expect(install).toBeInTheDocument();
    expect(studio).toBeInTheDocument();
    // The install prompt must come first — it is the PWA hint, and it belongs
    // before the tool rather than buried under it.
    expect(install.compareDocumentPosition(studio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('caps the width and centres the column', () => {
    render(<AdminMasteringPage />);
    const box = screen.getByTestId('mastering-container');
    expect(box.className).toContain('max-w-5xl');
    expect(box.className).toContain('mx-auto');
  });

  it('still fills a narrow screen — the cap is a ceiling, not a fixed width', () => {
    // Without w-full the column can collapse to its content on a phone, which
    // is the opposite of what a cap is for.
    render(<AdminMasteringPage />);
    expect(screen.getByTestId('mastering-container').className).toContain('w-full');
  });

  it('keeps the vertical rhythm between the two panels', () => {
    expect(screen.queryByTestId('mastering-container')).toBeNull(); // not yet rendered
    render(<AdminMasteringPage />);
    expect(screen.getByTestId('mastering-container').className).toContain('space-y-4');
  });
});
