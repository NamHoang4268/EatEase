# Roles and permissions

Status: **APPROVED baseline**

## Authorization model

- Staff user có một membership theo location và nhiều roles.
- Effective permissions là union của permissions thuộc active roles.
- Có role không đủ để authorize: backend còn kiểm tra active membership, restaurant/location, resource relationship và current state.
- Guest authorization dựa vào server-side guest session, không dựa vào static QR hoặc client-provided table/session ID.
- Deny by default trên HTTP và WebSocket.

## Matrix

| Capability | Guest | Waiter | Kitchen | Cashier | Manager/Admin |
|---|:---:|:---:|:---:|:---:|:---:|
| View public menu | ✓ | ✓ | ✓ | ✓ | ✓ |
| Request activation | ✓ |  |  |  |  |
| Approve/reject activation |  | ✓ |  |  | ✓ |
| Join bằng code | ✓ |  |  |  |  |
| Generate/share join code | Authorized | ✓ |  |  | ✓ |
| Rotate/revoke join code |  | ✓ |  |  | ✓ |
| View own session/orders | ✓ | Location | Operational only | Bill only | ✓ |
| Submit QR order | ✓ |  |  |  |  |
| Submit staff order |  | ✓ |  |  | ✓ |
| Request cancellation | ✓ | ✓ |  |  | ✓ |
| Cancel `NEW` |  | ✓ |  |  | ✓ |
| Forward `PREPARING` request |  | ✓ |  |  | ✓ |
| Decide preparation stop |  |  | ✓ |  | ✓ |
| Move item to PREPARING/READY |  |  | ✓ |  | ✓ |
| Mark item served |  | ✓ |  |  | ✓ |
| View fulfillment board |  | Optional | ✓ |  | ✓ |
| View bill | Own session | ✓ | No amounts | ✓ | ✓ |
| Request checkout | ✓ | ✓ |  | ✓ | ✓ |
| Record cash payment |  |  |  | ✓ | ✓ |
| Arbitrary financial adjustment |  |  |  |  | ✓ |
| Close settled session |  | ✓ |  |  | ✓ |
| Mark table ready |  | ✓ |  |  | ✓ |
| Manage menu/tables/staff |  |  |  |  | ✓ |
| View audit/reporting |  |  |  | Limited | ✓ |

## Initial permission codes

```text
table.activation.read
table.activation.approve
table.session.read
table.session.close
table.mark_ready
table.join_code.manage
order.create_for_table
order.read
order.cancel_new
cancellation.forward_to_kitchen
cancellation.decide_operational
fulfillment.read
fulfillment.transition
serving.mark_served
bill.read
bill.checkout
bill.adjust
payment.cash_record
menu.manage
staff.manage
audit.read
```

Guest capabilities không được lưu như staff roles; chúng được derive từ access level và relationship của guest session.

## Enforcement tests

Mỗi protected command phải có test cho:

- Allowed actor.
- Missing authentication.
- Authenticated nhưng thiếu permission.
- Đúng permission nhưng sai location.
- Đúng location nhưng sai resource relationship.
- Revoked/expired membership hoặc guest session.
- Invalid state transition.
