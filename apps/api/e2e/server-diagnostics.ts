// Opt-in E2E observer, preloaded only into Playwright's Web child process.
// Native Node 24 TypeScript stripping supports this file without a loader/build.
import { subscribe } from 'node:diagnostics_channel';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export type DiagnosticSink = (event: string, fields: Record<string, unknown>) => void;

export function safeUrl(value: string): string {
  try {
    const url = new URL(value, 'http://relative.invalid');
    return url.origin === 'http://relative.invalid' ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid URL]';
  }
}

export function writeDiagnostic(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `[E2E-DIAG] ${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...fields })}\n`,
  );
}

export function errorSummary(error: unknown) {
  const value = error instanceof Error ? error : new Error();
  return {
    name: value.name,
    code: 'code' in value && typeof value.code === 'string' ? value.code : undefined,
    // Do not dump arbitrary exception messages, headers, bodies, env or request credentials.
    aborted: value.message === 'aborted',
    frames: value.stack?.split('\n').filter((line) => /^\s+at /.test(line)),
  };
}

type HttpObservation = {
  request: IncomingMessage;
  socket: Socket;
  started: number;
  fields: { method: string | undefined; url: string };
  aborted: () => void;
};
type SocketObservation = { responses: Set<ServerResponse>; close: () => void };

export class HttpDiagnostics {
  private readonly seen = new WeakSet<ServerResponse>();
  private readonly pending = new WeakMap<ServerResponse, HttpObservation>();
  private readonly sockets = new WeakMap<Socket, SocketObservation>();

  private readonly write: DiagnosticSink;

  constructor(write: DiagnosticSink) {
    this.write = write;
  }

  start(request: IncomingMessage, response: ServerResponse): void {
    if (this.seen.has(response)) return;
    this.seen.add(response);
    const socket = request.socket;
    const started = performance.now();
    const fields = { method: request.method, url: safeUrl(request.url ?? '/') };
    const aborted = () =>
      this.write('server-request-aborted', {
        ...fields,
        elapsedMs: Math.round(performance.now() - started),
      });
    this.pending.set(response, { request, socket, started, fields, aborted });
    let tracked = this.sockets.get(socket);
    if (!tracked) {
      const responses = new Set<ServerResponse>();
      tracked = {
        responses,
        close: () => {
          for (const current of responses) {
            const info = this.pending.get(current);
            if (info && !current.writableFinished)
              this.write('server-response-closed-incomplete', {
                ...info.fields,
                elapsedMs: Math.round(performance.now() - info.started),
              });
            this.finish(current);
          }
        },
      };
      this.sockets.set(socket, tracked);
      // One bounded listener per active TCP socket, none on ServerResponse.
      socket.once('close', tracked.close);
    }
    tracked.responses.add(response);
    request.once('aborted', aborted);
  }

  finish(response: ServerResponse): void {
    const info = this.pending.get(response);
    if (!info) return;
    info.request.removeListener('aborted', info.aborted);
    this.pending.delete(response);
    const tracked = this.sockets.get(info.socket);
    tracked?.responses.delete(response);
    if (tracked && tracked.responses.size === 0) {
      info.socket.removeListener('close', tracked.close);
      this.sockets.delete(info.socket);
    }
  }
  // No stream error, uncaughtException, unhandledRejection or signal handlers.
}

if (process.env.EATEASE_E2E_SERVER_DIAGNOSTICS === '1') {
  writeDiagnostic('web-process-observer-start');
  const http = new HttpDiagnostics(writeDiagnostic);
  subscribe('http.server.request.start', (message) => {
    const { request, response } = message as { request: IncomingMessage; response: ServerResponse };
    http.start(request, response);
  });
  subscribe('http.server.response.finish', (message) => {
    http.finish((message as { response: ServerResponse }).response);
  });
  subscribe('http.client.request.error', (message) => {
    const { request, error } = message as {
      request: { method: string; path: string };
      error: unknown;
    };
    writeDiagnostic('web-upstream-request-error', {
      method: request.method,
      path: safeUrl(request.path),
      ...errorSummary(error),
    });
  });
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    // Monitor does not intercept exceptions or change Node's/Next's existing handling.
    writeDiagnostic('web-uncaught-exception-monitor', { origin, ...errorSummary(error) });
  });
  process.on('exit', (code) => writeDiagnostic('web-process-exit', { code }));
}
