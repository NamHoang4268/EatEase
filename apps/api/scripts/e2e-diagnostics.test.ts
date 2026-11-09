import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { spawnSync } from 'node:child_process';
import type { BrowserContext, Request } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import {
  closeObservedContext,
  expectedRequestFailure,
  observeContext,
} from '../e2e/network-diagnostics.js';
import { errorSummary, HttpDiagnostics, safeUrl } from '../e2e/server-diagnostics.js';

describe('opt-in E2E network diagnostics', () => {
  it('strips credentials, query values and fragments from logged URLs', () => {
    expect(safeUrl('http://user:secret@localhost:3100/api/v1/orders?token=secret#secret')).toBe(
      'http://localhost:3100/api/v1/orders',
    );
    expect(safeUrl('/api/v1/orders?csrf=secret')).toBe('/api/v1/orders');
    expect(safeUrl('http://[')).toBe('[invalid URL]');
  });

  it('retains exception code and stack frames without arbitrary error-message data', () => {
    const error = Object.assign(new Error('secret credential'), { code: 'ECONNRESET' });
    const summary = errorSummary(error);
    expect(summary.code).toBe('ECONNRESET');
    expect(summary.frames?.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toContain('secret credential');
  });

  it('adds no browser listeners when diagnostics are disabled', async () => {
    const context = Object.assign(new EventEmitter(), {
      close: vi.fn().mockResolvedValue(undefined),
    });
    const write = vi.fn();
    observeContext(context as unknown as BrowserContext, 'disabled', false, write);
    await closeObservedContext(context as unknown as BrowserContext);
    expect(context.eventNames()).toHaveLength(0);
    expect(context.close).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('distinguishes active failures, pending close requests and intentional fault injection', async () => {
    const write = vi.fn();
    const request = (path: string) =>
      ({
        method: () => 'POST',
        url: () => `http://localhost:3100${path}?token=secret`,
        resourceType: () => 'fetch',
        failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      }) as unknown as Request;
    const first = request('/api/v1/orders'),
      pending = request('/api/v1/staff/realtime/tickets');
    const context = Object.assign(new EventEmitter(), {
      close: vi.fn().mockImplementation(() => {
        context.emit('requestfailed', pending);
        context.emit('close');
        return Promise.resolve();
      }),
    });
    const browserContext = context as unknown as BrowserContext;
    observeContext(browserContext, 'test-context', true, write);
    context.emit('request', first);
    expectedRequestFailure(browserContext, first, 'injected lost response');
    context.emit('requestfailed', first);
    context.emit('request', pending);
    await closeObservedContext(browserContext);
    expect(write).toHaveBeenCalledWith(
      'requestfailed',
      expect.objectContaining({
        phase: 'active',
        url: 'http://localhost:3100/api/v1/orders',
        expected: 'injected lost response',
      }),
    );
    expect(write).toHaveBeenCalledWith(
      'requestfailed',
      expect.objectContaining({
        phase: 'closing',
        url: 'http://localhost:3100/api/v1/staff/realtime/tickets',
      }),
    );
    expect(write).toHaveBeenCalledWith(
      'context-close-begin',
      expect.objectContaining({
        unfinalizedRequests: [
          expect.objectContaining({
            request: 2,
            method: 'POST',
            url: 'http://localhost:3100/api/v1/staff/realtime/tickets',
            elapsedMs: expect.any(Number) as unknown,
            completion: 'awaiting-response-headers',
          }),
        ],
      }),
    );
    expect(write).toHaveBeenCalledWith(
      'context-closed',
      expect.objectContaining({ phase: 'closed', unfinalizedRequests: [] }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toContain('token=secret');
  });

  it('observes incomplete server responses without installing any stream error handler', () => {
    const request = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/api/v1/table-sessions/current?secret=hidden',
      socket: new EventEmitter(),
    });
    const response = Object.assign(new EventEmitter(), { writableFinished: false });
    const write = vi.fn();
    const observer = new HttpDiagnostics(write);
    observer.start(request as unknown as IncomingMessage, response as unknown as ServerResponse);
    expect(request.listenerCount('error')).toBe(0);
    expect(response.listenerCount('error')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
    request.emit('aborted');
    request.socket.emit('close');
    expect(write).toHaveBeenCalledWith(
      'server-request-aborted',
      expect.objectContaining({ method: 'GET', url: '/api/v1/table-sessions/current' }),
    );
    expect(write).toHaveBeenCalledWith(
      'server-response-closed-incomplete',
      expect.objectContaining({ method: 'GET', url: '/api/v1/table-sessions/current' }),
    );
    write.mockClear();
    const finished = Object.assign(new EventEmitter(), { writableFinished: true });
    observer.start(request as unknown as IncomingMessage, finished as unknown as ServerResponse);
    request.socket.emit('close');
    expect(write).not.toHaveBeenCalled();
    expect(request.listenerCount('aborted')).toBe(0);
    expect(request.socket.listenerCount('close')).toBe(0);
  });

  it('is idempotent and never increases ServerResponse listener counts', () => {
    const socket = new EventEmitter();
    const request = Object.assign(new EventEmitter(), { method: 'GET', url: '/', socket });
    const response = Object.assign(new EventEmitter(), { writableFinished: false });
    // Simulate a framework response already at the normal listener threshold.
    for (let i = 0; i < 10; i++) response.on('close', () => undefined);
    const observer = new HttpDiagnostics(vi.fn());
    for (let i = 0; i < 100; i++) {
      observer.start(request as unknown as IncomingMessage, response as unknown as ServerResponse);
    }
    expect(response.listenerCount('close')).toBe(10);
    expect(request.listenerCount('aborted')).toBe(1);
    expect(socket.listenerCount('close')).toBe(1);
    observer.finish(response as unknown as ServerResponse);
    observer.finish(response as unknown as ServerResponse);
    expect(socket.listenerCount('close')).toBe(0);
    expect(request.listenerCount('aborted')).toBe(0);
  });

  it('bounds socket listeners across concurrent responses and cleans up normal completion', () => {
    const socket = new EventEmitter();
    const observer = new HttpDiagnostics(vi.fn());
    const responses = Array.from({ length: 30 }, () => {
      const request = Object.assign(new EventEmitter(), { socket: socket as unknown as Socket });
      const response = new EventEmitter();
      observer.start(request as unknown as IncomingMessage, response as unknown as ServerResponse);
      expect(response.eventNames()).toHaveLength(0);
      return { request, response };
    });
    expect(socket.listenerCount('close')).toBe(1);
    for (const { request, response } of responses) {
      observer.finish(response as unknown as ServerResponse);
      expect(request.listenerCount('aborted')).toBe(0);
    }
    expect(socket.listenerCount('close')).toBe(0);
  });

  it('distinguishes received headers from missing terminal events without claiming server activity', async () => {
    const write = vi.fn();
    const context = Object.assign(new EventEmitter(), {
      close: () => {
        context.emit('close');
        return Promise.resolve();
      },
    });
    const request = {
      method: () => 'POST',
      url: () => 'http://localhost:3100/api/v1/staff/orders',
      resourceType: () => 'fetch',
    } as unknown as Request;
    observeContext(context as unknown as BrowserContext, 'headers-test', true, write);
    context.emit('request', request);
    context.emit('response', { request: () => request, status: () => 200 });
    await closeObservedContext(context as unknown as BrowserContext);
    expect(write).toHaveBeenCalledWith(
      'context-closed',
      expect.objectContaining({
        unfinalizedRequests: [
          expect.objectContaining({
            responseStatus: 200,
            completion: 'headers-received-without-terminal-event',
          }),
        ],
      }),
    );
    // Late teardown events must not be mistaken for a new network failure.
    context.emit('requestfinished', request);
  });

  it('records WebSocket closure and removes completed requests from the close snapshot', async () => {
    const write = vi.fn();
    const context = Object.assign(new EventEmitter(), {
      close: () => {
        context.emit('close');
        return Promise.resolve();
      },
    });
    const page = new EventEmitter();
    const socket = Object.assign(new EventEmitter(), {
      url: () => 'ws://127.0.0.1:3101/socket.io/?ticket=synthetic',
    });
    const request = {
      method: () => 'GET',
      url: () => 'http://localhost:3100/api/v1/staff/auth/me',
      resourceType: () => 'fetch',
    } as unknown as Request;
    observeContext(context as unknown as BrowserContext, 'socket-test', true, write);
    context.emit('page', page);
    page.emit('websocket', socket);
    context.emit('request', request);
    context.emit('requestfinished', request);
    socket.emit('close');
    await closeObservedContext(context as unknown as BrowserContext);
    expect(write).toHaveBeenCalledWith(
      'websocket-close',
      expect.objectContaining({ url: 'ws://127.0.0.1:3101/socket.io/' }),
    );
    expect(write).toHaveBeenCalledWith(
      'context-close-begin',
      expect.objectContaining({ unfinalizedRequests: [], webSocketsWithoutCloseEvent: 0 }),
    );
    expect(JSON.stringify(write.mock.calls)).not.toContain('ticket=synthetic');
  });

  it('captures a real loopback HTTP response abort through the native Node diagnostic channel', () => {
    const moduleUrl = new URL('../e2e/server-diagnostics.ts', import.meta.url).href;
    const probe = `
      const http = require('node:http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Length': 100 });
        res.write('x');
      });
      server.listen(0, '127.0.0.1', () => {
        http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/diagnostic?csrf=synthetic' }, res => {
          res.once('data', () => { res.destroy(); server.close(); });
        });
      });
    `;
    const result = spawnSync(process.execPath, ['--import', moduleUrl, '--eval', probe], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, EATEASE_E2E_SERVER_DIAGNOSTICS: '1' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server-response-closed-incomplete');
    expect(result.stdout).toContain('/api/v1/diagnostic');
    expect(result.stdout).not.toContain('csrf=synthetic');
  });

  it('preloads in native Node and preserves a nonzero exit for an uncaught exception', () => {
    const moduleUrl = new URL('../e2e/server-diagnostics.ts', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        moduleUrl,
        '--eval',
        "throw Object.assign(new Error('aborted'), { code: 'ECONNRESET' })",
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, EATEASE_E2E_SERVER_DIAGNOSTICS: '1' },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('web-process-observer-start');
    expect(result.stdout).toContain('web-uncaught-exception-monitor');
    expect(result.stdout).toContain('ECONNRESET');
    expect(result.stderr).toContain('Error: aborted');
  });
});
