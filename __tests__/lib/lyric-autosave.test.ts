import {
  shouldAutosave,
  autosaveStatus,
  autosaveLabel,
  shouldOfferRestore,
  isRedundantVersion,
  AUTOSAVE_DEBOUNCE_MS,
} from '@/lib/lyric-autosave';

const base = { draftId: 'draft_1', text: 'பல்லவி', savedWorking: null, saving: false };

describe('shouldAutosave', () => {
  it('fires when text differs from the saved working copy', () => {
    expect(shouldAutosave(base)).toBe(true);
    expect(shouldAutosave({ ...base, savedWorking: 'பல்லவி' })).toBe(false);
  });

  it('never fires for a draft that does not exist yet', () => {
    // Autosaving a new draft would have to invent a title; creation stays explicit.
    expect(shouldAutosave({ ...base, draftId: null })).toBe(false);
  });

  it('never fires while a save is already in flight', () => {
    expect(shouldAutosave({ ...base, saving: true })).toBe(false);
  });

  it('never fires on empty or whitespace-only text', () => {
    expect(shouldAutosave({ ...base, text: '' })).toBe(false);
    expect(shouldAutosave({ ...base, text: '   \n  ' })).toBe(false);
  });

  it('treats a null saved working copy as empty rather than crashing', () => {
    expect(shouldAutosave({ ...base, text: 'x', savedWorking: null })).toBe(true);
  });
});

describe('autosaveStatus', () => {
  it('reports dirty, then saved', () => {
    expect(autosaveStatus(base)).toBe('dirty');
    expect(autosaveStatus({ ...base, savedWorking: 'பல்லவி' })).toBe('saved');
  });

  it('reports saving while in flight, and error over everything', () => {
    expect(autosaveStatus({ ...base, saving: true })).toBe('saving');
    expect(autosaveStatus({ ...base, saving: true }, true)).toBe('error');
  });

  it('stays clean for an unsaved new draft so the indicator is not alarming', () => {
    expect(autosaveStatus({ ...base, draftId: null })).toBe('clean');
  });
});

describe('autosaveLabel', () => {
  it('reassures rather than alarms when a save fails', () => {
    expect(autosaveLabel('error')).toMatch(/still here/i);
  });

  it('is empty for clean so nothing renders', () => {
    expect(autosaveLabel('clean')).toBe('');
  });
});

describe('shouldOfferRestore', () => {
  it('offers only when the working copy actually differs from the last version', () => {
    expect(shouldOfferRestore('new lines', 'old lines')).toBe(true);
    expect(shouldOfferRestore('same', 'same')).toBe(false);
  });

  it('does not offer when there is no working copy', () => {
    expect(shouldOfferRestore(undefined, 'anything')).toBe(false);
    expect(shouldOfferRestore(null, 'anything')).toBe(false);
    expect(shouldOfferRestore('', 'anything')).toBe(false);
  });

  it('ignores leading/trailing whitespace but NOT internal line breaks', () => {
    // A trailing newline is not worth interrupting for.
    expect(shouldOfferRestore('  same\n', 'same')).toBe(false);
    // Internal line breaks separate பல்லவி from சரணம் — a real change.
    expect(shouldOfferRestore('a\n\nb', 'a\nb')).toBe(true);
  });
});

describe('isRedundantVersion', () => {
  it('flags text identical to the latest version', () => {
    expect(isRedundantVersion('lines', 'lines')).toBe(true);
    expect(isRedundantVersion('lines ', '  lines')).toBe(true);
    expect(isRedundantVersion('new', 'lines')).toBe(false);
  });

  it('is never redundant when there is no version yet', () => {
    expect(isRedundantVersion('anything', null)).toBe(false);
  });
});

describe('AUTOSAVE_DEBOUNCE_MS', () => {
  it('is long enough for Tamil transliteration to commit a word', () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(1500);
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThanOrEqual(5000);
  });
});
