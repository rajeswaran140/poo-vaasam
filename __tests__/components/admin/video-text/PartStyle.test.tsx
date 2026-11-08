/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('@/lib/video-text/google-font-loader', () => {
  const actual = jest.requireActual('@/lib/video-text/google-font-loader');
  return { ...actual, loadGoogleFont: jest.fn(async () => '"x"'), loadGoogleFontPreview: jest.fn(async () => '"x"') };
});
import { loadGoogleFont } from '@/lib/video-text/google-font-loader';
import { PartStyle } from '@/components/admin/video-text/PartStyle';
import { googleFontMatches } from '@/components/admin/video-text/GoogleFontSearch';
import { GOOGLE_FONTS } from '@/lib/video-text/google-fonts';
import type { TrackStyle } from '@/types/videoText';

const base: Required<TrackStyle> = { size: 1, heightPct: 7.5, offset: { x: 0, y: 0 }, tamilFont: 'noto-sans-tamil', englishFont: 'plain', color: 'white', box: false, fade: false };

function setup(value: Partial<Required<TrackStyle>> = {}) {
  const onChange = jest.fn();
  render(<PartStyle label="Title" value={{ ...base, ...value }} onChange={onChange} position={null} />);
  return { onChange };
}

it('the Tamil font menu adds the Google fonts with Tamil, without repeating the built-in ones', () => {
  const { onChange } = setup();
  const select = screen.getByLabelText('Tamil font') as HTMLSelectElement;
  const google = within(select.querySelector('optgroup[label="Google fonts"]') as HTMLElement).getAllByRole('option');
  const names = google.map((o) => o.textContent);
  expect(names).toEqual(expect.arrayContaining(['Pavanam', 'Hind Madurai', 'Catamaran']));
  expect(names).not.toContain('Arima'); // built in already
  expect(names).not.toContain('Lobster'); // no Tamil
  fireEvent.change(select, { target: { value: 'g:Pavanam' } });
  expect(onChange).toHaveBeenCalledWith({ tamilFont: 'g:Pavanam' });
});

it('More fonts… searches every Google font with English letters and picks one', () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'More fonts…' }));
  fireEvent.change(screen.getByLabelText('Search Google fonts'), { target: { value: 'lobs' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lobster' }));
  expect(onChange).toHaveBeenCalledWith({ englishFont: 'g:Lobster' });
});

it('a chosen Google font loads for the sample, and shows in the English menu', () => {
  setup({ tamilFont: 'g:Pavanam', englishFont: 'g:Lobster' });
  expect(loadGoogleFont).toHaveBeenCalledWith(expect.objectContaining({ family: 'Pavanam' }), 'tamil');
  expect(loadGoogleFont).toHaveBeenCalledWith(expect.objectContaining({ family: 'Lobster' }), 'latin');
  expect((screen.getByLabelText('English font') as HTMLSelectElement).value).toBe('g:Lobster');
  expect(screen.getByTestId('sample-Title').style.fontFamily).toContain('vt-g-latin-lobster');
});

it('a Google font that will not load says so', async () => {
  (loadGoogleFont as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  setup({ englishFont: 'g:Lobster' });
  expect(await screen.findByRole('alert')).toHaveTextContent('This Google font did not load');
});

it('search: names that start with the words come first; kind narrows it; at most 12', () => {
  const r = googleFontMatches('ro', '');
  expect(r.length).toBeLessThanOrEqual(12);
  expect(r[0].family.toLowerCase().startsWith('ro')).toBe(true);
  expect(googleFontMatches('', 'h').every((f) => f.category === 'h')).toBe(true);
  expect(googleFontMatches('zzzz', '')).toEqual([]);
  expect(googleFontMatches('', '', GOOGLE_FONTS).length).toBe(12);
});

describe('size 1–100% of the video height, and moving by hand', () => {
  it('the slider and the number box run 1 to 100 and set heightPct', () => {
    const { onChange } = setup();
    const slider = screen.getByLabelText('Size');
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '100');
    fireEvent.change(slider, { target: { value: '42.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ heightPct: 42.5 });
    const box = screen.getByLabelText("Title size, % of the video's height");
    expect(box).toHaveValue(7.5);
    fireEvent.change(box, { target: { value: '150' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ heightPct: 100 });
    fireEvent.change(box, { target: { value: '0.2' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ heightPct: 1 });
  });
  it('the move boxes set the offset as a share of the frame, and Reset to aligned clears it', () => {
    const { onChange } = setup({ offset: { x: 0.1, y: -0.05 } });
    const right = screen.getByLabelText("Title: move right, % of the video's width");
    expect(right).toHaveValue(10);
    expect(screen.getByLabelText("Title: move down, % of the video's height")).toHaveValue(-5);
    fireEvent.change(right, { target: { value: '-12.5' } });
    fireEvent.keyDown(right, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ offset: { x: -0.125, y: -0.05 } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to aligned' }));
    expect(onChange).toHaveBeenLastCalledWith({ offset: { x: 0, y: 0 } });
  });
  it('an aligned part has no Reset button', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Reset to aligned' })).toBeNull();
  });
  it('a typed non-number is dropped, Escape puts the value back', () => {
    const { onChange } = setup();
    const right = screen.getByLabelText("Title: move right, % of the video's width");
    fireEvent.change(right, { target: { value: '' } });
    fireEvent.blur(right);
    fireEvent.change(right, { target: { value: '30' } });
    fireEvent.keyDown(right, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(right).toHaveValue(0);
  });
});
