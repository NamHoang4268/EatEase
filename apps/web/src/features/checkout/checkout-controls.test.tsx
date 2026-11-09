import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutControls } from './checkout-controls';

const session = { id: 'session-1', status: 'ACTIVE' as const, version: 2 };
const bill = { status: 'OPEN', version: 4 };
const response = (status = 200, code?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (code ? { error: { code } } : { data: {} }),
});
function props() {
  return {
    actor: 'guest' as const,
    session,
    bill,
    csrfToken: 'csrf',
    recoverCsrf: vi.fn().mockResolvedValue('recovered'),
    refresh: vi.fn().mockResolvedValue(undefined),
    onSessionInvalid: vi.fn(),
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M4.1 checkout controls', () => {
  it('submits both versions through authenticated same-origin POST and refreshes confirmed state', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const p = props();
    render(<CheckoutControls {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
    await screen.findByText('Đã khóa gọi món để chờ thanh toán.');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/table-sessions/current/checkout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ expectedSessionVersion: 2, expectedBillVersion: 4 }),
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
      }),
    );
    expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503, 504, 'network'] as const)(
    'retains the exact key/body after %s and a newer REST response',
    async (status) => {
      const fetch = vi.fn();
      if (status === 'network') fetch.mockRejectedValueOnce(new Error('network'));
      else fetch.mockResolvedValueOnce(response(status));
      fetch.mockResolvedValue(response());
      vi.stubGlobal('fetch', fetch);
      const p = props();
      const view = render(<CheckoutControls {...p} />);
      fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
      await screen.findByRole('status');
      view.rerender(
        <CheckoutControls
          {...p}
          session={{ ...session, version: 3 }}
          bill={{ ...bill, version: 5 }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
      await waitFor(() => expect(p.refresh).toHaveBeenCalledTimes(1));
      expect(fetch.mock.calls[1]![1]).toEqual(fetch.mock.calls[0]![1]);
    },
  );

  it('recovers CSRF using the same operation key and blocks double clicks', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    const p = props();
    render(<CheckoutControls {...p} />);
    const button = screen.getByRole('button', { name: 'Yêu cầu thanh toán' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(response(403, 'GUEST_CSRF_INVALID'));
    await waitFor(() => expect(p.refresh).toHaveBeenCalledTimes(1));
    const first = fetch.mock.calls[0]![1] as RequestInit;
    const second = fetch.mock.calls[1]![1] as RequestInit;
    expect(second.body).toBe(first.body);
    expect(second.headers).toEqual({ ...first.headers, 'X-CSRF-Token': 'recovered' });
  });

  it('refetches on 409 and starts a new attempt only after a definitive conflict', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(409, 'CHECKOUT_VERSION_CONFLICT'))
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const p = props();
    const view = render(<CheckoutControls {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
    await screen.findByText(/Trạng thái hoặc phiên bản/);
    view.rerender(<CheckoutControls {...p} session={{ ...session, version: 5 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((fetch.mock.calls[1]![1] as RequestInit).body).toContain('"expectedSessionVersion":5');
    expect((fetch.mock.calls[1]![1] as RequestInit).headers).not.toEqual(
      (fetch.mock.calls[0]![1] as RequestInit).headers,
    );
  });

  it('retains the operation after CSRF recovery fails and offers a safe retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(403, 'GUEST_CSRF_INVALID'))
      .mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const p = props();
    p.recoverCsrf.mockRejectedValueOnce(new Error('recovery unavailable'));
    render(<CheckoutControls {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
    await screen.findByText(/Kết nối bị gián đoạn/);
    expect(p.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yêu cầu thanh toán' }));
    await waitFor(() => expect(p.refresh).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[1]![1]).toEqual(fetch.mock.calls[0]![1]);
  });

  it('allows only staff resume and calls session recovery on 401', async () => {
    const p = props();
    const view = render(
      <CheckoutControls
        {...p}
        session={{ ...session, status: 'CHECKOUT_LOCKED' }}
        bill={{ ...bill, status: 'PAYMENT_PENDING' }}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    const fetch = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal('fetch', fetch);
    view.rerender(
      <CheckoutControls
        {...p}
        actor="staff"
        session={{ ...session, status: 'CHECKOUT_LOCKED' }}
        bill={{ ...bill, status: 'PAYMENT_PENDING' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mở lại gọi món' }));
    await waitFor(() => expect(p.onSessionInvalid).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/staff/table-sessions/session-1/resume-ordering');
    expect(p.refresh).not.toHaveBeenCalled();
  });
});
