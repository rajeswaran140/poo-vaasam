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
  it('describes Upload picture: free, JPEG or PNG, usable as the first frame, text may warp', () => {
    expect(text).toContain('Upload picture');
    expect(text).toMatch(/upload picture[^.]*JPEG or PNG/i);
    expect(text).toMatch(/for free/i);
    expect(text).toMatch(/Yours/);
    expect(text).toMatch(/text[^.]*(warp|scrambl)/i);
  });

  it('says a clip costs $0.08 a second whatever the mode, and names Raise budget', () => {
    expect(text).toMatch(/\$0\.08 a second, whatever the shot's mode/);
    expect(text).toContain('Raise budget');
  });

  it('says the first picture is chosen for you and a tap chooses another', () => {
    expect(text).toMatch(/first picture is chosen for you/i);
    expect(text).toMatch(/tap (another|a) picture to choose it/i);
    expect(text).not.toMatch(/choose the one to use|you choose which candidate to use/i);
  });

  it('describes Rename and Delete story, and that delete waits for a running draft or clip', () => {
    expect(text).toContain('Rename');
    expect(text).toContain('Delete story');
    expect(text).toContain('Wait for the draft to finish first.');
  });

  it('tells a phone user where Edit goes and where the bottom bar is', () => {
    expect(text).toMatch(/on a phone[^.]*Edit[^.]*shot panel/i);
    expect(text).toMatch(/on a phone[^.]*one-line summary/i);
  });

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
