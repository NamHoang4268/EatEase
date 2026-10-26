# Business rules and invariants

Status: **APPROVED baseline**

Đây là authoritative source cho policy nghiệp vụ. Data constraints và transitions chi tiết được liên kết sang architecture documents.

## Restaurant scope

- MVP vận hành một restaurant và một active location.
- Domain và mọi operational record vẫn được scope bằng restaurant/location từ đầu.
- Client-supplied scope không được tin cậy; backend resolve scope từ authenticated membership/guest session.

## Table activation

- Static QR chỉ chứa opaque table identifier và không phải authentication credential.
- Guest có thể browse menu và giữ draft cart trước activation.
- Mỗi table có tối đa một pending activation request và một active TableSession.
- Nếu request đã pending, guest khác thấy waiting state chung nhưng không thấy private credential của requester.
- Waiter/Manager xác nhận physical presence một lần.
- Approval tạo active session/open bill và chuyển bàn sang occupied trong một transaction.
- Cart không tự submit sau approval.

## Guest joining and expiration

- Mỗi device có credential riêng, scope vào đúng TableSession.
- Additional guests dùng temporary join code do authorized guest/staff chia sẻ.
- Join code phải expire hoặc có thể revoke/rotate.
- Idle timeout initial default là 30 phút và phải configurable.
- Absolute timeout là `PROPOSED: 8 giờ`, configurable.
- Credential expiry không làm mất local draft cart và không được silently submit.
- Recovery: static QR → phát hiện active session nhưng chỉ browse → nhập valid join code hoặc yêu cầu staff assistance → cấp credential mới → explicit submit draft.
- Không tự tái tạo order-enabled access chỉ từ static QR.
- Session close revoke toàn bộ credentials và join codes.

## Order submission

- QR và waiter đi qua cùng `SubmitOrder` use case.
- Mỗi explicit submit tạo một immutable Order mới.
- Server revalidate session, permission, menu availability, options và price.
- Client price không authoritative.
- OrderItem lưu name, unit price, modifiers và station snapshots.
- BillLine tương ứng không bị sửa/xóa; correction dùng adjustment.
- Idempotency bắt buộc cho guest/staff submit.

## Fulfillment

- Default item flow: `NEW → PREPARING → READY → SERVED`.
- Direct item có thể `NEW → READY → SERVED`.
- Invalid/out-of-stock item có thể bị `REJECTED` theo authorized workflow.
- Transition phải atomic, kiểm tra expected current state/version và ghi actor/time.

## Cancellation and waiver

### NEW

- Guest tạo request; Waiter/Manager quyết định.
- Approved cancellation chuyển item sang `CANCELLED`.
- Full waiver tự động theo policy.
- Ghi cancellation record, negative full-value BillAdjustment, actor và reason.

### PREPARING

- Waiter forward request tới Kitchen.
- Item giữ `PREPARING` khi request pending.
- Kitchen approve nếu có thể dừng: item `CANCELLED`, automatic full waiver theo policy.
- Kitchen reject: item tiếp tục `PREPARING` và chargeable.
- Kitchen không có quyền tạo arbitrary financial adjustment; waiver chỉ là kết quả policy cố định.
- Không có fixed time-based cancellation window.

### READY / SERVED

- Không ordinary cancellation.
- Exceptional full waiver/correction cần Manager authorization, reason và audit.
- Không partial waiver trong MVP.

## Billing and money

- Một TableSession có đúng một Bill.
- VND được lưu bằng integer đồng, không dùng floating point.
- Displayed server-side price là authoritative; tax/service charge bằng 0 trong MVP.
- Bill amount được derive từ immutable BillLines cộng BillAdjustments.
- Approved cancellation không xóa BillLine; full waiver là negative adjustment.
- Settlement chỉ được tạo khi balance bằng 0.

## Session close and physical table

- Checkout lock ngăn order mới trong lúc thanh toán.
- Nếu payment chưa thành công, authorized flow có thể resume ordering.
- Settlement không tự đóng session.
- Waiter/Manager đóng settled session.
- Close chuyển table `OCCUPIED → CLEANING`.
- Waiter/Manager mark ready để chuyển `CLEANING → AVAILABLE`.
- Không cho phép chuyển trực tiếp `OCCUPIED → AVAILABLE`.

## Reliability invariants

- At most one pending activation request per table.
- At most one active/checkout-locked TableSession per table.
- Exactly one Bill per TableSession.
- At most one Settlement per Bill trong MVP.
- Critical command mutation và idempotency result commit atomically.
- Realtime event chỉ được publish từ committed outbox record.
- Mọi protected request kiểm tra subject, permission, tenant/location, target relationship và state.

Xem [data model](../architecture/data-model.md) và [state machines](../architecture/state-machines.md).
