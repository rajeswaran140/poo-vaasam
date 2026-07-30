/** @jest-environment jsdom */
/**
 * MasteringStudio — the Saved masters library: play, rename, and the three
 * defects found auditing the first version.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/MasteringComparePlayer', () => ({
  MasteringComparePlayer: () => null,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MasteringStudio } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const master = {
  id: 'job1',
  status: 'done',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  s3Key: 'audio/mastering/in.wav',
  target: -14,
  masterKey: 'audio/mastering/out-master-14LUFS.wav',
  beforeLufs: -17.9, beforeTp: -1.2, afterLufs: -14, afterTp: -1,
  beforeLra: 3, afterLra: 3, normalizationType: 'linear',
  source: null, savedAt: '2026-07-30T16:23:17.054Z',
  title: 'ஈழத்து மண்ணே', error: null,
};

function routeFetch(over: { rename?: unknown; play?: unknown } = {}) {
  mockedFetch.mockImplementation((url: string) => {
    if (url.includes('/masters')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: true, masters: [master] }) } as Response);
    }
    if (url.includes('/rename')) {
      return Promise.resolve(
        (over.rename ?? { ok: true, json: async () => ({ success: true, title: 'New name' }) }) as Response
      );
    }
    if (url.includes('/mastering/download')) {
      return Promise.resolve(
        (over.play ?? { ok: true, json: async () => ({ success: true, url: 'https://s3/pre?sig=1' }) }) as Response
      );
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

async function openLibrary() {
  render(<MasteringStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Saved masters/i }));
  return screen.findByText('ஈழத்து மண்ணே');
}

beforeEach(() => mockedFetch.mockReset());

describe('play', () => {
  it('mints a presigned URL in play mode, not download mode', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));
    await waitFor(() =>
      expect(
        mockedFetch.mock.calls.some(([u]: [string]) => u.includes('mode=play'))
      ).toBe(true)
    );
  });

  it('never asks for a download filename when playing — that would attach it', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));
    await waitFor(() => {
      const call = mockedFetch.mock.calls.find(([u]: [string]) => u.includes('mode=play'));
      expect(call?.[0]).not.toContain('name=');
    });
  });

  it('says so when the presigned link has expired instead of failing silently', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Play/ }));
    await waitFor(() => expect(document.querySelector('audio')).toBeTruthy());
    fireEvent.error(document.querySelector('audio') as HTMLAudioElement);
    expect(await screen.findByText(/playback link expired/i)).toBeInTheDocument();
  });
});

describe('rename', () => {
  it('PATCHes the new title', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(mockedFetch.mock.calls.some(([u]: [string]) => u.includes('/rename'))).toBe(true)
    );
  });

  it('does NOT write when the name is unchanged — closing an editor is free', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(mockedFetch.mock.calls.some(([u]: [string]) => u.includes('/rename'))).toBe(false)
    );
  });

  it('abandons on Escape without writing', async () => {
    routeFetch();
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.getByText('ஈழத்து மண்ணே')).toBeInTheDocument());
    expect(mockedFetch.mock.calls.some(([u]: [string]) => u.includes('/rename'))).toBe(false);
  });

  it('shows the SERVER title, not the typed text, so the list matches the file', async () => {
    routeFetch({
      rename: { ok: true, json: async () => ({ success: true, title: 'Server cleaned' }) },
    });
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'typed/name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Server cleaned')).toBeInTheDocument();
  });

  it('surfaces a refusal rather than pretending it worked', async () => {
    routeFetch({
      rename: {
        ok: false,
        json: async () => ({ success: false, error: 'Only a saved master can be renamed' }),
      },
    });
    await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /^Rename/ }));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText(/Only a saved master can be renamed/)).toBeInTheDocument();
  });
});
