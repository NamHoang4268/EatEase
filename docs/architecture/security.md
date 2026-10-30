# Security model

Status: **APPROVED principles**. Staff authentication baseline được owner approve cho M2.3; guest timeout/domain specifics vẫn được đánh dấu rõ.

## Trust model

- Static QR và public identifiers không phải proof of physical presence.
- Guest access chỉ được nâng sau staff confirmation hoặc valid join code.
- Backend deny-by-default và authorize từng resource/action.
- Client UI guards chỉ cải thiện UX, không phải security boundary.
- Database là source of truth; WebSocket event không cấp authority.

## Deployment origin strategy

### Recommended future topology

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

Portfolio deployment hiện tại dùng hai site khác nhau: web `https://eat-ease.vercel.app` và API `https://eatease-api-rbgu.onrender.com`. Staff browser requests vì vậy dùng explicit CORS allowlist với credentials, không wildcard hoặc dynamic Origin trust. Production staff cookie dùng `SameSite=None; Secure; HttpOnly`; browser vẫn có thể chặn third-party cookies theo policy/privacy setting, nên topology này không được xem là universally compatible. Same-site reverse proxy vẫn là direction tốt hơn cho deployment tương lai sau explicit review.

## Guest cookies

Guest credential là opaque high-entropy random token; database chỉ lưu SHA-256 hash và raw token chỉ được vận chuyển qua host-only cookie `eatease_guest_session`.

- Local development: `HttpOnly; SameSite=Lax; Path=/` và không `Secure`.
- Production cross-site deployment: `HttpOnly; Secure; SameSite=None; Path=/`.
- Không set `Domain`, luôn là host-only cookie.
- Không lưu token trong URL, localStorage hoặc readable JavaScript state.
- Rotate token khi `BROWSE_ONLY → ORDER_ENABLED`.
- Revoke server-side khi session đóng, staff revokes hoặc security event xảy ra.
- Không log raw token.
- Phân tách độc lập với staff cookie `eatease_staff_session`.

## Staff authentication cookies

- Staff session là opaque CSPRNG token; database chỉ lưu SHA-256 hash và raw token chỉ tồn tại trong host-only cookie `eatease_staff_session`.
- Session bind đúng một active staff membership/location, absolute expiry 8 giờ, không rolling refresh. Expired session bắt buộc login lại.
- Mỗi request xác thực lại expiry, revocation, active staff user, active membership, active location/restaurant và permission/resource scope từ database.
- Logout revoke session ngay trong database. Raw session token không xuất hiện trong JSON response, log hoặc database.
- Local cookie dùng `HttpOnly; SameSite=Lax; Path=/` và không `Secure` để tương thích HTTP localhost. Production cross-site cookie dùng `HttpOnly; Secure; SameSite=None; Path=/`. Không set `Domain`, nên cookie luôn host-only.
- Password hash dùng Node.js `scrypt` với random salt; không lưu hoặc log plaintext password.

## CSRF protection

SameSite không phải lớp bảo vệ duy nhất. Mọi state-changing cookie-authenticated request phải:

1. Dùng method không phải safe GET.
2. Kiểm tra allowed `Origin` (và `Referer` fallback phù hợp).
3. Yêu cầu CSRF token theo synchronizer token hoặc signed double-submit pattern.
4. Reject missing/mismatched token.
5. Không thay đổi state qua GET.

Guest session dùng per-session synchronizer token hash (M2.4):

- Bootstrap endpoint `POST /guest-sessions` được bảo vệ bằng strict Origin validation và CORS allowlist.
- Bootstrap trả raw CSRF token trong response `Cache-Control: no-store`; database chỉ lưu SHA-256 hash.
- Client giữ token trong memory; mutation yêu cầu trusted `Origin` và `X-CSRF-Token`.
- Endpoint `GET /guest-sessions/csrf-token` cho phép recovery sau khi refresh trang, atomically thay thế token hash cũ bằng hash mới.

Staff session dùng synchronizer token riêng cho từng session:

- Login trả raw CSRF token trong `Cache-Control: no-store` response; database chỉ lưu SHA-256 hash.
- Client giữ token trong memory và gửi `X-CSRF-Token` cho authenticated mutation; không dùng localStorage hoặc persistent browser storage.
- Mutation kiểm tra cả exact trusted `Origin` và token bằng constant-time comparison.
- `GET /staff/auth/me` chỉ đọc và không cần CSRF header.
- Sau browser refresh, `GET /staff/auth/csrf-token` yêu cầu valid staff session + trusted Origin, atomically thay hash cũ bằng hash của replacement token và trả token mới với `Cache-Control: no-store`. Endpoint không tạo session mới và token cũ hết hiệu lực ngay.

## Staff login abuse protection

- Tối đa 5 failed attempts trong 15 phút cho key `normalized email + source IP`; attempt tiếp theo trả `429`.
- Limiter là in-memory cho MVP single API instance, reset khi process restart và không phối hợp giữa nhiều replicas.
- Login errors dùng generic message cho unknown user, wrong password, inactive user/membership và ambiguous membership selection.
- Staff login limiter hiện lấy socket peer và không trust client-provided forwarding headers. Join Code uses the separately authenticated Vercel → Render boundary below; generalizing that boundary to other limiters is a later focused hardening task.
- Không persistent account lockout trong MVP.

Webhook endpoints tương lai không dùng browser CSRF token; chúng dùng provider signature, raw body, event idempotency và endpoint-specific authentication.

## Session expiration and recovery

Staff origin/proxy, guest/activation và Join Code lifecycle keys được validate trong centralized API configuration:

```text
TRUSTED_WEB_ORIGINS=http://localhost:3000  # IMPLEMENTED
GUEST_IDLE_TIMEOUT_MINUTES=30           # IMPLEMENTED
GUEST_ABSOLUTE_TIMEOUT_HOURS=8           # IMPLEMENTED
ACTIVATION_REQUEST_TTL_MINUTES=5        # IMPLEMENTED
GUEST_CLAIM_RECOVERY_TTL_SECONDS=120    # APPROVED FOR M2.6
JOIN_CODE_HASH_SECRET=<32+ random chars> # REQUIRED in production
API_PROXY_SHARED_SECRET=<32+ random>    # REQUIRED on Vercel + Render
```

Runtime-configurable values phải được đọc từ centralized validated configuration. M2.7 Join Code TTL và join credential recovery TTL là fixed contract constants, lần lượt đúng 30 phút và 120 giây; chúng không có environment override.

Recovery flow:

1. API trả `401 GUEST_SESSION_EXPIRED` thay vì silently retry mutation.
2. Frontend giữ draft cart local; cart không chứa authoritative price.
3. UI giải thích session đã hết hạn và yêu cầu rejoin.
4. Guest scan/resolve static table context.
5. Nếu active session tồn tại, nhập valid join code hoặc yêu cầu staff assistance.
6. Server cấp independent credential mới.
7. UI revalidates menu/cart và yêu cầu guest explicit Submit.

Không auto-submit draft sau recovery.

### Guest claim rotation recovery

M2.6 requester claim rotates both the opaque guest cookie token and synchronizer CSRF token when access changes from `BROWSE_ONLY` to `ORDER_ENABLED`. A lost HTTP response must not strand the requester after the old cookie has been replaced server-side.

- Previous token recovery TTL is **120 seconds**, configured centrally by `GUEST_CLAIM_RECOVERY_TTL_SECONDS`. Hai phút đủ cho normal browser retry/Render cold-response recovery nhưng giới hạn exposure của old credential; production configuration phải validate một bounded range `30..300` seconds.
- Database keeps only `previous_token_hash`, `previous_csrf_token_hash` và `previous_token_valid_until`; raw values never enter logs, audit, outbox or idempotency storage.
- Previous cookie is accepted **only** by `POST /activation-requests/current/claim`, only for the original requester, only with trusted Origin, matching previous CSRF token, same claim idempotency key/operation, and before the recovery deadline. It is never accepted by general `GuestSessionGuard`, read endpoints or future order commands.
- Initial claim keeps the old hashes and fixed deadline, installs fresh current hashes, upgrades/binds the session and returns new cookie + CSRF token with `Cache-Control: no-store`.
- If that response is lost, a valid previous-credential retry may reissue another current token pair without repeating access transition or audit. Reissue does not extend the original recovery deadline, so repeated loss cannot create an unbounded old-token chain.
- Current credentials continue to use normal guest authentication. After the deadline, previous credentials fail generically; the guest uses the documented staff/static-QR recovery path and, once implemented, M2.7 join flow.
- Frontend generates one stable idempotency key per explicit claim action, keeps it in table/request-scoped `sessionStorage` only until claim settles or recovery expires, avoids parallel claim requests, and replaces in-memory CSRF state only after a successful response. The key is not a credential and is cleared on terminal failure/success.

## Concurrent activation privacy

- Database cho tối đa một pending request mỗi table.
- Guest thứ hai nhận generic waiting state và thời gian expiry.
- Không trả activation request ID, polling secret, device ID hoặc join code của guest đầu.
- Activation request mặc định hết hạn sau 5 phút; `GET` chỉ project effective expiry, còn request command xử lý write-side expiry trước khi retry.
- `Idempotency-Key` bind vào guest session, operation và SHA-256 request fingerprint; reuse key với payload khác bị reject.
- Sau approval, guest thứ hai phải join bằng code; không được auto-upgrade từ static QR.
- Approval itself never upgrades a guest. Only the original requester can invoke the explicit claim command; other devices cannot infer requester identity or use the previous-token recovery path.

## Join-code controls

- Code gồm đúng sáu chữ số, sinh bằng CSPRNG, TTL 30 phút; database chỉ lưu HMAC-SHA-256 dùng dedicated `JOIN_CODE_HASH_SECRET`. Secret không nằm trong source/database và ngăn offline enumeration của không gian sáu chữ số khi chỉ database bị lộ. Expiration only prevents new joins and does not revoke joined guests.
- Original requester becomes Host only after successful activation claim. Backend derives this relationship from ActivationRequest → requester GuestSession → active TableSession; Host is not an administrative role.
- Host may explicitly issue/replace the code. Plaintext is returned once and may live only in volatile page memory. Reload/reopen returns metadata only and never rotates automatically; explicit replacement confirmation revokes the previous code atomically.
- Staff with `table.join_code.manage` may rotate/revoke within membership location scope.
- PostgreSQL rate limit: 5 failures/10 minutes per browse GuestSession+table, 20/10 minutes per source-IP fingerprint+table, and aggregate 100/10 minutes per TableSession. Threshold starts a fixed 10-minute cooldown. Counters use locked/upserted database rows so parallel requests cannot bypass limits.
- Production source IP đi qua authenticated proxy boundary: Vercel overwrites `x-vercel-forwarded-for` with the public client IP, Next.js Proxy removes any caller-supplied internal headers and signs client IP + timestamp + method + path with `API_PROXY_SHARED_SECRET`, and Render verifies that HMAC within 60 seconds. `POST /table-sessions/join` production requests without valid proof fail closed; arbitrary `X-Forwarded-For` is never authoritative and no proxy-hop count is guessed. Vercel and Render must hold the same independent 32+ character secret.
- Sau verification, source IP chỉ được persist dưới dạng HMAC-SHA-256 fingerprint dùng `JOIN_CODE_HASH_SECRET`; raw code, raw IP và proxy proof không được lưu trong rate-limit records, audit, outbox hoặc idempotency.
- Generic error để tránh enumeration.
- Successful use không dùng chung cookie; mỗi device nhận credential riêng.
- Join-only lost-response recovery lasts 120 seconds and accepts previous guest + CSRF credentials only at `POST /table-sessions/join`, with the same actor/operation/idempotency key. It never extends the deadline or makes previous credentials valid for other endpoints.
- Code invalidation/expiry/session closure blocks new joins only. Existing member credentials remain independent and valid until their normal expiry/revocation/session closure.

Lock order for M2.7 is TableSession → current SessionJoinCode → GuestSession → sorted rate-limit buckets. M2.6 claim already locks ActivationRequest → TableSession → GuestSession, so both paths preserve TableSession-before-GuestSession ordering. Staff approval locks the table/activation before creating a new TableSession and cannot contend on an M2.7 JoinCode row.

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
- Audit activation approve/reject/claim, staff order, cancellation, waiver, cash payment, settlement, session close và table-ready actions. Physical-presence attestation is recorded for approval.
- Security failures trả thông tin tối thiểu nhưng có internal diagnostic correlation.

## Security verification expectations

- CSRF positive/negative tests.
- Cookie attribute checks trong production-like environment.
- Cross-location/resource authorization tests.
- Expiry/revocation and recovery E2E tests.
- Join-code brute-force/rate-limit tests.
- WebSocket handshake, room authorization và revoked-session tests.

## Staff bootstrap

Privileged staff account chỉ được tạo bằng explicit owner-invoked bootstrap operation. `pnpm db:bootstrap:staff` giữ local-only hostname guard. One-time portfolio provisioning dùng riêng `pnpm db:bootstrap:staff:managed -- --allow-managed`, requires direct non-pooler URL, exact independently confirmed host/database và deterministic synthetic restaurant/location scope. Cả hai wrappers reuse cùng transactional provisioning logic và Node.js `scrypt`; migration/application startup không tự tạo account.

Managed exact retry chỉ trả safe already-provisioned result khi active user, password hash verification, single active membership, system `MANAGER` role và complete approved permission grants đều khớp. Mismatch fails closed; bootstrap không reset password, không tạo duplicate membership và không print password/hash/connection string. Credentials chỉ đi qua process-scoped inputs và phải được cleanup sau operation.
