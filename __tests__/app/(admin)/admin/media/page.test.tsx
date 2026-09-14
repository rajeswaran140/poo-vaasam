/**
 * Media Library page — the honest placeholder.
 *
 * This page used to render a convincing mock: an "Upload Media" button, a
 * "Select Files" drop zone, gradient stat cards and a storage-usage
 * percentage, none of it wired to anything. Raj went looking for somewhere to
 * upload stem files, landed here, and lost time before finding out.
 *
 * The previous 18 tests pinned that mock's appearance — gradients, dashed
 * borders, grid classes. They passed while the page misled its only user,
 * which is the clearest possible sign they were testing the wrong thing.
 *
 * These test the property that actually matters: someone landing here learns
 * within a second that nothing uploads, and where to go instead. The negative
 * assertions are the load-bearing ones — they stop the fake controls coming
 * back.
 */

import { render, screen } from '@testing-library/react';
import MediaLibraryPage from '@/app/(admin)/admin/media/page';

jest.mock('next/link', () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

jest.mock('lucide-react', () => ({
  Folder: () => <div data-testid="folder-icon" />,
  UploadCloud: () => <div data-testid="upload-icon" />,
  ArrowRight: () => <div data-testid="arrow-icon" />,
}));

describe('Media Library page', () => {
  it('says plainly that it is not built', () => {
    render(<MediaLibraryPage />);
    expect(screen.getByText(/Not built yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing on this page uploads, lists or deletes a file/i)
    ).toBeInTheDocument();
  });

  it('sends the reader to the uploader that works', () => {
    render(<MediaLibraryPage />);
    const link = screen.getByRole('link', { name: /Go to Bulk upload/i });
    expect(link).toHaveAttribute('href', '/admin/mastering/bulk');
  });

  it('mentions the content-form upload, so the reader is not left thinking nothing works', () => {
    render(<MediaLibraryPage />);
    expect(screen.getByText(/upload field on\s+the content form/i)).toBeInTheDocument();
  });

  it('records the non-obvious requirement for a real bulk delete', () => {
    // Deleting an S3 key a content record still points at breaks the site.
    render(<MediaLibraryPage />);
    expect(screen.getByText(/no content record still points at the key/i)).toBeInTheDocument();
  });

  // --- the load-bearing half: the mock must not come back ------------------

  it('offers no upload control of its own', () => {
    render(<MediaLibraryPage />);
    expect(screen.queryByRole('button', { name: /Upload Media/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Select Files/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('shows no invented statistics', () => {
    // The old page displayed zeroed stat cards and a storage percentage that
    // were never read from anywhere.
    render(<MediaLibraryPage />);
    expect(screen.queryByText(/storage used/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
