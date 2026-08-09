import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuetTagger } from '@/components/admin/DuetTagger';

// Pallavi repeats (→ chorus); two distinct verses.
const LYRICS = `பல்லவி ஒன்று\nபல்லவி இரண்டு\n\nசரணம் ஒன்று\n\nபல்லவி ஒன்று\nபல்லவி இரண்டு\n\nசரணம் இரண்டு`;

async function openPanel() {
  await userEvent.setup().click(screen.getByRole('button', { name: /duet mode/i }));
}

it('is collapsed by default', () => {
  render(<DuetTagger lyrics={LYRICS} />);
  expect(screen.queryByLabelText('SUNO-ready duet lyrics')).not.toBeInTheDocument();
});

it('prompts to paste lyrics when there are none', async () => {
  render(<DuetTagger lyrics="" />);
  await openPanel();
  expect(screen.getByText(/paste your lyrics/i)).toBeInTheDocument();
});

it('builds SUNO-ready tagged lyrics with a default duet assignment', async () => {
  render(<DuetTagger lyrics={LYRICS} />);
  await openPanel();
  const out = screen.getByLabelText('SUNO-ready duet lyrics') as HTMLTextAreaElement;
  // Kind-first grammar, matching what Raj actually pastes and what the SUNO
  // setup generator emits — one page, one format.
  expect(out.value).toContain('[Chorus - Male and Female Together]');
  expect(out.value).toContain('[Verse - Male Lead]');
  expect(out.value).toContain('[Verse - Female Lead]');
});

it('re-tags when a section voice is changed', async () => {
  const user = userEvent.setup();
  render(<DuetTagger lyrics={LYRICS} />);
  await user.click(screen.getByRole('button', { name: /duet mode/i }));
  // Section 1 is the first verse (male by default) → switch it to Female.
  await user.selectOptions(screen.getByLabelText('voice for section 2'), 'female');
  const out = screen.getByLabelText('SUNO-ready duet lyrics') as HTMLTextAreaElement;
  expect(out.value).not.toContain('[Verse - Male Lead]'); // both verses now female
});

it('warns when the assignment is a solo, not a duet', async () => {
  const user = userEvent.setup();
  // No repeats → all verses, default alternates male/female (valid duet) → make all male.
  render(<DuetTagger lyrics={'aaa\n\nbbb'} />);
  await user.click(screen.getByRole('button', { name: /duet mode/i }));
  await user.selectOptions(screen.getByLabelText('voice for section 2'), 'male'); // both male now
  expect(screen.getByText(/solo, not a duet/i)).toBeInTheDocument();
});
