# API contracts — first vertical slice

Status: **APPROVED planning baseline**. M2.2 public table/menu reads, M2.3 staff authentication, M2.4 guest browse session và M2.5 activation request/read-only queue đã được implement. M2.6 approval, rejection và requester claim contracts đã được owner approve và được đặc tả tại đây; implementation vẫn chưa hoàn thành.

Base path: `/api/v1`. REST là authoritative; Socket.IO event chỉ báo client refetch state.

## Conventions

- JSON request/response.
- State-changing critical commands nhận `Idempotency-Key`.
- Version-sensitive commands nhận `If-Match` hoặc `expectedVersion` theo contract được chốt khi implementation.
- Cookie-authenticated mutations yêu cầu CSRF token; xem [security](security.md).
- Client không gửi authoritative restaurant/location/price.

Error envelope:

```json
{
  "error": {
    "code": "TABLE_SESSION_NOT_ACTIVE",
    "message": "Phiên dùng bàn chưa hoạt động",
    "requestId": "uuid",
    "details": {}
  }
}
```

Relevant status codes: `400`, `401`, `403`, `404`, `409`, `422`, `429`.

## Guest bootstrap and menu

### `GET /public/tables/{publicId}`

Resolve opaque static-QR table identifier thành public browse context. Endpoint không tạo guest session, credential, activation request hoặc business mutation.

```json
{
  "data": {
    "publicId": "uuid",
    "restaurantName": "Bếp Mây Demo",
    "locationName": "Chi nhánh Demo",
    "tableLabel": "A01",
    "capacity": 2,
    "availability": "AVAILABLE"
  }
}
```

`availability` là public presentation state: `AVAILABLE`, `BROWSE_ONLY` hoặc `UNAVAILABLE`; không expose exact internal workflow data. Unknown/inactive restaurant, location hoặc table trả generic `404 PUBLIC_TABLE_NOT_FOUND`.

### `POST /guest-sessions`

Establish browse-only device session from static QR. Requires trusted `Origin`.

```json
{ "tablePublicId": "uuid" }
```

Response sets guest cookie `eatease_guest_session` and returns public table context with `Cache-Control: no-store`:

```json
{
  "data": {
    "table": {
      "publicId": "uuid",
      "restaurantName": "Bếp Mây Demo",
      "locationName": "Chi nhánh Demo",
      "tableLabel": "A01",
      "capacity": 2,
      "availability": "AVAILABLE"
    },
    "activationState": "NOT_REQUESTED",
    "session": {
      "accessLevel": "BROWSE_ONLY",
      "idleExpiresAt": "2026-10-28T12:30:00.000Z",
      "absoluteExpiresAt": "2026-10-28T20:00:00.000Z"
    },
    "csrfToken": "opaque-token"
  }
}
```

Nếu client đã có session hợp lệ trên cùng bàn, endpoint tái sử dụng session, gia hạn idle expiration (tối đa tới absolute expiration) và cấp CSRF token mới mà không tạo thêm record database dư thừa. Khi bàn chưa có TableSession hay ActivationRequest (M2.4 scope), `activationState` trả về giá trị an toàn `NOT_REQUESTED`.

### `GET /guest-sessions/csrf-token`

CSRF recovery sau browser refresh cho guest. Yêu cầu valid guest cookie và trusted `Origin`. Atomically thay `csrfTokenHash` trong database, trả về raw replacement token với `Cache-Control: no-store`.

```json
{
  "data": {
    "csrfToken": "opaque-token"
  }
}
```

### `GET /guest-sessions/current`

Đọc thông tin phiên làm việc hiện tại của guest. Yêu cầu valid guest cookie. Trả về access level, thời hạn và thông tin bàn.

```json
{
  "data": {
    "session": {
      "accessLevel": "BROWSE_ONLY",
      "idleExpiresAt": "2026-10-28T12:30:00.000Z",
      "absoluteExpiresAt": "2026-10-28T20:00:00.000Z"
    },
    "table": {
      "publicId": "uuid"
    }
  }
}
```

### `GET /public/menu?tablePublicId={uuid}`

Trả active public categories/items theo deterministic order, VND integer price, availability và station. Không trả internal inventory/security fields hoặc data thuộc location khác.

```json
{
  "data": {
    "currency": "VND",
    "categories": [
      {
        "id": "uuid",
        "name": "Món Việt",
        "items": [
          {
            "id": "uuid",
            "name": "Cơm gà lá chanh",
            "description": "Cơm thơm, gà áp chảo và lá chanh.",
            "priceAmount": "79000",
            "currency": "VND",
            "fulfillmentStation": "KITCHEN",
            "available": true
          }
        ]
      }
    ]
  }
}
```

`priceAmount` là decimal integer string trong JSON để serialize PostgreSQL/Prisma `BIGINT` không mất precision; frontend dùng integer-safe arithmetic và không xem local draft value là authoritative khi submit ở task tương lai.

## Staff authentication

Staff endpoints dùng opaque host-only cookie `eatease_staff_session`; raw session token không xuất hiện trong JSON. CSRF-bearing responses luôn `Cache-Control: no-store`.

### `POST /staff/auth/login`

Requires exact trusted `Origin`. `locationId` có thể bỏ qua khi user chỉ có đúng một active membership; nếu có nhiều active memberships thì client phải chọn location. Invalid credentials/scope/status dùng cùng generic `401 STAFF_AUTHENTICATION_FAILED`.

```json
{
  "email": "manager@example.test",
  "password": "user-provided secret",
  "locationId": "uuid"
}
```

Successful response sets staff cookie and returns staff scope/effective permissions, absolute `expiresAt` và raw `csrfToken` để client giữ trong memory. Password và raw session token không được trả về.

### `GET /staff/auth/me`

Requires valid staff cookie; read-only và không cần CSRF header. Response trả current user, membership, restaurant/location scope và effective permissions. Session expiry không được extend.

### `GET /staff/auth/csrf-token`

CSRF recovery sau browser refresh. Requires valid staff cookie và trusted `Origin`; atomically replaces stored CSRF hash, returns replacement raw token với `Cache-Control: no-store`, không tạo staff session mới. Token trước đó hết hiệu lực.

### `POST /staff/auth/logout`

Requires valid staff cookie, trusted `Origin` và `X-CSRF-Token`. Revokes session immediately, clears cookie và trả `204`.

Protected staff mutations dùng `StaffSessionGuard` + `StaffCsrfGuard`; business handlers additionally declare required permission và validate resource relationship/location. Thiếu permission, wrong scope hoặc missing authorization metadata đều deny by default.

## Activation

### `POST /activation-requests`

Headers: `Idempotency-Key`, CSRF token.

```json
{ "tablePublicId": "uuid" }
```

Response `202`:

```json
{
  "data": {
    "activationRequestId": "uuid",
    "status": "PENDING",
    "expiresAt": "ISO-8601"
  }
}
```

Request mới trả `202`. Idempotent replay giữ nguyên response/status; nếu table đã có pending request thì trả `200` waiting representation mà không tạo duplicate request/session. Chỉ requester device nhận `activationRequestId`; device khác chỉ nhận `status` và `expiresAt`. TTL mặc định 5 phút, cấu hình qua `ACTIVATION_REQUEST_TTL_MINUTES`.

### `GET /activation-requests/current`

Endpoint này strictly read-only và trả effective activation state; expiry có thể được project thành `EXPIRED` mà không lazy-write. Endpoint không rotate cookie, renew guest session, nâng access, issue join code hoặc nhận/tự submit cart.

Chỉ requester device nhận activation request `id` và `version`; guest khác tại cùng bàn chỉ nhận generic waiting state. Khi request là `APPROVED`, requester response cho biết explicit claim action đang available nhưng không chứa TableSession ID, credential hoặc staff data.

### `GET /staff/activation-requests?status=PENDING`

Permission: `table.activation.read`.

M2.5 chỉ hỗ trợ query `status=PENDING`, scope theo authenticated staff membership location, loại request đã hết hạn và không trả guest/requester identifiers.

### `POST /staff/activation-requests/{id}/approve`

Permission: `table.activation.approve`. Requires valid staff session, authenticated membership location scope, trusted `Origin`, `X-CSRF-Token` và `Idempotency-Key`.

```json
{
  "expectedVersion": 0,
  "physicalPresenceConfirmed": true
}
```

`physicalPresenceConfirmed` phải đúng bằng `true`; missing/false trả `400 PHYSICAL_PRESENCE_CONFIRMATION_REQUIRED`. Server không suy ra physical presence từ GPS, static QR hoặc client location. Success trả `200` với activation request status/version/handled time, table status/version, TableSession `ACTIVE` và Bill `OPEN`; response không chứa guest identifier, raw credential hoặc join code.

```json
{
  "data": {
    "activationRequest": {
      "id": "uuid",
      "status": "APPROVED",
      "version": 1,
      "handledAt": "ISO-8601"
    },
    "table": {
      "publicId": "uuid",
      "physicalStatus": "OCCUPIED",
      "version": 1
    },
    "tableSession": { "id": "uuid", "status": "ACTIVE", "version": 0 },
    "bill": {
      "id": "uuid",
      "status": "OPEN",
      "subtotalAmount": "0",
      "adjustmentAmount": "0",
      "totalAmount": "0",
      "paidAmount": "0",
      "balanceAmount": "0",
      "version": 0
    }
  }
}
```

Transaction atomically:

1. revalidates staff session, `table.activation.approve`, membership scope và request relationship;
2. locks/revalidates table + request, yêu cầu request `PENDING`, unexpired, matching `expectedVersion`, table `AVAILABLE`;
3. transitions request sang `APPROVED`, records handler/time và increments version;
4. creates exactly one `ACTIVE` TableSession linked to request and one zero-value `OPEN` Bill;
5. transitions table `AVAILABLE → OCCUPIED` và increments table version;
6. persists sanitized idempotency response, approval audit và approved outbox records; rồi commit.

Approval không upgrade requester credential, issue join code, create Order hoặc submit cart. Duplicate replay cùng actor/operation/key/fingerprint returns stored success without duplicate side effects. Same key với khác fingerprint trả conflict.

### `POST /staff/activation-requests/{id}/reject`

Permission, session, scope, Origin, CSRF và idempotency requirements giống approval.

```json
{
  "expectedVersion": 0,
  "reason": "Không có khách tại bàn"
}
```

`reason` là trimmed, non-empty và tối đa 500 ký tự. Success trả `200` với request `REJECTED`, incremented version, handler/time và reason. Transaction locks/revalidates table + request, transitions request, persists sanitized idempotency response, rejection audit và `activation.updated` outbox event atomically. Nó không tạo TableSession/Bill, không thay đổi table state và không upgrade guest.

```json
{
  "data": {
    "activationRequest": {
      "id": "uuid",
      "status": "REJECTED",
      "version": 1,
      "handledAt": "ISO-8601",
      "rejectionReason": "Không có khách tại bàn"
    }
  }
}
```

Approve/reject dùng operations riêng `APPROVE_ACTIVATION`/`REJECT_ACTIVATION`. Missing authentication trả `401`; missing permission/wrong location/resource relationship trả generic `403`; stale `expectedVersion` trả `409 ACTIVATION_VERSION_CONFLICT`; expired request trả `409 ACTIVATION_REQUEST_EXPIRED`; terminal/non-pending request trả `409 ACTIVATION_REQUEST_NOT_PENDING`; approval khi table không còn `AVAILABLE` trả `409 TABLE_NOT_AVAILABLE`. Expiry persistence xảy ra write-side trước khi trả expired conflict.

Sau khi authenticate/authorize actor và validate request shape, command resolves an existing same-key idempotency record + fingerprint **before** current-state/version rejection. Vì vậy retry của một committed success nhận stored logical success dù `expectedVersion` nay đã cũ; request mới với key khác vẫn nhận `409`. Authorization và location scope luôn được revalidated, kể cả khi replay.

### `POST /activation-requests/current/claim`

Requester-only command. Requires valid guest cookie, trusted `Origin`, matching `X-CSRF-Token` và `Idempotency-Key`.

```json
{ "expectedVersion": 1 }
```

Server derives request/restaurant/location/table từ guest session, requires the current guest session to be `requester_guest_session_id`, request `APPROVED` at `expectedVersion`, and its linked TableSession to be `ACTIVE`. Other devices receive generic denial and cannot claim by knowing an ID. Success atomically upgrades that same guest session from `BROWSE_ONLY` to `ORDER_ENABLED`, binds it to the approved TableSession, increments guest-session version, rotates both guest cookie token and CSRF token, and persists claim audit + sanitized idempotency result. It does not change activation version, create an Order, submit cart or issue a join code.

Response sets replacement `eatease_guest_session` cookie and uses `Cache-Control: no-store`:

```json
{
  "data": {
    "session": {
      "accessLevel": "ORDER_ENABLED",
      "tableSessionId": "uuid",
      "version": 1
    },
    "csrfToken": "opaque-token"
  }
}
```

Retry safety follows the 120-second previous-token recovery contract in [security](security.md#guest-claim-rotation-recovery). A retry with the valid previous cookie + previous CSRF token and the same idempotency key may reissue fresh current credentials without repeating the logical access transition or audit. Raw token/CSRF values are never stored in idempotency, audit, outbox or logs.

Invalid/expired guest credentials trả `401`; non-requester dùng generic `403 ACTIVATION_CLAIM_NOT_ALLOWED`; stale activation `expectedVersion` trả `409 ACTIVATION_VERSION_CONFLICT`; request chưa `APPROVED` hoặc linked TableSession không `ACTIVE` trả `409 ACTIVATION_CLAIM_NOT_AVAILABLE`. Error không expose requester identity hoặc cross-location resource existence.

## Join active session

### `POST /table-sessions/join`

Headers: `Idempotency-Key`, CSRF token.

```json
{
  "tablePublicId": "uuid",
  "joinCode": "482193"
}
```

Valid code issues an independent order-enabled guest credential. Endpoint is rate-limited by table, guest browser session và source signals.

### `POST /table-sessions/current/join-code`

Authorized guest/Waiter/Manager rotates code and receives plaintext once. Previous code is revoked in same transaction.

## Explicit order submission

### `POST /orders`

Headers: `Idempotency-Key`, CSRF token.

```json
{
  "items": [
    {
      "menuItemId": "uuid",
      "quantity": 2,
      "modifierSelections": [],
      "note": "Không hành"
    }
  ]
}
```

Scope và source được derive từ guest credential. Request không chứa authoritative price/session/restaurant/location. Response trả immutable snapshots và updated bill preview.

### `POST /staff/table-sessions/{sessionId}/orders`

Cùng DTO và internal `SubmitOrder` use case; actor/source là staff. Permission `order.create_for_table` và location relationship bắt buộc.

## Reads for active session

### `GET /table-sessions/current`

Trả session status, orders, item statuses, consolidated bill preview và expiry metadata cần cho recovery UI.

Khi guest cookie expired: `401 GUEST_SESSION_EXPIRED`; frontend giữ local draft và hiển thị rejoin flow, không retry submit tự động.

## Fulfillment queue

### `GET /staff/fulfillment/items?status=NEW&station=KITCHEN`

Permission `fulfillment.read`. Unified board có filters `KITCHEN|BAR|DIRECT`. Response không chứa payment/customer-sensitive fields.

## Realtime events

Planned event names:

```text
activation.requested
activation.updated
order.submitted
fulfillment.item.created
fulfillment.item.updated
bill.updated
table.session.updated
```

- Handshake authenticates cookie session.
- Subscribe/join room là authorized command riêng.
- Guest chỉ join room của TableSession hiện tại.
- Staff rooms scope theo active membership/location/permission.
- Event payload có resource ID/version tối thiểu; client refetch REST.

## Transaction contracts

### Approve activation

Lock table, then activation request; validate pending/unexpired/version/available and staff scope; create linked session + bill; occupy table; write idempotency/audit/outbox; commit atomically. Requester credential upgrade is a separate claim transaction.

### Reject activation

Use the same table → activation-request lock order; validate pending/unexpired/version/scope; reject request and write idempotency/audit/outbox atomically. No session, bill or table mutation.

### Claim approved activation

Lock activation request, linked TableSession and requester guest session in deterministic order; validate requester/version/state relationship; upgrade + bind guest, rotate credentials, and write audit/idempotency atomically. Credential recovery retries may reissue only ephemeral credentials within the bounded previous-token window.

### Submit order

Claim idempotency; authorize; validate active session/menu; snapshot prices; create Order/Items/BillLines; update Bill; add outbox; persist response; commit atomically.

Chi tiết constraints: [data model](data-model.md). Security headers/cookies: [security](security.md).
