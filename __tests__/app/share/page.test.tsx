import { render, screen } from '@testing-library/react';
import SharePage, { metadata } from '@/app/share/page';

describe('/share page', () => {
  it('renders the H1 invitation heading', () => {
    render(<SharePage />);
    expect(screen.getByRole('heading', { level: 1, name: /உங்கள் கதை/ })).toBeInTheDocument();
  });

  it('renders the StoryForm submit CTA', () => {
    render(<SharePage />);
    expect(screen.getByRole('button', { name: /பகிருங்கள்/ })).toBeInTheDocument();
  });

  it('uses the RESPECTFUL register in visitor copy (பகிருங்கள், never பகிர் alone)', () => {
    const { container } = render(<SharePage />);
    const text = container.textContent || '';
    expect(text).toContain('பகிருங்கள்');
  });
});

describe('/share page — metadata', () => {
  it('sets a canonical of /share', () => {
    expect(metadata.alternates?.canonical).toBe('/share');
  });

  it('is indexable (a public campaign entry point)', () => {
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('has a Tamil title', () => {
    expect(String(metadata.title)).toContain('கதை');
  });
});
