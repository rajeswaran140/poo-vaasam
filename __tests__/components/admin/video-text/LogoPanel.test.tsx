/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { LogoPanel } from '@/components/admin/video-text/LogoPanel';
import type { LogoState } from '@/components/admin/video-text/useSavedLogo';
import type { TextStyle } from '@/types/videoText';

const base: TextStyle = { sizeScale: 1, lyricPosition: 'lower' };
const ready: LogoState = {
  kind: 'ready',
  logo: { key: 'k', contentType: 'image/png', width: 10, height: 10, uploadedAt: '', url: 'https://s3/logo' },
  image: { image: {} as never, width: 10, height: 10, key: 'k' },
};
const setup = (style: TextStyle, logo: LogoState = ready) => {
  const onChange = jest.fn();
  const onUpload = jest.fn();
  render(<LogoPanel style={style} onChange={onChange} logo={logo} onUpload={onUpload} uploading={false} uploadError={null} />);
  return { onChange, onUpload };
};

it('with no saved logo: only the upload button, which hands the file over', () => {
  const { onUpload } = setup(base, { kind: 'none' });
  expect(screen.getByRole('button', { name: 'Upload logo…' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Show the logo on this video')).not.toBeInTheDocument();
  const file = new File(['x'], 'logo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Upload logo'), { target: { files: [file] } });
  expect(onUpload).toHaveBeenCalledWith(file);
});

it('a saved logo: thumbnail, Replace, and the switch; settings appear only when shown', () => {
  const { onChange } = setup(base);
  expect(screen.getByTestId('logo-thumb')).toHaveAttribute('src', 'https://s3/logo');
  expect(screen.getByRole('button', { name: 'Replace logo…' })).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: 'Logo corner' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Show the logo on this video'));
  expect(onChange).toHaveBeenCalledWith({ show: true });
});

it('when shown: defaults bottom right, 10% high, 80% opacity; a corner clears the hand move', () => {
  const { onChange } = setup({ ...base, logo: { show: true, offset: { x: 0.1, y: 0 } } });
  expect(screen.getByRole('radio', { name: 'Bottom right' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText("Logo size, % of the video's height")).toHaveValue(10);
  expect(screen.getByLabelText('Logo opacity, %')).toHaveValue(80);
  expect(screen.getByLabelText("Logo: move right, % of the video's width")).toHaveValue(10);
  fireEvent.click(screen.getByRole('radio', { name: 'Top left' }));
  expect(onChange).toHaveBeenLastCalledWith({ corner: 'top-left', offset: { x: 0, y: 0 } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset to corner' }));
  expect(onChange).toHaveBeenLastCalledWith({ offset: { x: 0, y: 0 } });
});

it('size and opacity boxes commit typed numbers in range', () => {
  const { onChange } = setup({ ...base, logo: { show: true } });
  const size = screen.getByLabelText("Logo size, % of the video's height");
  fireEvent.change(size, { target: { value: '150' } });
  fireEvent.keyDown(size, { key: 'Enter' });
  expect(onChange).toHaveBeenLastCalledWith({ heightPct: 100 });
  const op = screen.getByLabelText('Logo opacity, %');
  fireEvent.change(op, { target: { value: '45' } });
  fireEvent.blur(op);
  expect(onChange).toHaveBeenLastCalledWith({ opacity: 0.45 });
});
