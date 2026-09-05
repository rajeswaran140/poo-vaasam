import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SunoPromptStudio, type SunoPromptRow } from '@/components/admin/SunoPromptStudio';

jest.mock('@/lib/client-auth', () => ({
  adminFetch: jest.fn(),
}));

// The real poller would sit on a 170s deadline waiting for a worker that does
// not exist in a unit test. We assert the enqueue, not the polling.
jest.mock('@/lib/poll-job', () => ({
  pollJob: jest.fn(async () => undefined),
}));

import { adminFetch } from '@/lib/client-auth';
const mockFetch = adminFetch as jest.Mock;

const ROW: SunoPromptRow = {
  id: 'snp_1',
  title: 'Enna Idhu Kadhalā — folk take',
  lyrics: 'என்ன இது காதலா',
  style: 'Tamil village folk',
  styleBox: 'tamil folk, thavil, warm male lead',
  exclude: ['autotune'],
  lyricsBlock: '[Verse - flute intro]',
  weirdness: 50,
  styleInfluence: 80,
  usesAudioUpload: false,
};

beforeEach(() => jest.clearAllMocks());

describe('the saved-prompt library', () => {
  it('lists prompts that were saved earlier', () => {
    render(<SunoPromptStudio initial={[ROW]} />);
    expect(screen.getByText('Enna Idhu Kadhalā — folk take')).toBeInTheDocument();
  });

  it('says so plainly when nothing has been saved yet', () => {
    render(<SunoPromptStudio initial={[]} />);
    expect(screen.getByText(/no saved prompts/i)).toBeInTheDocument();
  });
});

describe('Audio Influence is conditional, matching Suno', () => {
  it('is hidden until the prompt is marked as using an audio upload', () => {
    render(<SunoPromptStudio initial={[]} />);
    expect(screen.queryByLabelText(/audio influence/i)).not.toBeInTheDocument();
  });

  it('appears once audio upload is switched on', async () => {
    const user = userEvent.setup();
    render(<SunoPromptStudio initial={[]} />);
    await user.click(screen.getByLabelText(/uses an audio upload/i));
    expect(screen.getByLabelText(/audio influence/i)).toBeInTheDocument();
  });

  it('explains why it is absent rather than just hiding it', () => {
    render(<SunoPromptStudio initial={[]} />);
    expect(screen.getByText(/only.*audio upload/i)).toBeInTheDocument();
  });
});

describe('generating a pack', () => {
  it('will not generate without lyrics and a style', async () => {
    const user = userEvent.setup();
    render(<SunoPromptStudio initial={[]} />);
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/^lyrics/i), 'என்ன இது காதலா');
    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/style name/i), 'Tamil village folk');
    expect(screen.getByRole('button', { name: /generate/i })).toBeEnabled();
  });

  it('enqueues against the existing suno-setup endpoint', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'job_1' }),
    });
    render(<SunoPromptStudio initial={[]} />);
    await user.type(screen.getByLabelText(/^lyrics/i), 'என்ன இது காதலா');
    await user.type(screen.getByLabelText(/style name/i), 'Tamil village folk');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toBe('/api/admin/compose/suno-setup');
  });
});

describe('saving', () => {
  it('cannot save before there is something to save', () => {
    render(<SunoPromptStudio initial={[]} />);
    expect(screen.getByRole('button', { name: /^save/i })).toBeDisabled();
  });

  it('posts the pack, omitting audioInfluence when no audio upload is used', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, prompt: { ...ROW, id: 'snp_2' } }),
    });
    render(<SunoPromptStudio initial={[]} loaded={ROW} />);

    await user.click(screen.getByRole('button', { name: /^save/i }));

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.usesAudioUpload).toBe(false);
    expect(body).not.toHaveProperty('audioInfluence');
    expect(body.styleBox).toBe(ROW.styleBox);
  });
});
