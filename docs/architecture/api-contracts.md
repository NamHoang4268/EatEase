# API contracts — first vertical slice

Status: **APPROVED planning baseline**. Endpoint implementation chưa bắt đầu.

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

### `POST /guest-sessions`

Establish browse-only device session from static QR.

```json
{ "tablePublicId": "uuid" }
```

Response sets guest cookie and returns public table context. Nếu table có pending activation, response chỉ trả `activationState: "PENDING"`; không trả request ID/credential của guest khác. Nếu đã active, response vẫn `BROWSE_ONLY` và yêu cầu join code.

### `GET /public/menu?tablePublicId={uuid}`

Trả public categories/items, VND integer price, availability và station. Không trả internal inventory/security fields.

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
