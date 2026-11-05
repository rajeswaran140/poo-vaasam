/**
 * The Visual Story operator docs must match the UI (final review I1/I2/M2):
 * they promised reorder/rename/character-edit controls the studio lacks,
 * reference photos and negative prompts that do not reach stills, and free
 * refused pictures that are in fact charged. Both copies are checked.
 */
import fs from 'fs';
import path from 'path';
import { getDoc } from '@/content/admin-docs';

const adminDoc = getDoc('visual-story-studio-plan')!.body;
const guide = fs.readFileSync(path.join(process.cwd(), 'docs/VISUAL_STORY_STUDIO.md'), 'utf-8');

describe.each([
  ['admin doc', adminDoc],
  ['operator guide', guide],
])('%s', (_name, text) => {
  it('says plainly what the UI cannot do yet', () => {
    expect(text).toMatch(/no reorder/i);
    expect(text).toMatch(/scenes cannot be renamed/i);
    expect(text).toMatch(/characters cannot be edited or deleted/i);
    expect(text).not.toMatch(/rename, add, remove and reorder|add, rename, remove and reorder/i);
  });

  it('describes the delete buttons, the Budget field and the ~1-minute background draft', () => {
    expect(text).toContain('Delete shot');
    expect(text).toContain('Delete scene');
    expect(text).toContain('Budget');
    expect(text).toMatch(/about a minute/i);
  });

  it('does not over-promise: reference photos and the negative prompt do not affect stills yet', () => {
    expect(text).toMatch(/reference photos[^.]*stored for the later video phases[^.]*do not yet (influence|affect) still pictures/i);
    expect(text).toMatch(/negative prompt is not used for stills yet/i);
    expect(text).not.toMatch(/used to keep a character looking the same/i);
  });

  it('money copy: a refused picture is charged; the button label is "Generate still ($0.02)"', () => {
    expect(text).toContain('Generate still ($0.02)');
    expect(text).toMatch(/refused[^.]*is (still )?charged/i);
    expect(text).not.toMatch(/Failed pictures are free/i);
    expect(text).not.toMatch(/Press \*\*STILL\*\*/);
  });
});
