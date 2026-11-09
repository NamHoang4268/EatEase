# State machines

Status: **APPROVED baseline**

Mọi transition được enforce phía server, kiểm tra permission + scope + expected state và ghi audit khi cần.

## Physical Table

| From                   | Command               | To               | Actor/condition                    |
| ---------------------- | --------------------- | ---------------- | ---------------------------------- |
| `AVAILABLE`            | Approve activation    | `OCCUPIED`       | Waiter/Manager; atomic với session |
| `OCCUPIED`             | Close settled session | `CLEANING`       | Waiter/Manager                     |
| `CLEANING`             | Mark ready            | `AVAILABLE`      | Waiter/Manager                     |
| `AVAILABLE`/`CLEANING` | Disable               | `OUT_OF_SERVICE` | Manager                            |
| `OUT_OF_SERVICE`       | Restore               | `AVAILABLE`      | Manager                            |

Không có transition trực tiếp `OCCUPIED → AVAILABLE`.

## ActivationRequest

| From      | Command/event      | To          |
| --------- | ------------------ | ----------- |
| none      | Guest request      | `PENDING`   |
| `PENDING` | Staff approve      | `APPROVED`  |
| `PENDING` | Staff reject       | `REJECTED`  |
| `PENDING` | TTL reached        | `EXPIRED`   |
| `PENDING` | Requester withdraw | `CANCELLED` |

Approval requires `table.activation.approve`, matching location scope, expected version và explicit staff physical-presence attestation. Nó atomically tạo TableSession `ACTIVE` + Bill `OPEN` và chuyển table `AVAILABLE → OCCUPIED`; nó không upgrade guest, issue join code hoặc tạo Order. Rejection chỉ chuyển request sang `REJECTED`, không tạo các resource trên hoặc đổi table state. Concurrent approve/reject races được serialize bằng deterministic row locks + state/version checks; stale loser trả `409`.

Sau approval, original requester phải explicit claim để chuyển chính GuestSession của mình `BROWSE_ONLY → ORDER_ENABLED` và bind vào TableSession. Claim không phải ActivationRequest state transition và không thay đổi activation version.

## TableSession

| From                       | Command              | To                | Condition                  |
| -------------------------- | -------------------- | ----------------- | -------------------------- |
| none                       | Approve activation   | `ACTIVE`          | Table available            |
| `ACTIVE`                   | Request checkout     | `CHECKOUT_LOCKED` | Billing ready              |
| `CHECKOUT_LOCKED`          | Resume ordering      | `ACTIVE`          | Bill chưa settled          |
| `ACTIVE`                   | Cancel empty session | `CANCELLED`       | Không có chargeable item   |
| `CHECKOUT_LOCKED`          | Close                | `CLOSED`          | Bill settled               |
| `ACTIVE`/`CHECKOUT_LOCKED` | Force close          | `CLOSED`          | Manager + correction/audit |

M4.1 implements only checkout and staff-only resume. Billing ready means nonempty submitted ordering history with immutable BillLines, every item SERVED/CANCELLED/REJECTED, no pending cancellation and OPEN Bill with no recorded payment. Guest checkout is limited to its own ORDER_ENABLED session; staff checkout/resume requires `bill.checkout` and location scope. Checkout atomically changes ACTIVE/OPEN to CHECKOUT_LOCKED/PAYMENT_PENDING; resume reverses both while no payment/settlement has occurred. Both versions increment once; monetary values and fulfillment/table history remain unchanged. Existing Guest credentials and Bill reads remain valid while locked, but new orders and new joins are denied. See [M4.1 API contracts](api-contracts.md#checkout-lock-and-resume-m41). Empty-session cancellation, payment, settlement and close remain later M4 work.

## Guest access and Session Join Code

`BROWSE_ONLY → ORDER_ENABLED` happens only through explicit requester claim after activation approval or successful Join Code verification. Join rotates only that device's guest + CSRF credentials; Host/member credentials remain independent.

```text
NONE ── explicit Host/staff issue ──> ACTIVE
ACTIVE ── explicit rotate ──────────> REVOKED + new ACTIVE
ACTIVE ── explicit staff revoke ────> REVOKED
ACTIVE ── expires_at reached ───────> EXPIRED (effective)
ACTIVE ── TableSession not ACTIVE ──> unusable
```

- Plaintext exists only in the issue/rotate response and volatile issuer UI memory.
- Reload/reopen never rotates automatically; metadata tells Host/staff whether a current code exists.
- Expiration/revocation affects new joins only and never terminates member sessions already bound to the TableSession.
- Successful join does not consume the code; multiple guests may use it until expiry, rotation, revocation or TableSession closure.

## Order

Owner-approved M2.8 contract (`2026-11-04`): `OrderStatus = SUBMITTED` only. Order is an immutable submission record; it has no aggregate `PREPARING` or `COMPLETED` state. Fulfillment transitions belong to individual OrderItems.

## OrderItem

| From        | Command              | To          | Actor                        |
| ----------- | -------------------- | ----------- | ---------------------------- |
| `NEW`       | Start preparation    | `PREPARING` | Kitchen                      |
| `NEW`       | Mark direct ready    | `READY`     | Authorized fulfillment staff |
| `NEW`       | Reject unavailable   | `REJECTED`  | Kitchen                      |
| `NEW`       | Approve cancellation | `CANCELLED` | Waiter/Manager               |
| `PREPARING` | Mark ready           | `READY`     | Kitchen                      |
| `PREPARING` | Approve stop request | `CANCELLED` | Kitchen via request          |
| `READY`     | Mark served          | `SERVED`    | Waiter                       |

`REJECTED`, `CANCELLED`, `SERVED` là terminal for ordinary fulfillment commands. M3.6 Manager exceptional correction changes NEW/PREPARING/READY to CANCELLED with a full waiver; a SERVED item remains SERVED and receives only a separate immutable full financial waiver. Preparation/readiness/serving history is never cleared.

M3.1 implements `NEW → PREPARING` for KITCHEN/BAR snapshots. M3.2 adds KITCHEN/BAR `PREPARING → READY` and DIRECT `NEW → READY`, requiring `fulfillment.transition`. DIRECT cannot start preparation; KITCHEN/BAR cannot skip it. M3.3 exposes these actions on the staff board. M3.4 adds READY → SERVED for all stations with the separate `serving.mark_served` permission; SERVED is terminal and has no further UI action. These commands share expectedVersion, atomic membership audit/outbox/idempotency and preserve immutable snapshots. M3.5 adds the cancellation workflow below and Kitchen/Bar direct rejection of eligible NEW items; both accepted paths end in CANCELLED with a policy-fixed full waiver. See the [fulfillment and cancellation API contracts](api-contracts.md#fulfillment-queue).

## CancellationRequest

| From              | Event                              | To                | Actor                      |
| ----------------- | ---------------------------------- | ----------------- | -------------------------- |
| none              | Guest requests                     | `PENDING_WAITER`  | Guest                      |
| none              | Waiter requests stop for PREPARING | `PENDING_KITCHEN` | Waiter                     |
| `PENDING_WAITER`  | Cancel NEW item                    | `APPROVED`        | Waiter                     |
| `PENDING_WAITER`  | Forward PREPARING request          | `PENDING_KITCHEN` | Waiter                     |
| `PENDING_WAITER`  | Decline request                    | `REJECTED`        | Waiter                     |
| `PENDING_KITCHEN` | Can stop                           | `APPROVED`        | Kitchen                    |
| `PENDING_KITCHEN` | Cannot stop                        | `REJECTED`        | Kitchen                    |
| `PENDING_*`       | Withdraw                           | `WITHDRAWN`       | Requester/authorized staff |

Approved `NEW`/`PREPARING` cancellation atomically creates automatic full-waiver adjustment. Kitchen chỉ kích hoạt predefined policy, không được nhập adjustment tùy ý.

M3.5 persists every Guest request initially as `PENDING_WAITER`; requesting never changes the item or Bill. A Waiter/Manager may approve a still-NEW item, reject the request, or forward a still-PREPARING KITCHEN/BAR item. Only `PENDING_KITCHEN` may receive the Kitchen/Bar stop decision. Kitchen/Bar direct rejection of a NEW KITCHEN/BAR item creates an already-approved `STAFF_REJECTION` record. Approval/direct rejection atomically changes the item to CANCELLED, increments its version, creates exactly one immutable full-waiver adjustment and updates Bill aggregates. Rejection changes only the request lifecycle. READY, SERVED, REJECTED and CANCELLED cannot be approved through this ordinary workflow.

M3.6 uses a separate approved `MANAGER_CORRECTION` record. If a Guest request is pending, it transitions to WITHDRAWN before the correction is recorded. The Manager command does not reopen terminal request records and cannot create a second waiver. SERVED remains operationally terminal even after its financial obligation is fully waived.

## Bill

| From              | Command                  | To                | Condition                 |
| ----------------- | ------------------------ | ----------------- | ------------------------- |
| none              | Activate session         | `OPEN`            | Same transaction          |
| `OPEN`            | Request checkout         | `PAYMENT_PENDING` | Session lock succeeds     |
| `PAYMENT_PENDING` | Payment failed/cancelled | `OPEN`            | Chưa settled              |
| `PAYMENT_PENDING` | Record full payment      | `SETTLED`         | Balance = 0               |
| `OPEN`            | Void valid empty bill    | `VOID`            | Authorized policy/Manager |

## Payment

| From                   | Command/event            | To           |
| ---------------------- | ------------------------ | ------------ |
| none                   | Initiate                 | `CREATED`    |
| `CREATED`              | Process external payment | `PROCESSING` |
| `CREATED`              | Record cash              | `SUCCEEDED`  |
| `PROCESSING`           | Provider success         | `SUCCEEDED`  |
| `PROCESSING`           | Provider decline         | `FAILED`     |
| `PROCESSING`           | Outcome uncertain        | `UNKNOWN`    |
| `CREATED`/`PROCESSING` | Safe cancel              | `CANCELLED`  |

Online states được thiết kế trước nhưng provider integration là deferred. Cash MVP có thể tạo payment trực tiếp ở `SUCCEEDED` trong settlement transaction.
