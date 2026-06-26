/**
 * DocExport — renders the .md + PDF buttons; .md triggers a Blob download and
 * PDF spins up a hidden print iframe with the doc's HTML.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { DocExport } from '@/components/admin/DocExport';

const DOC = { slug: 'instrument-palette', title: 'Instrument palette', body: '# Instrument palette\n\nhello', updatedAt: '2026-06-26' };

beforeEach(() => {
  (URL.createObjectURL as unknown) = jest.fn(() => 'blob:fake');
  (URL.revokeObjectURL as unknown) = jest.fn();
});

it('renders both export buttons', () => {
  render(<DocExport doc={DOC} />);
  expect(screen.getByRole('button', { name: /\.md/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pdf/i })).toBeInTheDocument();
});

it('downloads a slug-named .md file when the Markdown button is clicked', () => {
  let downloadName = '';
  const clickSpy = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
  render(<DocExport doc={DOC} />);
  fireEvent.click(screen.getByRole('button', { name: /\.md/i }));
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(clickSpy).toHaveBeenCalledTimes(1);
  expect(downloadName).toBe('instrument-palette.md'); // from slug, not the title
  clickSpy.mockRestore();
});

it('opens a hidden print iframe carrying the doc HTML when PDF is clicked', () => {
  render(<DocExport doc={DOC} />);
  fireEvent.click(screen.getByRole('button', { name: /pdf/i }));
  const iframe = document.querySelector('iframe');
  expect(iframe).not.toBeNull();
  expect(iframe?.getAttribute('srcdoc')).toContain('<h1>Instrument palette</h1>');
  iframe?.remove();
});
