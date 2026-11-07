/** @jest-environment jsdom */
/** The Video Text project list: list, create inline, open, back, and ?p= survives a reload. */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('@/components/admin/video-text/VideoTextEditor', () => ({
  VideoTextEditor: ({ project, onBack }: { project: { name: string }; onBack: () => void }) => (
    <div>
      <p>Editing {project.name}</p>
      <button type="button" onClick={onBack}>All projects</button>
    </div>
  ),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { VideoTextApp } from '@/components/admin/video-text/VideoTextApp';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const row = (id: string, name: string, status = 'idle') => ({
  id, name, updatedAt: '2026-11-07T14:05:00.000Z', render: { status }, source: null, blocks: [],
});

beforeEach(() => {
  mockedFetch.mockReset();
  window.history.replaceState(null, '', '/admin/video-text');
  mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/admin/video-text') {
      return json({ projects: [row('a', 'Song A', 'done'), row('b', 'Song B', 'encoding')] });
    }
    if (method === 'GET' && url === '/api/admin/video-text/a') return json({ project: row('a', 'Song A') });
    if (method === 'POST' && url === '/api/admin/video-text') {
      return json({ project: row('n', JSON.parse(String(init?.body)).name) }, 201);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
});

it('lists projects with their render status', async () => {
  render(<VideoTextApp />);
  expect(await screen.findByText('Song A')).toBeInTheDocument();
  expect(screen.getByText('Video ready')).toBeInTheDocument();
  expect(screen.getByText('Rendering…')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Video Text' })).toBeInTheDocument();
});

it('opens a project, keeps ?p= in the URL, and goes back', async () => {
  render(<VideoTextApp />);
  fireEvent.click(await screen.findByRole('button', { name: /Song A/ }));
  expect(await screen.findByText('Editing Song A')).toBeInTheDocument();
  expect(window.location.search).toBe('?p=a');
  fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
  expect(await screen.findByText('Song B')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

it('reopens the project named in ?p= on load', async () => {
  window.history.replaceState(null, '', '/admin/video-text?p=a');
  render(<VideoTextApp />);
  expect(await screen.findByText('Editing Song A')).toBeInTheDocument();
});

it('New project asks for a name inline and opens it', async () => {
  render(<VideoTextApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Fresh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByText('Editing Fresh')).toBeInTheDocument();
  await waitFor(() => expect(window.location.search).toBe('?p=n'));
});
