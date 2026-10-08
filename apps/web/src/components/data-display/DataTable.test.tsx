import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { DataTable, type DataTableColumn } from './DataTable';
import { useClientPagination } from './useClientPagination';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Nama', cell: (row) => row.name },
  { id: 'amount', header: 'Jumlah', align: 'end', cell: (row) => row.amount },
];
const rows: Row[] = [
  { id: 'a', name: 'Alpha', amount: 7 },
  { id: 'b', name: 'Beta', amount: 9 },
];

const many: Row[] = Array.from({ length: 23 }, (_, index) => ({
  id: `r${index + 1}`,
  name: `Baris ${index + 1}`,
  amount: index + 1,
}));

function PagedTable({ source = many }: { source?: Row[] }) {
  const { pageRows, pagination } = useClientPagination(source);
  return (
    <DataTable
      caption="Contoh"
      columns={columns}
      rows={pageRows}
      rowKey={(r) => r.id}
      pagination={pagination}
    />
  );
}

const firstCells = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

describe('DataTable', () => {
  it('renders a named table with aligned columns', () => {
    renderWithIntl(
      <DataTable caption="Contoh" columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    const table = screen.getByRole('table', { name: 'Contoh' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['No.', 'Nama', 'Jumlah']);
    expect(within(table).getByText('9').className).toContain('text-right');
  });

  it('adds a card list for phones when a mobile layout is given', () => {
    renderWithIntl(
      <DataTable
        caption="Contoh"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        mobileCard={(row) => <span>card {row.name}</span>}
      />,
    );
    const cards = screen.getByRole('list', { name: 'Contoh' });
    expect(within(cards).getAllByRole('listitem')).toHaveLength(2);
    expect(cards.className).toContain('md:hidden');
  });

  it('shows the empty state instead of an empty table', () => {
    renderWithIntl(
      <DataTable
        caption="Contoh"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<p>Kosong</p>}
      />,
    );
    expect(screen.getByText('Kosong')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows loading skeleton rows and an error in place of the rows', () => {
    const { rerender } = renderWithIntl(
      <DataTable caption="Contoh" columns={columns} rows={[]} rowKey={(r) => r.id} loading />,
    );
    expect(screen.getByRole('table').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    rerender(
      <DataTable
        caption="Contoh"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        error="Gagal memuat"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Gagal memuat');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('pages a whole list 10 rows at a time with numbering that continues across pages', () => {
    renderWithIntl(<PagedTable />);
    expect(firstCells()).toHaveLength(10);
    expect(firstCells()[0]).toBe('1');
    expect(screen.getByText('1–10 dari 23')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Halaman 2' }));
    expect(firstCells()[0]).toBe('11');
    expect(firstCells().at(-1)).toBe('20');

    fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }));
    expect(firstCells()).toEqual(['21', '22', '23']);
    expect(screen.getByRole('button', { name: 'Berikutnya' })).toHaveProperty('disabled', true);
  });

  it('returns to page 1 when the page size changes', () => {
    renderWithIntl(<PagedTable />);
    fireEvent.click(screen.getByRole('button', { name: 'Halaman 3' }));
    const select = screen.getByLabelText('Tampilkan') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['10', '25', '50', '100']);
    fireEvent.change(select, { target: { value: '25' } });
    expect(firstCells()).toHaveLength(23);
    expect(firstCells()[0]).toBe('1');
    expect(screen.getByText('1–23 dari 23')).toBeTruthy();
  });
});
