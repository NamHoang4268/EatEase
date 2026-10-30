'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDraftItem,
  calculateDraftSubtotal,
  changeDraftQuantity,
  formatVnd,
  removeDraftItem,
  type DraftCartLine,
} from './draft-cart';
import type {
  ActivationState,
  ClaimActivationResponse,
  GuestAccessLevel,
  GuestSessionData,
  IssuedJoinCode,
  JoinCodeMetadata,
  JoinTableResponse,
  PublicMenu,
  PublicMenuItem,
  PublicTableContext,
} from './public-menu.types';

type LoadState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error' }
  | { status: 'ready'; table: PublicTableContext; menu: PublicMenu };

const availabilityCopy = {
  AVAILABLE: 'Sẵn sàng để xem thực đơn',
  BROWSE_ONLY: 'Bàn đang được sử dụng · Chỉ xem thực đơn',
  UNAVAILABLE: 'Bàn hiện chưa sẵn sàng · Chỉ xem thực đơn',
} as const;

const CLAIM_RECOVERY_TTL_MS = 120_000;

type StoredClaimAttempt = {
  idempotencyKey: string;
  createdAt: number;
  scopeKey: string;
};

function claimStorageKey(publicId: string, activation: ActivationState): string | null {
  if (!activation.activationRequestId || activation.version === undefined) return null;
  return `eatease:claim:${publicId}:${activation.activationRequestId}:${activation.version}`;
}

function readClaimAttempt(key: string): StoredClaimAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredClaimAttempt>;
    if (
      typeof parsed.idempotencyKey !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      parsed.scopeKey !== key ||
      Date.now() - parsed.createdAt >= CLAIM_RECOVERY_TTL_MS
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return { idempotencyKey: parsed.idempotencyKey, createdAt: parsed.createdAt, scopeKey: key };
  } catch {
    return null;
  }
}

function writeClaimAttempt(key: string, attempt: StoredClaimAttempt): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(attempt));
  } catch {
    // sessionStorage can be unavailable in restrictive browser modes; in-memory retry still works.
  }
}

function clearClaimAttempt(key: string | null): void {
  if (!key) return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing sensitive is stored and failure to clear expires naturally after the bounded TTL.
  }
}

export function PublicMenuExperience({ publicId }: { publicId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [view, setView] = useState<'menu' | 'cart'>('menu');
  const [cart, setCart] = useState<DraftCartLine[]>([]);
  const [sessionEstablished, setSessionEstablished] = useState(false);
  const [guestAccess, setGuestAccess] = useState<GuestAccessLevel>('BROWSE_ONLY');
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [activation, setActivation] = useState<ActivationState>({ status: 'NOT_REQUESTED' });
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [hostInvite, setHostInvite] = useState<JoinCodeMetadata | null>(null);
  const [visibleJoinCode, setVisibleJoinCode] = useState<string | null>(null);
  const [hostInviteBusy, setHostInviteBusy] = useState(false);
  const [hostInviteError, setHostInviteError] = useState<string | null>(null);
  const bootstrappedTableRef = useRef<string | null>(null);
  const activationKeyRef = useRef<string | null>(null);
  const claimAttemptRef = useRef<StoredClaimAttempt | null>(null);
  const joinAttemptKeyRef = useRef<string | null>(null);
  const inviteAttemptKeyRef = useRef<string | null>(null);

  const refreshActivation = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/v1/activation-requests/current', {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
    if (response.status === 401) {
      setSessionEstablished(false);
      setGuestAccess('BROWSE_ONLY');
      setHostInvite(null);
      setVisibleJoinCode(null);
      throw new Error('GUEST_SESSION_INVALID');
    }
    if (!response.ok) throw new Error('ACTIVATION_STATUS_UNAVAILABLE');
    const payload = (await response.json()) as { data: ActivationState };
    setActivation(payload.data);
    if (payload.data.status !== 'PENDING') activationKeyRef.current = null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const encodedPublicId = encodeURIComponent(publicId);
    void Promise.all([
      fetch(`/api/v1/public/tables/${encodedPublicId}`, { signal: controller.signal }),
      fetch(`/api/v1/public/menu?tablePublicId=${encodedPublicId}`, {
        signal: controller.signal,
      }),
    ])
      .then(async ([tableResponse, menuResponse]) => {
        if (tableResponse.status === 404) {
          setLoadState({ status: 'invalid' });
          return;
        }
        if (!tableResponse.ok || !menuResponse.ok) {
          setLoadState({ status: 'error' });
          return;
        }

        const [tablePayload, menuPayload] = (await Promise.all([
          tableResponse.json(),
          menuResponse.json(),
        ])) as [{ data: PublicTableContext }, { data: PublicMenu }];
        setLoadState({ status: 'ready', table: tablePayload.data, menu: menuPayload.data });

        if (bootstrappedTableRef.current !== publicId) {
          bootstrappedTableRef.current = publicId;
          try {
            const bootstrapResult = fetch('/api/v1/guest-sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tablePublicId: publicId }),
              signal: controller.signal,
            });
            if (bootstrapResult && typeof bootstrapResult.then === 'function') {
              void bootstrapResult
                .then(async (res) => {
                  if (res && res.ok) {
                    const payload = (await res.json()) as { data?: GuestSessionData };
                    if (payload.data?.csrfToken) {
                      setCsrfToken(payload.data.csrfToken);
                      setSessionEstablished(true);
                      setGuestAccess(payload.data.session.accessLevel);
                      setActivation({
                        status: payload.data.activationState as ActivationState['status'],
                      });
                      void refreshActivation(controller.signal).catch(() => {
                        // Activation status is recoverable independently from public browsing.
                      });
                    } else {
                      setActivationError(
                        'Chưa thể thiết lập phiên tại bàn. Hãy tải lại trang hoặc nhờ nhân viên hỗ trợ.',
                      );
                    }
                  } else {
                    setActivationError(
                      'Chưa thể thiết lập phiên tại bàn. Hãy tải lại trang hoặc nhờ nhân viên hỗ trợ.',
                    );
                  }
                })
                .catch(() => {
                  setActivationError(
                    'Chưa thể thiết lập phiên tại bàn. Bạn vẫn có thể xem thực đơn.',
                  );
                });
            }
          } catch {
            setActivationError('Chưa thể thiết lập phiên tại bàn. Bạn vẫn có thể xem thực đơn.');
          }
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadState({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [publicId, refreshActivation, reloadToken]);

  useEffect(() => {
    if (!sessionEstablished || activation.status !== 'PENDING') return;
    const interval = window.setInterval(() => {
      void refreshActivation().catch(() => {
        setActivationError('Chưa thể cập nhật trạng thái. Hệ thống sẽ tự thử lại.');
      });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [activation.status, refreshActivation, sessionEstablished]);

  const itemCount = useMemo(() => cart.reduce((total, line) => total + line.quantity, 0), [cart]);
  const subtotal = useMemo(() => calculateDraftSubtotal(cart), [cart]);

  const recoverCsrfToken = async (): Promise<string> => {
    const response = await fetch('/api/v1/guest-sessions/csrf-token', {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('CSRF_RECOVERY_FAILED');
    const payload = (await response.json()) as { data: { csrfToken: string } };
    setCsrfToken(payload.data.csrfToken);
    return payload.data.csrfToken;
  };

  const refreshGuestSession = async (): Promise<void> => {
    const response = await fetch('/api/v1/guest-sessions/current', {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('GUEST_SESSION_REFRESH_FAILED');
    const payload = (await response.json()) as {
      data: { session: { accessLevel: GuestAccessLevel } };
    };
    setGuestAccess(payload.data.session.accessLevel);
    setSessionEstablished(true);
  };

  const loadHostInvite = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/v1/table-sessions/current/join-code', {
      credentials: 'include',
    });
    if (response.status === 403) {
      setHostInvite(null);
      return;
    }
    if (!response.ok) throw new Error('HOST_INVITE_UNAVAILABLE');
    const payload = (await response.json()) as { data: JoinCodeMetadata };
    setHostInvite(payload.data);
  }, []);

  useEffect(() => {
    if (guestAccess !== 'ORDER_ENABLED') {
      const timeout = window.setTimeout(() => {
        setHostInvite(null);
        setVisibleJoinCode(null);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      void loadHostInvite().catch(() => {
        setHostInviteError('Chưa thể tải thông tin lời mời. Hãy thử lại sau.');
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [guestAccess, loadHostInvite]);

  const joinTable = async () => {
    if (joinBusy || !/^\d{6}$/.test(joinCodeInput)) return;
    setJoinBusy(true);
    setJoinError(null);
    const key = joinAttemptKeyRef.current ?? crypto.randomUUID();
    joinAttemptKeyRef.current = key;
    const send = (token: string) =>
      fetch('/api/v1/table-sessions/join', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ tablePublicId: publicId, joinCode: joinCodeInput }),
      });
    try {
      const token = csrfToken ?? (await recoverCsrfToken());
      let response = await send(token);
      let payload = (await response.json().catch(() => ({}))) as {
        data?: JoinTableResponse;
        error?: { code?: string };
      };
      if (response.status === 403 && payload.error?.code === 'GUEST_CSRF_INVALID') {
        const recoveredToken = await recoverCsrfToken();
        response = await send(recoveredToken);
        payload = (await response.json().catch(() => ({}))) as {
          data?: JoinTableResponse;
          error?: { code?: string };
        };
      }
      if (!response.ok) {
        if (response.status < 500) joinAttemptKeyRef.current = null;
        if (response.status === 429) {
          setJoinError('Bạn đã thử quá nhiều lần. Vui lòng chờ 10 phút rồi thử lại.');
        } else if (response.status === 403) {
          setJoinError('Mã tham gia không đúng, đã hết hạn hoặc đã được thay thế.');
        } else if (response.status === 409) {
          setJoinError('Phiên dùng bàn không còn sẵn sàng để tham gia.');
        } else if (payload.error?.code === 'GUEST_SESSION_INVALID') {
          setJoinError('Phiên xem thực đơn đã hết hạn. Hãy tải lại trang rồi thử lại.');
        } else {
          setJoinError('Chưa thể tham gia bàn. Vui lòng thử lại.');
        }
        return;
      }
      if (!payload.data) throw new Error('JOIN_RESPONSE_INVALID');
      setCsrfToken(payload.data.csrfToken);
      setGuestAccess('ORDER_ENABLED');
      setJoinCodeInput('');
      joinAttemptKeyRef.current = null;
      await refreshGuestSession();
    } catch {
      setJoinError('Kết nối bị gián đoạn. Hãy thử lại trong 2 phút để khôi phục an toàn.');
    } finally {
      setJoinBusy(false);
    }
  };

  const issueJoinCode = async () => {
    if (!hostInvite || hostInviteBusy) return;
    if (
      hostInvite.hasActiveCode &&
      !window.confirm('Tạo mã mới sẽ làm mã hiện tại mất hiệu lực. Bạn có muốn tiếp tục?')
    )
      return;
    setHostInviteBusy(true);
    setHostInviteError(null);
    const key = inviteAttemptKeyRef.current ?? crypto.randomUUID();
    inviteAttemptKeyRef.current = key;
    try {
      const token = csrfToken ?? (await recoverCsrfToken());
      const response = await fetch('/api/v1/table-sessions/current/join-code', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({
          expectedVersion: hostInvite.tableSessionVersion,
          replaceExisting: hostInvite.hasActiveCode,
        }),
      });
      if (!response.ok) {
        inviteAttemptKeyRef.current = null;
        if (response.status === 409) await loadHostInvite();
        setHostInviteError('Trạng thái mã đã thay đổi. Hãy kiểm tra và thử lại.');
        return;
      }
      const payload = (await response.json()) as { data: IssuedJoinCode };
      setHostInvite(payload.data);
      setVisibleJoinCode(payload.data.code);
      inviteAttemptKeyRef.current = null;
    } catch {
      setHostInviteError('Chưa thể tạo mã. Hãy thử lại; hệ thống sẽ không tạo trùng tác vụ.');
    } finally {
      setHostInviteBusy(false);
    }
  };

  const submitActivation = async () => {
    if (activationBusy) return;
    setActivationBusy(true);
    setActivationError(null);
    const idempotencyKey = activationKeyRef.current ?? crypto.randomUUID();
    activationKeyRef.current = idempotencyKey;

    const send = (token: string) =>
      fetch('/api/v1/activation-requests', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ tablePublicId: publicId }),
      });

    try {
      let token = csrfToken ?? (await recoverCsrfToken());
      let response = await send(token);
      if (response.status === 403) {
        token = await recoverCsrfToken();
        response = await send(token);
      }
      if (!response.ok) throw new Error('ACTIVATION_REQUEST_FAILED');
      const payload = (await response.json()) as { data: ActivationState };
      setActivation(payload.data);
    } catch {
      setActivationError('Chưa thể gửi yêu cầu. Vui lòng thử lại hoặc nhờ nhân viên hỗ trợ.');
    } finally {
      setActivationBusy(false);
    }
  };

  const claimActivation = async () => {
    if (claimBusy || !activation.claimAvailable || activation.version === undefined) return;
    const storageKey = claimStorageKey(publicId, activation);
    if (!storageKey) {
      setClaimError('Thiếu thông tin phiên kích hoạt. Hãy cập nhật trạng thái rồi thử lại.');
      return;
    }

    const storedAttempt = readClaimAttempt(storageKey);
    const attempt =
      claimAttemptRef.current &&
      claimAttemptRef.current.scopeKey === storageKey &&
      Date.now() - claimAttemptRef.current.createdAt < CLAIM_RECOVERY_TTL_MS
        ? claimAttemptRef.current
        : (storedAttempt ?? {
            idempotencyKey: crypto.randomUUID(),
            createdAt: Date.now(),
            scopeKey: storageKey,
          });
    claimAttemptRef.current = attempt;
    writeClaimAttempt(storageKey, attempt);
    setClaimBusy(true);
    setClaimError(null);

    const send = (token: string) =>
      fetch('/api/v1/activation-requests/current/claim', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.idempotencyKey,
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ expectedVersion: activation.version }),
      });

    try {
      let token = csrfToken ?? (await recoverCsrfToken());
      let response = await send(token);
      if (response.status === 403) {
        token = await recoverCsrfToken();
        response = await send(token);
      }
      if (!response.ok) {
        clearClaimAttempt(storageKey);
        claimAttemptRef.current = null;
        if (response.status === 401 || response.status === 403) {
          setSessionEstablished(false);
          setGuestAccess('BROWSE_ONLY');
          setHostInvite(null);
          setVisibleJoinCode(null);
          setClaimError(
            'Phiên xác nhận không còn hợp lệ hoặc thời gian khôi phục đã hết. Hãy nhờ nhân viên hỗ trợ.',
          );
        } else if (response.status === 409) {
          setClaimError(
            'Trạng thái kích hoạt đã thay đổi. Hãy cập nhật và thử lại nếu còn khả dụng.',
          );
          await refreshActivation();
        } else {
          setClaimError('Chưa thể tiếp tục với bàn đã kích hoạt. Vui lòng thử lại.');
        }
        return;
      }

      const payload = (await response.json()) as { data: ClaimActivationResponse };
      setCsrfToken(payload.data.csrfToken);
      setGuestAccess(payload.data.session.accessLevel);
      setSessionEstablished(true);
      clearClaimAttempt(storageKey);
      claimAttemptRef.current = null;
      await Promise.allSettled([refreshGuestSession(), refreshActivation()]);
    } catch {
      setClaimError(
        'Phản hồi bị gián đoạn. Hãy thử lại trong 2 phút; hệ thống sẽ dùng đúng mã yêu cầu cũ.',
      );
    } finally {
      setClaimBusy(false);
    }
  };

  if (loadState.status === 'loading') {
    return (
      <main className="customer-shell customer-state" aria-busy="true">
        <span className="state-mark" aria-hidden="true">
          EE
        </span>
        <p className="eyebrow">EatEase</p>
        <h1>Đang mở thực đơn…</h1>
        <p>Chúng tôi đang kiểm tra thông tin bàn và chuẩn bị món cho bạn.</p>
      </main>
    );
  }

  if (loadState.status === 'invalid') {
    return (
      <main className="customer-shell customer-state">
        <span className="state-mark" aria-hidden="true">
          ?
        </span>
        <p className="eyebrow">Không tìm thấy bàn</p>
        <h1>Mã QR này không còn hợp lệ</h1>
        <p>Vui lòng kiểm tra lại mã tại bàn hoặc nhờ nhân viên hỗ trợ.</p>
      </main>
    );
  }

  if (loadState.status === 'error') {
    return (
      <main className="customer-shell customer-state">
        <span className="state-mark" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">Kết nối gián đoạn</p>
        <h1>Chưa thể tải thực đơn</h1>
        <p>Hãy kiểm tra kết nối và thử lại. Giỏ nháp trên trang sẽ không tự gửi đi.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setLoadState({ status: 'loading' });
            setReloadToken((value) => value + 1);
          }}
        >
          Thử lại
        </button>
      </main>
    );
  }

  const menuItems = loadState.menu.categories.flatMap((category) => category.items);
  const canAddItems = loadState.table.availability !== 'UNAVAILABLE';

  const addItem = (item: PublicMenuItem) => {
    if (canAddItems) {
      setCart((current) => addDraftItem(current, item));
    }
  };

  return (
    <main className="customer-shell">
      <header className="menu-hero">
        <div>
          <p className="eyebrow">{loadState.table.locationName}</p>
          <h1>{loadState.table.restaurantName}</h1>
          <p className="hero-copy">Khám phá thực đơn tại bàn {loadState.table.tableLabel}.</p>
        </div>
        <aside className="table-context" aria-label="Thông tin bàn">
          <span className="table-number">{loadState.table.tableLabel}</span>
          <span>Bàn · tối đa {loadState.table.capacity} khách</span>
          <strong data-availability={loadState.table.availability}>
            {availabilityCopy[loadState.table.availability]}
          </strong>
        </aside>
      </header>

      {loadState.table.availability === 'AVAILABLE' ||
      activation.status !== 'NOT_REQUESTED' ||
      guestAccess === 'ORDER_ENABLED' ? (
        <section className="activation-panel" aria-labelledby="activation-heading">
          <div>
            <p className="eyebrow">Xác nhận dùng bàn</p>
            <h2 id="activation-heading">
              {guestAccess === 'ORDER_ENABLED'
                ? 'Bàn đã sẵn sàng cho phiên của bạn'
                : 'Kích hoạt bàn để chuẩn bị gọi món'}
            </h2>
            {guestAccess === 'ORDER_ENABLED' ? (
              <p role="status">
                Phiên trên thiết bị này đã được cấp quyền tại bàn. Tính năng gửi món sẽ được triển
                khai ở bước tiếp theo.
              </p>
            ) : activation.status === 'PENDING' ? (
              <p role="status">
                Nhân viên đang xác nhận yêu cầu tại bàn này. Yêu cầu hết hạn lúc{' '}
                {activation.expiresAt
                  ? new Date(activation.expiresAt).toLocaleTimeString('vi-VN')
                  : 'sau ít phút'}
                .
              </p>
            ) : activation.status === 'APPROVED' ? (
              <p role="status">
                Nhân viên đã xác nhận bàn. Bạn cần chủ động tiếp tục để bảo vệ quyền truy cập trên
                đúng thiết bị đã gửi yêu cầu.
              </p>
            ) : activation.status === 'REJECTED' ? (
              <p role="status">
                Yêu cầu chưa được chấp nhận. Hãy kiểm tra đúng bàn hoặc trao đổi trực tiếp với nhân
                viên.
              </p>
            ) : activation.status === 'EXPIRED' ? (
              <p role="status">
                Yêu cầu trước đã hết hạn. Bạn có thể gửi lại khi đã có mặt tại bàn.
              </p>
            ) : activation.status === 'CANCELLED' ? (
              <p role="status">
                Yêu cầu kích hoạt đã được hủy. Bạn có thể gửi yêu cầu mới khi vẫn đang có mặt tại
                bàn.
              </p>
            ) : (
              <p>Gửi yêu cầu khi bạn đã có mặt. Nhân viên cần xác nhận trước khi có thể đặt món.</p>
            )}
            <p className="activation-safety-copy">
              Kích hoạt bàn không tự gửi các món đang có trong giỏ nháp.
            </p>
            {activationError ? <p className="activation-error">{activationError}</p> : null}
            {claimError ? <p className="activation-error">{claimError}</p> : null}
          </div>
          {guestAccess === 'ORDER_ENABLED' ? (
            <span className="activation-success-badge">Đã cấp quyền tại bàn</span>
          ) : activation.status === 'PENDING' ? (
            <span className="activation-waiting-badge">Đang chờ nhân viên</span>
          ) : activation.status === 'APPROVED' && activation.claimAvailable ? (
            <button
              className="primary-button"
              type="button"
              disabled={claimBusy}
              onClick={() => void claimActivation()}
            >
              {claimBusy ? 'Đang tiếp tục…' : 'Tiếp tục với bàn đã kích hoạt'}
            </button>
          ) : loadState.table.availability === 'AVAILABLE' && activation.status !== 'APPROVED' ? (
            <button
              className="primary-button"
              type="button"
              disabled={!sessionEstablished || activationBusy}
              onClick={() => void submitActivation()}
            >
              {activationBusy
                ? 'Đang gửi…'
                : activation.status === 'EXPIRED'
                  ? 'Gửi lại yêu cầu'
                  : 'Yêu cầu kích hoạt bàn'}
            </button>
          ) : (
            <span className="activation-waiting-badge">Cần hỗ trợ từ nhân viên</span>
          )}
        </section>
      ) : null}

      {guestAccess === 'BROWSE_ONLY' && loadState.table.availability === 'BROWSE_ONLY' ? (
        <section className="join-panel" aria-labelledby="join-table-heading">
          <div>
            <p className="eyebrow">Bàn đang hoạt động</p>
            <h2 id="join-table-heading">Tham gia bàn bằng mã mời</h2>
            <p>
              Nhập mã 6 chữ số từ người cùng bàn. Bạn vẫn có thể xem thực đơn và giỏ nháp sẽ được
              giữ nguyên.
            </p>
          </div>
          <div className="join-form">
            <label htmlFor="join-code-input">Join Code</label>
            <input
              id="join-code-input"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              value={joinCodeInput}
              onChange={(event) => {
                const nextCode = event.target.value.replace(/\D/g, '').slice(0, 6);
                if (nextCode !== joinCodeInput) joinAttemptKeyRef.current = null;
                setJoinCodeInput(nextCode);
              }}
            />
            <button
              className="primary-button"
              disabled={joinBusy || !/^\d{6}$/.test(joinCodeInput)}
              type="button"
              onClick={() => void joinTable()}
            >
              {joinBusy ? 'Đang tham gia…' : 'Tham gia bàn'}
            </button>
            {joinError ? <p className="activation-error">{joinError}</p> : null}
          </div>
        </section>
      ) : null}

      {hostInvite ? (
        <section className="join-panel host-invite" aria-labelledby="host-invite-heading">
          <div>
            <p className="eyebrow">Mời người cùng bàn</p>
            <h2 id="host-invite-heading">Chia sẻ Join Code</h2>
            <p>
              Mã chỉ dùng để tham gia đúng phiên bàn này. Tạo mã thay thế sẽ làm mã trước mất hiệu
              lực nhưng không đăng xuất các thành viên đã tham gia.
            </p>
            {hostInvite.expiresAt ? (
              <p>
                Mã hiện tại hết hạn lúc {new Date(hostInvite.expiresAt).toLocaleTimeString('vi-VN')}
                .
              </p>
            ) : null}
          </div>
          <div className="host-code-actions">
            {visibleJoinCode ? (
              <>
                <output className="join-code-display" aria-label="Join Code hiện tại">
                  {visibleJoinCode}
                </output>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(visibleJoinCode)}
                >
                  Sao chép mã
                </button>
              </>
            ) : (
              <p className="permission-note">
                Vì lý do bảo mật, mã cũ không được lưu để hiển thị lại sau khi tải trang.
              </p>
            )}
            <button
              className="primary-button"
              disabled={hostInviteBusy}
              type="button"
              onClick={() => void issueJoinCode()}
            >
              {hostInviteBusy
                ? 'Đang tạo…'
                : hostInvite.hasActiveCode
                  ? 'Tạo Join Code mới'
                  : 'Tạo Join Code'}
            </button>
            {hostInviteError ? <p className="activation-error">{hostInviteError}</p> : null}
          </div>
        </section>
      ) : null}

      <div
        className="draft-notice"
        role="note"
        data-session-established={sessionEstablished ? 'true' : 'false'}
      >
        <strong>Đây là giỏ nháp trên thiết bị.</strong>
        <span>
          {guestAccess === 'ORDER_ENABLED'
            ? 'Giỏ nháp vẫn chưa được gửi. Bạn sẽ chủ động xác nhận khi tính năng đặt món khả dụng.'
            : 'Kích hoạt bàn không tự gửi nội dung giỏ nháp.'}
        </span>
      </div>

      <nav className="view-switcher" aria-label="Thực đơn và giỏ nháp">
        <button type="button" aria-pressed={view === 'menu'} onClick={() => setView('menu')}>
          Thực đơn
        </button>
        <button type="button" aria-pressed={view === 'cart'} onClick={() => setView('cart')}>
          Giỏ nháp <span className="count-badge">{itemCount}</span>
        </button>
      </nav>

      {view === 'menu' ? (
        <section aria-labelledby="menu-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Chọn món theo ý bạn</p>
              <h2 id="menu-heading">Thực đơn hôm nay</h2>
            </div>
            {loadState.menu.categories.length > 1 ? (
              <nav className="category-nav" aria-label="Danh mục món">
                {loadState.menu.categories.map((category) => (
                  <a key={category.id} href={`#category-${category.id}`}>
                    {category.name}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>

          {menuItems.length === 0 ? (
            <div className="empty-panel">
              <h3>Thực đơn đang được cập nhật</h3>
              <p>Hiện chưa có món đang phục vụ. Vui lòng hỏi nhân viên để được hỗ trợ.</p>
            </div>
          ) : (
            <div className="menu-categories">
              {loadState.menu.categories.map((category) =>
                category.items.length > 0 ? (
                  <section
                    className="menu-category"
                    id={`category-${category.id}`}
                    key={category.id}
                    aria-labelledby={`category-heading-${category.id}`}
                  >
                    <div className="category-heading">
                      <h3 id={`category-heading-${category.id}`}>{category.name}</h3>
                      <span>{category.items.length} món</span>
                    </div>
                    <div className="menu-grid">
                      {category.items.map((item) => (
                        <article className="menu-card" key={item.id}>
                          <div className="menu-card-copy">
                            <h4>{item.name}</h4>
                            {item.description ? <p>{item.description}</p> : null}
                          </div>
                          <div className="menu-card-action">
                            <strong>{formatVnd(BigInt(item.priceAmount))}</strong>
                            <button
                              type="button"
                              disabled={!item.available || !canAddItems}
                              onClick={() => addItem(item)}
                              aria-label={`Thêm ${item.name} vào giỏ nháp`}
                            >
                              Thêm
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null,
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="cart-panel" aria-labelledby="cart-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Chưa gửi đến nhà hàng</p>
              <h2 id="cart-heading">Giỏ nháp của bạn</h2>
            </div>
            <button className="text-button" type="button" onClick={() => setView('menu')}>
              Thêm món khác
            </button>
          </div>

          {cart.length === 0 ? (
            <div className="empty-panel">
              <h3>Giỏ nháp đang trống</h3>
              <p>Chọn món từ thực đơn để chuẩn bị trước khi tính năng đặt món khả dụng.</p>
              <button className="primary-button" type="button" onClick={() => setView('menu')}>
                Xem thực đơn
              </button>
            </div>
          ) : (
            <>
              <ul className="cart-lines">
                {cart.map((line) => (
                  <li key={line.menuItemId}>
                    <div>
                      <h3>{line.name}</h3>
                      <span>{formatVnd(BigInt(line.unitPriceAmount))} / món</span>
                    </div>
                    <div className="quantity-controls" aria-label={`Số lượng ${line.name}`}>
                      <button
                        type="button"
                        aria-label={`Giảm ${line.name}`}
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, -1))
                        }
                      >
                        −
                      </button>
                      <output aria-label={`Số lượng hiện tại: ${line.quantity}`}>
                        {line.quantity}
                      </output>
                      <button
                        type="button"
                        aria-label={`Tăng ${line.name}`}
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, 1))
                        }
                      >
                        +
                      </button>
                    </div>
                    <strong>
                      {formatVnd(BigInt(line.unitPriceAmount) * BigInt(line.quantity))}
                    </strong>
                    <button
                      className="remove-button"
                      type="button"
                      onClick={() =>
                        setCart((current) => removeDraftItem(current, line.menuItemId))
                      }
                    >
                      Xóa
                    </button>
                  </li>
                ))}
              </ul>
              <div className="cart-summary">
                <span>Tạm tính · {itemCount} món</span>
                <strong>{formatVnd(subtotal)}</strong>
                <p>
                  Giá hiển thị chỉ dùng cho giỏ nháp và sẽ được máy chủ kiểm tra lại khi đặt món.
                </p>
                <span className="disabled-order-note">Chưa thể gửi món trong giai đoạn này</span>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
