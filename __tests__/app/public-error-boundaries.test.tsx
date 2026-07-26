/**
 * Root error boundaries for the PUBLIC site.
 *
 * Before these existed, only `(admin)/error.tsx` was present — so a runtime
 * error on a song or poem page fell through to Next's unbranded default screen.
 * The assertions that matter most are the negative ones: a visitor-facing error
 * page must not leak `error.message`, because it can carry internal detail and a
 * visitor can do nothing with it either way.
 */

import { readFileSync } from 'fs';
import { render, screen, fireEvent } from '@testing-library/react';
import PublicError from '@/app/error';
import GlobalError from '@/app/global-error';
import NotFound from '@/app/not-found';

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  return MockLink;
});

/** An error whose message would be embarrassing to render to a visitor. */
const makeError = () =>
  Object.assign(new Error('DynamoDB ValidationException: key CONTENT#secret'), {
    digest: 'abc123digest',
  });

describe('public error boundary (src/app/error.tsx)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  it('never renders the raw error message to a visitor', () => {
    render(<PublicError error={makeError()} reset={jest.fn()} />);

    expect(screen.queryByText(/DynamoDB/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ValidationException/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CONTENT#secret/)).not.toBeInTheDocument();
  });

  it('shows the digest so a reported failure can be matched to a server log', () => {
    render(<PublicError error={makeError()} reset={jest.fn()} />);

    expect(screen.getByText('abc123digest')).toBeInTheDocument();
  });

  it('omits the reference line entirely when there is no digest', () => {
    render(<PublicError error={new Error('boom')} reset={jest.fn()} />);

    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });

  it('offers recovery: retry calls reset(), and a link home', () => {
    const reset = jest.fn();
    render(<PublicError error={makeError()} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/');
  });

  it('addresses the visitor in the respectful Tamil register', () => {
    render(<PublicError error={makeError()} reset={jest.fn()} />);

    // -உங்கள் imperative, not the familiar bare stem.
    expect(screen.getByText(/மீண்டும் முயற்சியுங்கள்/)).toBeInTheDocument();
    expect(screen.getByText(/முகப்புக்குச் செல்லுங்கள்/)).toBeInTheDocument();
  });

  it('logs the error so it is still diagnosable server-side', () => {
    const error = makeError();
    render(<PublicError error={error} reset={jest.fn()} />);

    expect(console.error).toHaveBeenCalledWith('[public] unhandled error:', error);
  });
});

describe('global error boundary (src/app/global-error.tsx)', () => {
  it('renders its own html/body, since it replaces the failed root layout', () => {
    // Asserted against the source rather than the DOM: React cannot mount
    // <html>/<body> into Testing Library's container div, so a render-based
    // check would fail even though the component is correct. The requirement is
    // structural — global-error owns the whole document — so check it directly.
    const src = readFileSync('src/app/global-error.tsx', 'utf-8');
    expect(src).toMatch(/<html\b/);
    expect(src).toMatch(/<body\b/);
  });

  it('does not leak the error message either', () => {
    render(<GlobalError error={makeError()} reset={jest.fn()} />);

    expect(screen.queryByText(/DynamoDB/)).not.toBeInTheDocument();
  });

  it('still offers a retry', () => {
    const reset = jest.fn();
    render(<GlobalError error={makeError()} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('depends on nothing from the root layout (no font/provider imports)', () => {
    // A global-error that imported the layout's providers would itself throw in
    // exactly the situation it exists to handle. Inline styles only.
    const src = readFileSync('src/app/global-error.tsx', 'utf-8');
    expect(src).not.toMatch(/from '@\/components\//);
    expect(src).not.toMatch(/next\/font/);
  });
});

describe('not-found page (src/app/not-found.tsx)', () => {
  it('is marked noindex so it cannot compete with real pages in search', async () => {
    const { metadata } = await import('@/app/not-found');
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it('routes the visitor somewhere useful instead of dead-ending', () => {
    render(<NotFound />);

    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual(expect.arrayContaining(['/songs', '/poems', '/videos', '/']));
  });

  it('uses the respectful register', () => {
    render(<NotFound />);
    expect(screen.getByText(/முகப்புக்குச் செல்லுங்கள்/)).toBeInTheDocument();
  });
});
