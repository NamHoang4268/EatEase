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
| `PENDING` | Waiter approve     | `APPROVED`  |
| `PENDING` | Waiter reject      | `REJECTED`  |
| `PENDING` | TTL reached        | `EXPIRED`   |
| `PENDING` | Requester withdraw | `CANCELLED` |

Approval tạo TableSession; nó không tạo Order.

## TableSession

| From                       | Command              | To                | Condition                  |
| -------------------------- | -------------------- | ----------------- | -------------------------- |
| none                       | Approve activation   | `ACTIVE`          | Table available            |
| `ACTIVE`                   | Request checkout     | `CHECKOUT_LOCKED` | Billing ready              |
| `CHECKOUT_LOCKED`          | Resume ordering      | `ACTIVE`          | Bill chưa settled          |
| `ACTIVE`                   | Cancel empty session | `CANCELLED`       | Không có chargeable item   |
| `CHECKOUT_LOCKED`          | Close                | `CLOSED`          | Bill settled               |
| `ACTIVE`/`CHECKOUT_LOCKED` | Force close          | `CLOSED`          | Manager + correction/audit |

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

`REJECTED`, `CANCELLED`, `SERVED` là terminal. Manager financial correction cho `READY/SERVED` không đổi operational state.

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
