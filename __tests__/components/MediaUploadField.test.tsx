/**
 * Tests for MediaUploadField — the admin media uploader.
 */

// The component calls adminFetch (which attaches the Cognito token). Delegate
// it to the mocked global.fetch so these tests exercise the upload flow.
jest.mock('@/lib/client-auth', () => ({
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaUploadField } from '@/components/admin/MediaUploadField';

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('MediaUploadField', () => {
  it('renders the label, a URL input and an Upload button', () => {
    render(
      <MediaUploadField kind="audio" label="Audio File (song)" value="" onChange={() => {}} />
    );
    expect(screen.getByText('Audio File (song)')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('forwards manual URL entry via onChange', () => {
    const onChange = jest.fn();
    render(<MediaUploadField kind="audio" label="Audio" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://example.com/song.mp3' },
    });
    expect(onChange).toHaveBeenCalledWith('https://example.com/song.mp3');
  });

  it('uploads a selected file via presigned URL and returns the public URL', async () => {
    const onChange = jest.fn();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            uploadUrl: 'https://s3.example/put?sig=1',
            publicUrl: 'https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/song.mp3',
            headers: { 'Content-Type': 'audio/mpeg', 'x-amz-tagging': 'public=true' },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(
      <MediaUploadField kind="audio" label="Audio" value="" onChange={onChange} />
    );

    fireEvent.change(fileInput(container), {
      target: { files: [makeFile('song.mp3', 'audio/mpeg', 1024)] },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        'https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/song.mp3'
      )
    );

    // First call: our presign endpoint. Second: the S3 PUT.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/upload');
    expect(fetchMock.mock.calls[1][0]).toBe('https://s3.example/put?sig=1');
  });

  it('rejects an oversized file before calling the network', async () => {
    const onChange = jest.fn();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { container } = render(
      <MediaUploadField kind="video" label="Preview Video" value="" onChange={onChange} />
    );

    fireEvent.change(fileInput(container), {
      target: { files: [makeFile('huge.mp4', 'video/mp4', 60 * 1024 * 1024)] },
    });

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
