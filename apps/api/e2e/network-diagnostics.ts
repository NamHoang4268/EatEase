import type { BrowserContext, Request, WebSocket } from '@playwright/test';
import { safeUrl, writeDiagnostic, type DiagnosticSink } from './server-diagnostics.js';

type State = {
  phase: 'active' | 'closing' | 'closed';
  note: (event: string, fields?: Record<string, unknown>) => void;
  pending: Map<
    Request,
    { id: number; started: number; expected?: string; responseStatus?: number }
  >;
  sockets: Set<WebSocket>;
  snapshot: () => Record<string, unknown>;
};
const states = new WeakMap<BrowserContext, State>();
let nextContext = 0;

export function observeContext(
  context: BrowserContext,
  label: string,
  enabled = process.env.E2E_NETWORK_DIAGNOSTICS === '1',
  write: DiagnosticSink = writeDiagnostic,
): void {
  if (!enabled || states.has(context)) return;
  const id = ++nextContext;
  const state: State = {
    phase: 'active',
    note: (event, fields = {}) =>
      write(event, { context: id, label, phase: state.phase, ...fields }),
    pending: new Map(),
    sockets: new Set(),
    snapshot: () => ({
      // Event bookkeeping, not proof that these requests are still running on the server.
      unfinalizedRequests: [...state.pending.keys()].map(describeRequest),
      webSocketsWithoutCloseEvent: state.sockets.size,
    }),
  };
  states.set(context, state);
  let nextRequest = 0;
  const describeRequest = (request: Request) => {
    const tracked = state.pending.get(request);
    return {
      request: tracked?.id,
      method: request.method(),
      url: safeUrl(request.url()),
      type: request.resourceType(),
      elapsedMs: tracked ? Math.round(performance.now() - tracked.started) : undefined,
      expected: tracked?.expected,
      completion:
        tracked?.responseStatus === undefined
          ? 'awaiting-response-headers'
          : 'headers-received-without-terminal-event',
      responseStatus: tracked?.responseStatus,
    };
  };
  context.on('request', (request) =>
    state.pending.set(request, { id: ++nextRequest, started: performance.now() }),
  );
  context.on('requestfinished', (request) => state.pending.delete(request));
  context.on('response', (response) => {
    const tracked = state.pending.get(response.request());
    if (tracked) tracked.responseStatus = response.status();
  });
  context.on('requestfailed', (request) => {
    state.note('requestfailed', {
      ...describeRequest(request),
      reason: request.failure()?.errorText,
    });
    state.pending.delete(request);
  });
  context.on('page', (page) => {
    page.on('websocket', (socket) => {
      state.sockets.add(socket);
      state.note('websocket-open', { url: safeUrl(socket.url()) });
      socket.on('close', () => {
        state.sockets.delete(socket);
        state.note('websocket-close', { url: safeUrl(socket.url()) });
      });
    });
    page.on('close', () => state.note('page-closed'));
    // Record lifecycle only; never log Socket.IO frames, tickets, cookies or bodies.
  });
  context.on('close', () => {
    state.phase = 'closed';
    state.note('context-closed', state.snapshot());
    state.pending.clear();
    state.sockets.clear();
  });
  state.note('context-created');
}

export function expectedRequestFailure(
  context: BrowserContext,
  request: Request,
  reason: string,
): void {
  const state = states.get(context);
  const pending = state?.pending.get(request);
  if (pending) pending.expected = reason;
  state?.note('intentional-request-abort', {
    method: request.method(),
    url: safeUrl(request.url()),
    reason,
  });
}

export function diagnosticNote(context: BrowserContext, event: string): void {
  states.get(context)?.note(event);
}

export async function closeObservedContext(context: BrowserContext): Promise<void> {
  const state = states.get(context);
  if (state) {
    state.phase = 'closing';
    state.note('context-close-begin', state.snapshot());
  }
  await context.close();
  // Preserve original close semantics: no delays, waiting for networkidle or forced disconnects.
}
