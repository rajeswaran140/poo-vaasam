import { render, screen } from '@testing-library/react';
import KaraokeTermsPage, { metadata } from '@/app/karaoke/terms/page';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

describe('Karaoke licence — it must not go live by accident', () => {
  it('is noindex while it is a draft', () => {
    // A legal page that has not been reviewed must not be found, cited, or
    // relied on by a buyer. Removing this is a deliberate act after sign-off.
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('says on the page itself that it is a draft, not only in metadata', () => {
    render(<KaraokeTermsPage />);
    expect(screen.getByText(/Draft — not yet in force/i)).toBeInTheDocument();
  });
});

describe('Karaoke licence — the clauses a buyer relies on', () => {
  beforeEach(() => render(<KaraokeTermsPage />));

  it('states the licence is non-exclusive, so nobody assumes they bought it outright', () => {
    expect(screen.getByText(/non-exclusive/i)).toBeInTheDocument();
  });

  it('permits monetisation — the product is worthless to a creator without it', () => {
    expect(screen.getByText(/Earn money from that performance/i)).toBeInTheDocument();
  });

  it('requires credit, which is what pays for permitting monetisation', () => {
    expect(screen.getByText(/Music: TamilAgaval — tamilagaval\.com/)).toBeInTheDocument();
  });

  it('warns about automated copyright claims and promises to release them', () => {
    // The clause most likely to be omitted by a template, and the one most
    // likely to cause a refund demand if it is.
    expect(screen.getByText(/may receive an automatic claim/i)).toBeInTheDocument();
    expect(screen.getByText(/we will release the claim/i)).toBeInTheDocument();
  });

  it('excludes sync use, which is negotiated separately', () => {
    expect(screen.getByText(/film, advertisement, game/i)).toBeInTheDocument();
  });

  it('promises a full refund when WE cannot deliver', () => {
    // Stems are located per order, so non-delivery is the realistic failure.
    expect(screen.getByText(/full refund/i)).toBeInTheDocument();
  });

  it('discloses that production is AI-assisted', () => {
    expect(screen.getByText(/AI-assisted/i)).toBeInTheDocument();
  });
});
