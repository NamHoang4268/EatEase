# Security model

Status: **APPROVED principles**, timeout/domain specifics được đánh dấu rõ.

## Trust model

- Static QR và public identifiers không phải proof of physical presence.
- Guest access chỉ được nâng sau staff confirmation hoặc valid join code.
- Backend deny-by-default và authorize từng resource/action.
- Client UI guards chỉ cải thiện UX, không phải security boundary.
- Database là source of truth; WebSocket event không cấp authority.

## Deployment origin strategy

### Recommended default

Expose web và API dưới cùng một site/domain qua reverse proxy:

```text
https://eatease.example.com/       → Next.js
https://eatease.example.com/api/   → NestJS
https://eatease.example.com/socket.io/ → NestJS Socket.IO
```

Lợi ích:

- Cookie same-origin đơn giản.
- Giảm CORS và third-party-cookie complexity.
- CSRF policy nhất quán.
- Local dev có thể dùng Next.js proxy/reverse proxy để giữ một browser origin.

`OPEN`: production domain cụ thể chỉ chốt ở deployment milestone. Nếu buộc dùng subdomains, phải review cookie Domain, CORS allowlist và CSRF assumptions; không wildcard credentials origins.

## Guest cookies

Guest credential là opaque high-entropy random token; database chỉ lưu hash.

Recommended attributes:

```text
HttpOnly
Secure (production)
SameSite=Lax
Path=/
Host-only cookie
```

- Không lưu token trong URL, localStorage hoặc readable JavaScript state.
- Rotate token khi `BROWSE_ONLY → ORDER_ENABLED`.
- Revoke server-side khi session đóng, staff revokes hoặc security event xảy ra.
- Không log raw token.

## Staff authentication cookies

- Staff login credential/session tách namespace với guest cookie.
- Password dùng modern password hashing configuration được chốt ở M1.
- Short-lived staff access session + server-side revocation/refresh strategy.
- Cookie cũng `HttpOnly`, `Secure`, `SameSite=Lax`, host-only.
- Sensitive permission/membership status được kiểm tra lại server-side; token cũ không vượt qua disabled membership.

`OPEN`: exact staff session format (opaque server session hay access/refresh token pair) được chốt trong M1 security design. Không được đưa bearer token vào localStorage mặc định.

## CSRF protection

SameSite không phải lớp bảo vệ duy nhất. Mọi state-changing cookie-authenticated request phải:

1. Dùng method không phải safe GET.
2. Kiểm tra allowed `Origin` (và `Referer` fallback phù hợp).
3. Yêu cầu CSRF token theo synchronizer token hoặc signed double-submit pattern.
4. Reject missing/mismatched token.
5. Không thay đổi state qua GET.

Guest bootstrap có thể cấp CSRF token không nhạy cảm cho client; credential cookie vẫn HttpOnly. Staff session dùng cơ chế tương tự.

Webhook endpoints tương lai không dùng browser CSRF token; chúng dùng provider signature, raw body, event idempotency và endpoint-specific authentication.

## Session expiration and recovery

Config keys dự kiến, chưa tạo configuration file:

```text
ACTIVATION_REQUEST_TTL_MINUTES=5        # PROPOSED
JOIN_CODE_TTL_MINUTES=30                # PROPOSED
GUEST_IDLE_TIMEOUT_MINUTES=30           # APPROVED initial default
GUEST_ABSOLUTE_TIMEOUT_HOURS=8           # PROPOSED
```

Values phải được đọc từ centralized validated configuration, không hardcode ở nhiều module.

Recovery flow:

1. API trả `401 GUEST_SESSION_EXPIRED` thay vì silently retry mutation.
2. Frontend giữ draft cart local; cart không chứa authoritative price.
3. UI giải thích session đã hết hạn và yêu cầu rejoin.
4. Guest scan/resolve static table context.
5. Nếu active session tồn tại, nhập valid join code hoặc yêu cầu staff assistance.
6. Server cấp independent credential mới.
7. UI revalidates menu/cart và yêu cầu guest explicit Submit.

Không auto-submit draft sau recovery.

## Concurrent activation privacy

- Database cho tối đa một pending request mỗi table.
- Guest thứ hai nhận generic waiting state và thời gian expiry.
- Không trả activation request ID, polling secret, device ID hoặc join code của guest đầu.
- Sau approval, guest thứ hai phải join bằng code; không được auto-upgrade từ static QR.

## Join-code controls

- Chỉ lưu hash; code random, short-lived và revocable.
- Rate limit theo table + browse session + source signals.
- Generic error để tránh enumeration.
- Successful use không dùng chung cookie; mỗi device nhận credential riêng.
- Authorized guest/staff có thể rotate; rotation revoke code cũ atomically.

## WebSocket security

- Authenticate handshake bằng cookie session trên cùng origin.
- Validate Origin allowlist.
- Không tin room name/resource ID từ client.
- Mỗi subscribe/action kiểm tra resource relationship và permission.
- Staff permission/membership được kiểm tra khi connect và trước sensitive commands; disconnect/revoke khi session bị vô hiệu.
- Socket events không trực tiếp ghi business state ngoài authenticated application commands.
- Rate limit inbound events và giới hạn payload/schema.

## Logging and audit

- Correlation/request ID trên HTTP và realtime operations.
- Log token fingerprint/hash-safe reference, không raw cookie, password hoặc join code.
- Audit activation, staff order, cancellation, waiver, cash payment, settlement, session close và table-ready actions.
- Security failures trả thông tin tối thiểu nhưng có internal diagnostic correlation.

## Security verification expectations

- CSRF positive/negative tests.
- Cookie attribute checks trong production-like environment.
- Cross-location/resource authorization tests.
- Expiry/revocation and recovery E2E tests.
- Join-code brute-force/rate-limit tests.
- WebSocket handshake, room authorization và revoked-session tests.
