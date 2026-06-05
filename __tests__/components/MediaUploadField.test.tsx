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

  it('uploads a selected file via a presigned POST (fields first, file last) and returns the public URL', async () => {
    const onChange = jest.fn();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            uploadUrl: 'https://tamil-web-media.s3.us-east-1.amazonaws.com/',
            fields: { key: 'audio/song.mp3', 'Content-Type': 'audio/mpeg', policy: 'POLICY', 'x-amz-signature': 'SIG' },
            publicUrl: 'https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/song.mp3',
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true }); // S3 returns 204 on success
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

    // First call: our presign endpoint. Second: the S3 POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/upload');
    expect(fetchMock.mock.calls[1][0]).toBe('https://tamil-web-media.s3.us-east-1.amazonaws.com/');

    // The S3 request is a multipart POST whose body carries the policy fields
    // plus the file part appended LAST (S3 requires that ordering).
    const s3Init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(s3Init.method).toBe('POST');
    const body = s3Init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('key')).toBe('audio/song.mp3');
    expect(body.get('Content-Type')).toBe('audio/mpeg');
    const keys = Array.from(body.keys());
    expect(keys[keys.length - 1]).toBe('file'); // file appended last
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
