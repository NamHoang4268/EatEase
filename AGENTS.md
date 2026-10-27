# AGENTS.md

## Project identity

- Tên chính thức: **EatEase**.
- Đây là codebase mới, tách biệt hoàn toàn với EatEase legacy.
- Không gọi sản phẩm là “EatEase V2”, “EatEase Next” hoặc tên tương tự trong artifact chính thức.
- Chỉ sửa file bên trong repository này khi làm việc cho EatEase.
- Repository legacy là read-only reference trừ khi người dùng cấp quyền khác một cách rõ ràng.

## Read first

Trước khi lập kế hoạch hoặc thay đổi source, đọc:

1. [docs/README.md](docs/README.md)
2. [docs/product/requirements.md](docs/product/requirements.md)
3. [docs/product/business-rules.md](docs/product/business-rules.md)
4. [docs/architecture/overview.md](docs/architecture/overview.md)
5. [docs/planning/implementation-plan.md](docs/planning/implementation-plan.md)
6. [docs/planning/decision-log.md](docs/planning/decision-log.md)
7. [docs/development/git-workflow.md](docs/development/git-workflow.md)

Đọc thêm tài liệu module/state/API liên quan trực tiếp đến task.

## Approved architecture boundaries

- TypeScript monorepo, Next.js App Router, NestJS/Express, PostgreSQL và Prisma.
- Modular Monolith; không tự ý đưa microservices, Kafka, Kubernetes hoặc distributed infrastructure vào MVP.
- REST là authoritative command/query interface.
- Socket.IO chỉ vận chuyển notification; database là source of truth.
- Reliable notification dùng transactional outbox.
- Business modules không truy cập persistence internals của module khác một cách tùy tiện.
- Database constraints, transaction boundaries, idempotency và server-side authorization là yêu cầu cốt lõi.

## Documentation-first workflow

1. Xác định task thuộc milestone nào và kiểm tra dependency/status.
2. Kiểm tra quyết định liên quan trong decision log và ADR.
3. Nếu task thay đổi business behavior đã `APPROVED`, dừng và yêu cầu phê duyệt; không silently reinterpret.
4. Nếu có quyết định kỹ thuật mới mang tính lâu dài, tạo/cập nhật ADR trước hoặc cùng implementation.
5. Cập nhật authoritative document, sau đó sửa các link/tóm tắt phụ nếu cần.
6. Sau implementation, cập nhật task status và bằng chứng verification.

Không tạo tài liệu trùng lặp. Mỗi quyết định lớn phải có một authoritative location và các tài liệu khác liên kết tới đó.

## Fast-track execution

- Khi một task đã được giao và scope đủ rõ, thực hiện cohesive cycle: đọc context liên quan, phân tích tập trung, implement, verify, tự review, sửa lỗi rồi báo cáo.
- Không tách routine implementation thành nhiều vòng proposal/approval nếu approved architecture và requirements đã đủ hướng dẫn.
- Tự quyết định project configuration, internal structure, standard framework usage, testing layout, error handling và minor refactoring trong approved task scope.
- Ưu tiên giải pháp đơn giản, maintainable; tránh speculative abstraction và overengineering.
- Với authentication, authorization, concurrency, financial integrity hoặc transaction, phải tăng độ sâu của negative/failure/concurrency tests và nêu trade-off đáng kể trong completion report.
- Chỉ dừng xin clarification khi cần đổi approved business rule, cần major architecture change, approved decisions xung đột, còn unresolved security/financial decision quan trọng hoặc có critical blocker.
- Internal steps có thể được gộp thành một outcome-oriented delivery khi task authorization bao phủ chúng; không tự mở rộng sang milestone hoặc unrelated scope khác.
- Fast-track không hạ quality bar, không biến assumption thành approved decision và không thay đổi Git authorization hoặc milestone approval gates.

## Decision statuses

- `APPROVED`: đã được người dùng phê duyệt; không thay đổi ngầm.
- `PROPOSED`: recommendation đang chờ phê duyệt hoặc validation.
- `OPEN`: chưa có quyết định đủ để implementation phụ thuộc vào nó.
- `DEFERRED`: có chủ đích nằm ngoài MVP hiện tại.

Thay đổi decision status phải được ghi vào [decision-log.md](docs/planning/decision-log.md). Architectural change đáng kể phải có ADR mới; không rewrite lịch sử ADR đã superseded.

## Progress tracking

Dùng các status: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.

- Chỉ một task đang thực sự được thực hiện mới là `IN_PROGRESS`.
- `BLOCKED` phải ghi rõ blocker và điều kiện unblock.
- Chỉ đánh dấu implementation task `DONE` khi code, test và verification liên quan đã hoàn tất.
- Viết planning document không đồng nghĩa implementation đã hoàn thành.

## Milestone approval gates

- Không bắt đầu milestone mới cho đến khi milestone trước đã được verify và người dùng phê duyệt rõ ràng việc tiếp tục.
- Tại mỗi milestone boundary, báo cáo kết quả và verification, sau đó dừng để chờ phê duyệt.
- Phê duyệt tài liệu hoặc kế hoạch không tự động cấp quyền cho implementation, Git/GitHub operations, infrastructure changes hoặc cloud provisioning tiếp theo.

## Git workflow

- Tuân thủ [Git workflow](docs/development/git-workflow.md) về Conventional Commits, task branches và Pull Requests.
- Với mỗi task, đề xuất branch name và commit message phù hợp.
- Không tự động tạo branch, commit, push, Pull Request hoặc merge; mỗi operation cần explicit authorization riêng từ người dùng.
- Không force-push hoặc rewrite shared history nếu chưa có explicit authorization.
- PR approval không thay thế milestone approval gate.
- Cuối mỗi task, cung cấp exact scoped `git add`, `git commit -m "..."`, lệnh push đúng branch, suggested PR title và PR body; chỉ cung cấp để owner thực hiện, không tự chạy nếu chưa được cấp quyền riêng.

## Business consistency rules

- QR và waiter orders dùng cùng TableSession và Bill.
- Activation phải được staff xác nhận đúng một lần cho mỗi dining session.
- Approval không tự submit cart; customer phải explicit submit.
- Static QR không phải credential.
- Mỗi thiết bị có guest credential riêng; additional devices dùng temporary join code.
- Submitted Orders và OrderItem/BillLine snapshots không bị overwrite hoặc xóa.
- Cancellation và financial waiver phải có actor, reason và audit.
- Payment settlement không tự đóng session hoặc đưa bàn về available.
- Giá do server quyết định; tiền VND dùng integer.

## Frontend and UI design

- Trước mọi frontend/UI task, đọc và tuân thủ [UI/UX design guidelines](docs/design/ui-guidelines.md).
- Giữ đúng Modern Editorial SaaS — Soft Yellow & Neutral direction, semantic design tokens và surface-specific UX.
- Bento là preferred pattern khi cải thiện content hierarchy, không được ép vào task-oriented workflow.
- Visual reference không được thay đổi business rules, permissions, API contracts, security controls hoặc state transitions.
- Không tự nghiên cứu hoặc áp dụng competing visual style nếu chưa có explicit owner approval.

## Testing and quality

- Test ở mức phù hợp với rủi ro: unit, integration với PostgreSQL thật, authorization, concurrency và end-to-end.
- Không mock database cho constraint/transaction/concurrency tests quan trọng.
- Mọi protected endpoint phải có allowed, denied, wrong-scope và revoked-session cases.
- Mutation quan trọng phải kiểm tra retry/idempotency.
- Không báo hoàn thành nếu chưa chạy verification phù hợp; nếu không thể chạy, nêu rõ phần chưa xác minh.
- Không bỏ qua lỗi lint/type/test để đạt trạng thái xanh giả tạo.

## Environment files and secrets

- Xem mọi environment file thật (`.env`, `.env.*`) là sensitive.
- Mặc định không đọc, sửa, sao chép, in hoặc expose environment file thật.
- Có thể đọc và cập nhật `.env.example` chỉ chứa placeholder trong task liên quan.
- Mọi thay đổi environment file thật cần explicit, task-specific authorization từ người dùng.
- Quyền sửa environment file không tự động cấp quyền expose nội dung của file đó.
- Không bao giờ commit credential, token, connection string hoặc secret khác.
- Ưu tiên cập nhật `.env.example` và document required variables để người dùng tự cấu hình giá trị thật.

## Change safety

- Không commit, push, tạo remote, provision cloud hoặc cài dependency nếu chưa được cấp quyền.
- Không sửa unrelated user changes.
- Không dùng destructive Git/filesystem commands nếu chưa được yêu cầu rõ ràng.
- Luôn kiểm tra repository boundary và `git status` trước/sau thay đổi lớn.
