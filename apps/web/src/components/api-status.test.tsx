import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiStatus } from './api-status';

describe('ApiStatus', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reports an available API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<ApiStatus />);
    expect(screen.getByText('API: checking')).toBeDefined();
    await waitFor(() => expect(screen.getByText('API: available')).toBeDefined());
  });
});
