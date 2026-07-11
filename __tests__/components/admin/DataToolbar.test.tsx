/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataToolbar } from '@/components/admin/DataToolbar';
import type { ExportColumn } from '@/lib/data-export';

interface Row {
  name: string;
  views: number;
}
const columns: ExportColumn<Row>[] = [
  { header: 'Name', get: (r) => r.name },
  { header: 'Views', get: (r) => r.views },
];
const rows: Row[] = [{ name: 'Appa Padal', views: 1200 }];

function renderToolbar(data: Row[] = rows) {
  return render(<DataToolbar title="Top songs" filename="top-songs" columns={columns} rows={data} />);
}

describe('DataToolbar', () => {
  it('renders nothing for an empty dataset', () => {
    const { container } = renderToolbar([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('copies a Markdown table to the clipboard for AI review', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderToolbar();

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain('### Top songs');
    expect(payload).toContain('| Name | Views |');
    expect(payload).toContain('| Appa Padal | 1200 |');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument());
  });

  it('downloads a CSV blob when CSV is clicked', async () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:csv');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('opens a printable window for PDF', async () => {
    const printWin = { document: { write: jest.fn(), close: jest.fn() }, focus: jest.fn(), print: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(printWin as unknown as Window);

    renderToolbar();
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));

    expect(open).toHaveBeenCalled();
    expect(printWin.document.write).toHaveBeenCalledTimes(1);
    expect(printWin.print).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
