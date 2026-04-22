/**
 * Admin Media Library Page Tests
 *
 * Component tests for media library page
 */

import { render, screen } from '@testing-library/react';
import MediaLibraryPage from '@/app/(admin)/admin/media/page';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

// Mock Lucide React icons
jest.mock('lucide-react', () => ({
  Image: () => <div data-testid="image-icon">Image</div>,
  Music: () => <div data-testid="music-icon">Music</div>,
  Upload: () => <div data-testid="upload-icon">Upload</div>,
  Folder: () => <div data-testid="folder-icon">Folder</div>,
}));

describe('Media Library Page', () => {
  it('should render media library header', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('Media Library')).toBeInTheDocument();
    expect(screen.getByText('Manage images, audio files, and media assets')).toBeInTheDocument();
  });

  it('should render Upload Media button in header', () => {
    render(<MediaLibraryPage />);

    const uploadButtons = screen.getAllByRole('button', { name: /upload media/i });
    expect(uploadButtons.length).toBeGreaterThan(0);
  });

  it('should display media stats cards', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('Images')).toBeInTheDocument();
    expect(screen.getByText('Audio Files')).toBeInTheDocument();
    expect(screen.getByText('Total Storage')).toBeInTheDocument();
  });

  it('should show zero state for all media stats', () => {
    render(<MediaLibraryPage />);

    // Check for zero counts
    const zeroTexts = screen.getAllByText('0');
    expect(zeroTexts.length).toBeGreaterThan(0);

    expect(screen.getByText('Total size: 0 MB')).toBeInTheDocument();
    expect(screen.getByText('0 MB')).toBeInTheDocument();
    expect(screen.getByText('of 10 GB used')).toBeInTheDocument();
  });

  it('should render upload zone', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('Drag and drop files here')).toBeInTheDocument();
    expect(screen.getByText(/or click to browse from your computer/i)).toBeInTheDocument();
  });

  it('should display Select Files button in upload zone', () => {
    render(<MediaLibraryPage />);

    const selectButton = screen.getByRole('button', { name: /select files/i });
    expect(selectButton).toBeInTheDocument();
  });

  it('should show supported file formats', () => {
    render(<MediaLibraryPage />);

    expect(
      screen.getByText(/Supported formats: JPG, PNG, GIF, MP3, WAV/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Max 10MB/i)).toBeInTheDocument();
  });

  it('should render Recent Uploads section', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('Recent Uploads')).toBeInTheDocument();
  });

  it('should show empty state for recent uploads', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('No media files yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Upload your first image or audio file to get started/i)
    ).toBeInTheDocument();
  });

  it('should display under development notice', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('Under Development')).toBeInTheDocument();
    expect(
      screen.getByText(/Media Library functionality is currently under development/i)
    ).toBeInTheDocument();
  });

  it('should list planned features', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText(/Drag-and-drop file upload to AWS S3/i)).toBeInTheDocument();
    expect(screen.getByText(/Image resizing and optimization/i)).toBeInTheDocument();
    expect(screen.getByText(/Gallery view with thumbnails/i)).toBeInTheDocument();
    expect(screen.getByText(/Search and filter by file type/i)).toBeInTheDocument();
    expect(screen.getByText(/Bulk delete and organize/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct integration with content forms/i)).toBeInTheDocument();
  });

  it('should render Back to Dashboard link', () => {
    render(<MediaLibraryPage />);

    const dashboardLink = screen.getByRole('link', { name: /back to dashboard/i });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('href', '/admin');
  });

  it('should render all required icons', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByTestId('folder-icon')).toBeInTheDocument();
    expect(screen.getByTestId('image-icon')).toBeInTheDocument();
    expect(screen.getByTestId('music-icon')).toBeInTheDocument();
    // Upload icons appear multiple times
    const uploadIcons = screen.getAllByTestId('upload-icon');
    expect(uploadIcons.length).toBeGreaterThan(0);
  });

  it('should have gradient backgrounds for stat cards', () => {
    const { container } = render(<MediaLibraryPage />);

    expect(container.querySelector('.from-blue-500.to-blue-600')).toBeInTheDocument();
    expect(container.querySelector('.from-green-500.to-green-600')).toBeInTheDocument();
    expect(container.querySelector('.from-purple-500.to-purple-600')).toBeInTheDocument();
  });

  it('should have dashed border for upload zone', () => {
    const { container } = render(<MediaLibraryPage />);

    const uploadZone = container.querySelector('.border-dashed');
    expect(uploadZone).toBeInTheDocument();
  });

  it('should display proper grid layout for stats', () => {
    const { container } = render(<MediaLibraryPage />);

    const gridContainer = container.querySelector('.grid.grid-cols-1.md\\:grid-cols-3');
    expect(gridContainer).toBeInTheDocument();
  });

  it('should have blue warning styling for development notice', () => {
    const { container } = render(<MediaLibraryPage />);

    const notice = container.querySelector('.bg-blue-50.border-blue-400');
    expect(notice).toBeInTheDocument();
  });

  it('should show storage usage percentage', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByText('of 10 GB used')).toBeInTheDocument();
  });
});
