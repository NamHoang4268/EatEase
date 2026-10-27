# API contracts — first vertical slice

Status: **APPROVED planning baseline**. M2.2 public table/menu reads, M2.3 staff authentication và M2.4 guest browse session đã được implement; activation và business mutation contracts còn lại tiếp tục theo milestone task tương ứng.

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

Nếu đã có pending request, trả `200/202` waiting representation cho current device mà không lộ requester data. Không tạo duplicate request/session.

### `GET /activation-requests/current`

Current planning baseline cho guest poll request gắn với credential hiện tại và sau approval từng dự kiến nâng access level/trả initial join code trong response. Cách mô tả này xung đột với security rule không thay đổi state qua `GET`.

`PROPOSED — pending owner approval`:

- `GET /activation-requests/current` chỉ đọc và trả activation state; không rotate cookie, nâng access hoặc issue join code.
- Sau trạng thái `APPROVED`, frontend gọi idempotent `POST /activation-requests/current/claim` với CSRF protection.
- Claim command revoke/rotate browse credential và cấp independent `ORDER_ENABLED` credential; exact join-code effect được chốt cùng activation/join-code contract.
- Không endpoint nào nhận hoặc tự submit cart.

Cho tới khi proposal được owner approve, M2.6 activation approval/claim không được implement dựa trên assumption ngầm.

### `GET /staff/activation-requests?status=PENDING`

Permission: `table.activation.read`.

### `POST /staff/activation-requests/{id}/approve`

Headers: `Idempotency-Key`, version precondition, CSRF token.

Atomic effects: activation approved, TableSession + Bill created, table occupied, requester guest upgraded, join code/outbox/audit created.

`PROPOSED — pending owner approval`: approval transaction vẫn tạo TableSession/Bill và occupy table atomically, nhưng requester credential upgrade/join-code issuance chuyển sang explicit claim command ở trên. Proposal này chưa thay thế approved baseline.

### `POST /staff/activation-requests/{id}/reject`

```json
{ "reason": "Không có khách tại bàn" }
```

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

Lock request/table; validate pending/unexpired/available; create session/bill; occupy table; upgrade guest; create code/audit/outbox/idempotent response; commit atomically.

### Submit order

Claim idempotency; authorize; validate active session/menu; snapshot prices; create Order/Items/BillLines; update Bill; add outbox; persist response; commit atomically.

Chi tiết constraints: [data model](data-model.md). Security headers/cookies: [security](security.md).
