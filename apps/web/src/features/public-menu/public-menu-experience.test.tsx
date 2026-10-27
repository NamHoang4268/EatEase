import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicMenuExperience } from './public-menu-experience';

const tableResponse = {
  data: {
    publicId: '31000000-0000-4000-8000-000000000001',
    restaurantName: 'Bếp Mây Demo',
    locationName: 'Chi nhánh Demo',
    tableLabel: 'A01',
    capacity: 2,
    availability: 'AVAILABLE',
  },
};

const menuResponse = {
  data: {
    currency: 'VND',
    categories: [
      {
        id: 'category-1',
        name: 'Món Việt',
        items: [
          {
            id: 'item-1',
            name: 'Cơm gà lá chanh',
            description: 'Cơm thơm và gà áp chảo.',
            priceAmount: '79000',
            currency: 'VND',
            fulfillmentStation: 'KITCHEN',
            available: true,
          },
        ],
      },
    ],
  },
};

function mockResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

function mockSuccessfulLoad() {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(mockResponse(tableResponse))
      .mockResolvedValueOnce(mockResponse(menuResponse)),
  );
}

describe('PublicMenuExperience', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads table/menu context and keeps draft cart state across views', async () => {
    mockSuccessfulLoad();
    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);

    expect(screen.getByText('Đang mở thực đơn…')).toBeDefined();
    expect(await screen.findByText('Bếp Mây Demo')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm Cơm gà lá chanh vào giỏ nháp' }));
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));

    expect(screen.getByRole('heading', { name: 'Giỏ nháp của bạn' })).toBeDefined();
    expect(screen.getByLabelText('Số lượng hiện tại: 1')).toBeDefined();
    expect(screen.getAllByText(/79\.000/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Tăng Cơm gà lá chanh' }));
    expect(screen.getByLabelText('Số lượng hiện tại: 2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm món khác' }));
    fireEvent.click(screen.getByRole('button', { name: /Giỏ nháp/ }));
    expect(screen.getByLabelText('Số lượng hiện tại: 2')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(screen.getByText('Giỏ nháp đang trống')).toBeDefined();
  });

  it('shows a safe invalid-table state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse({ error: {} }, 404))
        .mockResolvedValueOnce(mockResponse({ error: {} }, 404)),
    );

    render(<PublicMenuExperience publicId="unknown" />);
    expect(await screen.findByText('Mã QR này không còn hợp lệ')).toBeDefined();
  });

  it('shows empty and API-error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse(tableResponse))
        .mockResolvedValueOnce(mockResponse({ data: { currency: 'VND', categories: [] } })),
    );
    const { unmount } = render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    expect(await screen.findByText('Thực đơn đang được cập nhật')).toBeDefined();
    unmount();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(mockResponse({ error: {} }, 503))
        .mockResolvedValueOnce(mockResponse({ error: {} }, 503)),
    );
    render(<PublicMenuExperience publicId={tableResponse.data.publicId} />);
    await waitFor(() => expect(screen.getByText('Chưa thể tải thực đơn')).toBeDefined());
  });
});
