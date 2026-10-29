'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ApiErrorPayload,
  StaffActivationRequest,
  StaffIdentity,
} from './staff-activation.types';

type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous'; message?: string }
  | { status: 'authenticated'; staff: StaffIdentity };
type QueueState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; requests: StaffActivationRequest[] }
  | { status: 'error'; message: string };
type LoginFields = { email: string; password: string; locationId: string };
type DecisionKind = 'approve' | 'reject';

const SESSION_INVALID_CODES = new Set(['STAFF_SESSION_INVALID', 'STAFF_AUTHENTICATION_FAILED']);

function formatAge(createdAt: string): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 1_000));
  if (elapsedSeconds < 60) return 'Vừa gửi';
  return `${Math.floor(elapsedSeconds / 60)} phút trước`;
}

function errorCode(payload: ApiErrorPayload | null): string | undefined {
  return payload?.error?.code;
}

async function readError(response: Response): Promise<ApiErrorPayload | null> {
  try {
    return (await response.json()) as ApiErrorPayload;
  } catch {
    return null;
  }
}

function decisionKey(kind: DecisionKind, request: StaffActivationRequest): string {
  return `${kind}:${request.id}:${request.version}`;
}

export function StaffActivationWorkspace() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loginFields, setLoginFields] = useState<LoginFields>({
    email: '',
    password: '',
    locationId: '',
  });
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueState>({ status: 'idle' });
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [confirmedPresence, setConfirmedPresence] = useState<Record<string, boolean>>({});
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [busyDecision, setBusyDecision] = useState<string | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());

  const expireSession = useCallback((message: string) => {
    setAuth({ status: 'anonymous', message });
    setCsrfToken(null);
    setQueue({ status: 'idle' });
    idempotencyKeys.current.clear();
  }, []);

  const recoverCsrf = useCallback(async (): Promise<string> => {
    const response = await fetch('/api/v1/staff/auth/csrf-token', {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('STAFF_CSRF_RECOVERY_FAILED');
    const payload = (await response.json()) as { data: { csrfToken: string } };
    setCsrfToken(payload.data.csrfToken);
    return payload.data.csrfToken;
  }, []);

  const restoreSession = useCallback(async () => {
    setAuth({ status: 'checking' });
    try {
      const response = await fetch('/api/v1/staff/auth/me', { credentials: 'include' });
      if (response.status === 401) {
        setAuth({ status: 'anonymous' });
        return;
      }
      if (!response.ok) throw new Error('STAFF_SESSION_CHECK_FAILED');
      const payload = (await response.json()) as { data: { staff: StaffIdentity } };
      await recoverCsrf();
      setAuth({ status: 'authenticated', staff: payload.data.staff });
    } catch {
      setAuth({
        status: 'anonymous',
        message: 'Chưa thể kiểm tra phiên nhân viên. Hãy thử lại.',
      });
    }
  }, [recoverCsrf]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void restoreSession(), 0);
    return () => window.clearTimeout(timeout);
  }, [restoreSession]);

  const loadQueue = useCallback(async () => {
    setQueue({ status: 'loading' });
    try {
      const response = await fetch('/api/v1/staff/activation-requests?status=PENDING', {
        credentials: 'include',
      });
      const error = response.ok ? null : await readError(response);
      if (response.status === 401 || SESSION_INVALID_CODES.has(errorCode(error) ?? '')) {
        expireSession('Phiên nhân viên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.');
        return;
      }
      if (response.status === 403) {
        setQueue({
          status: 'error',
          message: 'Bạn không có quyền xem yêu cầu kích hoạt tại địa điểm này.',
        });
        return;
      }
      if (!response.ok) throw new Error('ACTIVATION_QUEUE_FAILED');
      const payload = (await response.json()) as { data: StaffActivationRequest[] };
      setQueue({ status: 'ready', requests: payload.data });
    } catch {
      setQueue({
        status: 'error',
        message: 'Chưa thể tải hàng chờ kích hoạt. Kiểm tra kết nối rồi thử lại.',
      });
    }
  }, [expireSession]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const timeout = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timeout);
  }, [auth.status, loadQueue]);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await fetch('/api/v1/staff/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginFields.email.trim(),
          password: loginFields.password,
          ...(loginFields.locationId.trim() ? { locationId: loginFields.locationId.trim() } : {}),
        }),
      });
      if (!response.ok) {
        setLoginError(
          response.status === 401
            ? 'Thông tin đăng nhập hoặc phạm vi địa điểm không hợp lệ.'
            : 'Chưa thể đăng nhập. Vui lòng thử lại.',
        );
        return;
      }
      const payload = (await response.json()) as {
        data: { staff: StaffIdentity; csrfToken: string };
      };
      setCsrfToken(payload.data.csrfToken);
      setAuth({ status: 'authenticated', staff: payload.data.staff });
      setLoginFields((current) => ({ ...current, password: '' }));
    } catch {
      setLoginError('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    try {
      const token = csrfToken ?? (await recoverCsrf());
      const response = await fetch('/api/v1/staff/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': token },
      });
      if (!response.ok && response.status !== 401) throw new Error('STAFF_LOGOUT_FAILED');
      expireSession('Bạn đã đăng xuất an toàn.');
    } catch {
      setQueueNotice('Chưa thể đăng xuất. Vui lòng thử lại.');
    }
  };

  const decide = async (kind: DecisionKind, item: StaffActivationRequest) => {
    if (busyDecision) return;
    const reason = rejectionReasons[item.id]?.trim() ?? '';
    if (kind === 'approve' && !confirmedPresence[item.id]) return;
    if (kind === 'reject' && (reason.length === 0 || reason.length > 500)) {
      setQueueNotice('Lý do từ chối phải có từ 1 đến 500 ký tự.');
      return;
    }

    const operation = decisionKey(kind, item);
    const idempotencyKey = idempotencyKeys.current.get(operation) ?? crypto.randomUUID();
    idempotencyKeys.current.set(operation, idempotencyKey);
    setBusyDecision(operation);
    setQueueNotice(null);

    try {
      const send = (token: string) =>
        fetch(`/api/v1/staff/activation-requests/${encodeURIComponent(item.id)}/${kind}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-CSRF-Token': token,
          },
          body: JSON.stringify(
            kind === 'approve'
              ? { expectedVersion: item.version, physicalPresenceConfirmed: true }
              : { expectedVersion: item.version, reason },
          ),
        });
      let token = csrfToken ?? (await recoverCsrf());
      let response = await send(token);
      let error = response.ok ? null : await readError(response);
      if (response.status === 403 && errorCode(error) === 'STAFF_CSRF_INVALID') {
        token = await recoverCsrf();
        response = await send(token);
        error = response.ok ? null : await readError(response);
      }
      if (response.status === 401 || SESSION_INVALID_CODES.has(errorCode(error) ?? '')) {
        expireSession('Phiên nhân viên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.');
        return;
      }
      if (response.status === 409) {
        idempotencyKeys.current.delete(operation);
        setQueueNotice('Yêu cầu đã thay đổi hoặc hết hạn. Hàng chờ đã được cập nhật.');
        await loadQueue();
        return;
      }
      if (response.status === 403) {
        setQueueNotice('Bạn không có quyền xử lý yêu cầu này hoặc phiên CSRF không còn hợp lệ.');
        return;
      }
      if (!response.ok) throw new Error('ACTIVATION_DECISION_FAILED');

      idempotencyKeys.current.delete(operation);
      setConfirmedPresence((current) => ({ ...current, [item.id]: false }));
      setRejectionReasons((current) => ({ ...current, [item.id]: '' }));
      setQueueNotice(
        kind === 'approve'
          ? `Đã kích hoạt bàn ${item.table.code}.`
          : `Đã từ chối yêu cầu tại bàn ${item.table.code}.`,
      );
      await loadQueue();
    } catch {
      setQueueNotice('Kết nối bị gián đoạn. Thử lại sẽ dùng cùng Idempotency-Key an toàn.');
    } finally {
      setBusyDecision(null);
    }
  };

  if (auth.status === 'checking') {
    return (
      <main className="staff-auth-shell" aria-busy="true">
        <section className="staff-auth-card">
          <p className="eyebrow">EatEase Staff</p>
          <h1>Đang kiểm tra phiên…</h1>
          <p>Vui lòng chờ trong giây lát.</p>
        </section>
      </main>
    );
  }

  if (auth.status === 'anonymous') {
    return (
      <main className="staff-auth-shell">
        <section className="staff-auth-card" aria-labelledby="staff-login-heading">
          <p className="eyebrow">EatEase Staff</p>
          <h1 id="staff-login-heading">Đăng nhập vận hành</h1>
          <p>Đăng nhập bằng tài khoản nhân viên thuộc đúng địa điểm làm việc.</p>
          {auth.message ? <p className="form-notice">{auth.message}</p> : null}
          <form className="staff-login-form" onSubmit={(event) => void submitLogin(event)}>
            <label>
              Email
              <input
                autoComplete="username"
                name="email"
                required
                type="email"
                value={loginFields.email}
                onChange={(event) =>
                  setLoginFields((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              Mật khẩu
              <input
                autoComplete="current-password"
                name="password"
                required
                type="password"
                value={loginFields.password}
                onChange={(event) =>
                  setLoginFields((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
            <label>
              Location ID <span>(chỉ cần khi tài khoản có nhiều địa điểm)</span>
              <input
                name="locationId"
                placeholder="UUID địa điểm"
                value={loginFields.locationId}
                onChange={(event) =>
                  setLoginFields((current) => ({ ...current, locationId: event.target.value }))
                }
              />
            </label>
            {loginError ? <p className="form-error">{loginError}</p> : null}
            <button className="primary-button" disabled={loginBusy} type="submit">
              {loginBusy ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const canApprove = auth.staff.permissions.includes('table.activation.approve');

  return (
    <main className="staff-shell">
      <header className="staff-header">
        <div>
          <p className="eyebrow">Activation desk</p>
          <h1>Yêu cầu kích hoạt bàn</h1>
          <p>
            {auth.staff.name} · phạm vi địa điểm {auth.staff.locationId}
          </p>
        </div>
        <div className="staff-header-actions">
          <button className="secondary-button" type="button" onClick={() => void loadQueue()}>
            Làm mới
          </button>
          <button className="text-button" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      {queueNotice ? (
        <p className="queue-notice" role="status">
          {queueNotice}
        </p>
      ) : null}

      <section
        className="activation-queue"
        aria-live="polite"
        aria-busy={queue.status === 'loading'}
      >
        {queue.status === 'idle' || queue.status === 'loading' ? (
          <div className="operational-state">
            <h2>Đang tải hàng chờ…</h2>
            <p>Đang lấy các yêu cầu thuộc phạm vi được cấp quyền.</p>
          </div>
        ) : queue.status === 'error' ? (
          <div className="operational-state operational-error">
            <h2>Chưa thể tải hàng chờ</h2>
            <p>{queue.message}</p>
            <button className="secondary-button" type="button" onClick={() => void loadQueue()}>
              Thử lại
            </button>
          </div>
        ) : queue.requests.length === 0 ? (
          <div className="operational-state">
            <h2>Không có yêu cầu đang chờ</h2>
            <p>Hàng chờ của địa điểm hiện đã được xử lý.</p>
          </div>
        ) : (
          <ul className="activation-queue-list">
            {queue.requests.map((item) => {
              const approvalOperation = decisionKey('approve', item);
              const rejectionOperation = decisionKey('reject', item);
              const isBusy =
                busyDecision === approvalOperation || busyDecision === rejectionOperation;
              const reason = rejectionReasons[item.id] ?? '';
              return (
                <li key={item.id}>
                  <div className="request-summary">
                    <div>
                      <p className="eyebrow">Đang chờ xác nhận</p>
                      <h2>Bàn {item.table.code}</h2>
                    </div>
                    <span className="request-age">{formatAge(item.createdAt)}</span>
                  </div>
                  <dl className="request-metadata">
                    <div>
                      <dt>Sức chứa</dt>
                      <dd>{item.table.capacity} khách</dd>
                    </div>
                    <div>
                      <dt>Hết hạn</dt>
                      <dd>{new Date(item.expiresAt).toLocaleTimeString('vi-VN')}</dd>
                    </div>
                    <div>
                      <dt>Phiên bản</dt>
                      <dd>{item.version}</dd>
                    </div>
                  </dl>

                  {canApprove ? (
                    <div className="decision-panel">
                      <label className="presence-check">
                        <input
                          checked={confirmedPresence[item.id] ?? false}
                          type="checkbox"
                          onChange={(event) =>
                            setConfirmedPresence((current) => ({
                              ...current,
                              [item.id]: event.target.checked,
                            }))
                          }
                        />
                        Tôi đã trực tiếp xác nhận khách đang có mặt tại bàn này.
                      </label>
                      <button
                        className="primary-button"
                        disabled={!confirmedPresence[item.id] || isBusy}
                        type="button"
                        onClick={() => void decide('approve', item)}
                      >
                        {busyDecision === approvalOperation ? 'Đang duyệt…' : 'Duyệt kích hoạt'}
                      </button>

                      <div className="rejection-form">
                        <label htmlFor={`rejection-${item.id}`}>Lý do từ chối</label>
                        <textarea
                          id={`rejection-${item.id}`}
                          maxLength={500}
                          rows={3}
                          value={reason}
                          onChange={(event) =>
                            setRejectionReasons((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                        <span>{reason.length}/500</span>
                        <button
                          className="danger-button"
                          disabled={reason.trim().length === 0 || isBusy}
                          type="button"
                          onClick={() => void decide('reject', item)}
                        >
                          {busyDecision === rejectionOperation ? 'Đang từ chối…' : 'Từ chối'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="permission-note">
                      Bạn chỉ có quyền xem hàng chờ tại địa điểm này.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
