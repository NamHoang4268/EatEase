# MVP requirements

Status: **APPROVED baseline**

## Product objective

EatEase hỗ trợ nhà hàng dine-in tiếp nhận order, chuẩn bị và phục vụ món, thu tiền, settlement và quay vòng bàn qua một workflow đáng tin cậy.

Core flow:

`QR / Waiter → TableSession → Orders → Fulfillment → Bill → Payment → Settlement → Close → Cleaning → Available`

## Actors

- Guest customer: không bắt buộc đăng nhập.
- Waiter.
- Kitchen Staff.
- Cashier.
- Manager/Admin.

Một staff account có thể có nhiều roles trong cùng restaurant/location membership.

## Functional scope

### Hybrid ordering

- Guest scan static QR để xem menu và request activation.
- Waiter xác nhận physical presence một lần cho dining session.
- Approval chỉ cấp quyền ordering; không tự submit cart.
- Guest explicit submit order.
- Waiter có thể nhập order thay khách.
- QR order và staff order tạo các Order riêng nhưng thuộc cùng TableSession và Bill.
- Guest có thể gọi thêm món nhiều lần.

### Multiple guests

- Mỗi thiết bị có guest credential riêng.
- Additional device join active session bằng temporary join code hoặc staff assistance.
- Static QR một mình không cấp ordering permission.
- Join code expire/revocable; credentials bị revoke khi session đóng.

### Fulfillment

- Mỗi OrderItem được route tới `KITCHEN`, `BAR` hoặc `DIRECT` bằng snapshot.
- Unified fulfillment board trong MVP.
- Item lifecycle được theo dõi riêng thay vì dùng một trạng thái cho toàn order/bill.
- Waiter đánh dấu món đã phục vụ.

### Billing and table lifecycle

- Một TableSession có nhiều Orders và đúng một consolidated Bill.
- VND lưu bằng integer; tax và service charge mặc định bằng 0.
- Cash/cashier settlement là payment scope đầu tiên.
- Settlement không tự đóng TableSession.
- Session close không tự làm bàn available.
- Waiter/Manager đóng session, bàn chuyển cleaning, sau đó mark ready.

### Cancellation

- Guest chỉ request cancellation.
- Waiter cancel item `NEW`.
- `PREPARING` cancellation cần Kitchen decision.
- Approved `NEW`/`PREPARING` cancellation nhận automatic full waiver.
- `READY`/`SERVED` không có ordinary cancellation.
- Không xóa historical item/bill line.

Chi tiết authoritative: [business rules](business-rules.md).

## Non-functional requirements

- Backend authorization trên mọi protected operation.
- Restaurant/location/resource scoping.
- Idempotent critical commands.
- Database constraints và transaction safety.
- Audit actor/reason cho sensitive operations.
- Database là source of truth; realtime chỉ là notification.
- Test concurrency, authorization và failure recovery từ milestone liên quan.

## Deferred from initial MVP

- Split bills và partial payments.
- Automated refunds.
- Booking, pre-order và deposit.
- Loyalty và vouchers.
- AI assistant và social login.
- Advanced reports, custom IAM editor và multi-location operations UI.
- Online payment provider integration.
