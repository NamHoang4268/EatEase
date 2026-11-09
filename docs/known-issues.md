# Known Issues & Technical Debt Tracker

Tracker nhẹ cho confirmed issues, investigation items, accepted limitations và future enhancements. Không thay thế business/API contracts hoặc milestone acceptance; không ghi secrets, credentials hay personal data. Issue status bên dưới độc lập với task status trong [implementation plan](planning/implementation-plan.md).

## Severity and triage

- **Critical/Blocker:** financial integrity, security/authorization, data loss hoặc broken core flow — xử lý ngay, không defer sang polish.
- **Major:** material functional disruption — xử lý trước khi đóng milestone bị ảnh hưởng.
- **Minor/Cosmetic:** document và defer khi có reliable workaround.
- **Investigation:** behavior chưa được xác nhận; không khẳng định root cause hoặc defect khi chưa có evidence. Triage lại nếu phát hiện operational impact đáng kể.

Mỗi entry giữ stable ID, classification, reproduction/evidence, workaround, target và resolution/verification. `Deferred` không đồng nghĩa resolved; chỉ đóng khi có fix hoặc explanation được xác minh và ghi evidence. Accepted limitation không phải defect; future enhancement chỉ là candidate scope cho owner gate, không phải committed requirement.

## Open and deferred UI observations

## M4.1-UI-01 — Stale checkout success message after Staff Resume

- **Severity:** Minor.
- **Classification:** Confirmed UI feedback defect.
- **Status:** Open / Deferred.
- **Evidence:** owner-reported local M4.1 manual UI validation; recorded 2026-11-09, không phải production verification.
- **Reproduction:** Guest checkout thành công; Staff resumes ordering; tab Guest ban đầu cập nhật về ACTIVE/OPEN nhưng vẫn hiển thị “Đã khóa gọi món để chờ thanh toán.”, kể cả sau khi bấm “Cập nhật”.
- **Expected:** checkout success feedback cũ biến mất hoặc được thay bằng feedback phù hợp sau resume.
- **Confirmed impact:** cart được giữ nguyên, order submission được bật lại, Bill vẫn 48,000 VND; checkout/resume business state hoạt động đúng trong scenario đã quan sát. Đây là stale feedback, không phải bằng chứng lock hoặc financial state sai.
- **Workaround:** dựa vào session/Bill status hiện tại, không dựa vào success message cũ.
- **Target:** M4.5 — UI/UX Implementation & Polish.
- **Resolution / verification:** Pending. Khi xử lý, verify checkout → Staff resume → Guest refetch/realtime; feedback phải khớp ACTIVE/OPEN, cart và Bill không đổi. Ghi fix/reference và kết quả trước khi đóng.

## M4.1-RT-01 — Guest fulfillment status did not update automatically

- **Severity:** Investigation; functional severity chưa xác định.
- **Classification:** Investigation item; chưa xác nhận defect.
- **Status:** Needs Investigation / Deferred.
- **Evidence:** owner-reported local M4.1 manual UI validation; recorded 2026-11-09, không phải production verification.
- **Reproduction observation:** Staff marks item SERVED; Guest vẫn hiển thị DIRECT · NEW. Bấm “Cập nhật” lập tức hiển thị DIRECT · SERVED.
- **Root cause:** Unknown. Chưa xác nhận realtime defect hoặc nguyên nhân ở event routing, subscription, delivery hay frontend refresh.
- **Expected:** đối chiếu approved realtime/API contracts để xác minh transition này có chủ đích trigger automatic Guest refresh hay không.
- **Workaround:** bấm “Cập nhật” để đọc authoritative state mới nhất.
- **Target:** M4.5 — UI/UX Implementation & Polish; triage sớm hơn nếu điều tra cho thấy operationally significant impact, theo policy phía trên.
- **Resolution / verification:** Pending. Khi điều tra, ghi expected contract, connection/subscription state, notification và REST-refetch evidence; verify NEW → SERVED visibility và manual fallback. Chỉ đóng sau khi có explanation hoặc fix được xác minh; không coi manual refresh thành công là bằng chứng automatic refresh đã hoạt động.

## UX-STAFF-01 — Staff workspace selection state resets after browser refresh

- **Severity:** Minor.
- **Classification:** Confirmed UX continuity issue; persisted business data không bị mất.
- **Status:** Open / Deferred.
- **Evidence:** owner-reported local M4.2 manual acceptance; recorded 2026-11-09, không phải production verification.
- **Reproduction:** chọn Staff workspace filters/TableSession rồi refresh browser. Authentication được khôi phục và persisted Bill vẫn đọc được sau khi chọn lại bàn, nhưng selectors/filters trở về default nên ban đầu tạo cảm giác dữ liệu đã biến mất.
- **Expected:** cân nhắc khôi phục safe UI selection qua URL state hoặc `sessionStorage`, chỉ sau khi revalidate Staff session, authorization và resource còn nằm trong current location scope.
- **Workaround:** chọn lại workspace filter và TableSession sau refresh.
- **Target:** M4.5 — UI/UX Implementation & Polish.
- **Resolution / verification:** Pending. Khi xử lý, verify refresh với valid, expired/revoked và changed-scope Staff sessions; stale/unauthorized selection phải bị loại bỏ, không được dùng persisted UI state như authorization.

## UX-CASHIER-01 — Cashier Bill panel flashes during authoritative refetch

- **Severity:** Minor/Cosmetic.
- **Classification:** Confirmed transient presentation issue; không phải financial-state defect.
- **Status:** Open / Deferred.
- **Evidence:** owner-reported local M4.2 manual acceptance; recorded 2026-11-09, không phải production verification.
- **Reproduction:** khi relevant realtime invalidation trigger REST refetch, Cashier Bill panel tạm chuyển sang loading content trước khi snapshot mới xuất hiện. Authoritative Bill sau refresh đúng và checkout/resume amounts không đổi.
- **Expected:** có thể giữ previous snapshot hiển thị với non-blocking refreshing indicator trong khi request mới chạy; stale response protection và REST authority phải được giữ nguyên.
- **Workaround:** chờ refetch hoàn tất; manual “Cập nhật” vẫn khả dụng.
- **Target:** M4.5 — UI/UX Implementation & Polish.
- **Resolution / verification:** Pending. Verify previous content không bị hiểu là final after an error, newer selection không bị old response overwrite, và refreshed financial snapshot vẫn lấy hoàn toàn từ server.

## Runtime investigations

### E2E-RUNTIME-01 — Intermittent Next.js `ECONNRESET` / `Error: aborted`

- **Severity:** Medium.
- **Classification:** Investigation item; không phải confirmed production defect.
- **Status:** Needs Investigation / Deferred.
- **Reproduction context:** một số full Playwright runs hoàn tất `6/6 PASS` nhưng Next.js development server ghi intermittent `ECONNRESET`, `Error: aborted` và `uncaughtException` gần cuối suite. Exact request/socket và lifecycle phase gây lỗi chưa được xác định.
- **Current evidence:** hai targeted diagnostic runs sau đó PASS và không tái hiện `ECONNRESET` hoặc `uncaughtException`. Vì symptom có tính intermittent, kết quả này không chứng minh issue đã được fix.
- **Supporting teardown observations:** khi nhiều browser contexts đóng gần đồng thời, ba requests đã nhận response headers (`200`, `201`, `403`) nhưng diagnostics không nhận terminal request events; một số WebSocket connections cũng không có observed close event. Đây là event-bookkeeping observations, không chứng minh request hoặc connection bị stuck, leaked hay mất dữ liệu.
- **Instrumentation history:** targeted diagnostics từng ghi `MaxListenersExceededWarning` trên `ServerResponse`. Test-only observer sau đó được sửa để không thêm `ServerResponse` listener, bound socket listener và phân biệt response headers với terminal events; focused diagnostics tests PASS. Warning không xuất hiện trong targeted run sau thay đổi, nên đây là investigation history, không phải current standalone bug và không có issue ID riêng.
- **Expected:** full E2E lifecycle kết thúc không phát sinh unhandled server exception; diagnostics phải đủ để quy lỗi cho application request/proxy, framework lifecycle hoặc browser/server teardown trước khi thay đổi production code.
- **Workaround:** none required for the passing assertions; không suppress warning/error, thêm arbitrary delay/retry hoặc coi passing suite là bằng chứng symptom vô hại.
- **Reopen conditions:** symptom tái hiện; Playwright exit khác `0`; active-test request thất bại; assertion/state mismatch; resource/listener growth lặp lại; hoặc production/runtime evidence có cùng signature. Khi reopen, giữ warning stack, timestamp, request method/safe pathname, context-close và webServer termination chronology.
- **Target:** task financial/lifecycle E2E closure cuối M4 trong [implementation plan](planning/implementation-plan.md#m4--checkout-and-table-lifecycle). Repository hiện không định nghĩa task `M4.7`; nếu không ảnh hưởng M4 closure, carry forward vào [M5 — Production readiness and AWS](planning/roadmap.md#m5--production-readiness-and-aws).
- **Resolution / verification:** Pending. Chỉ đóng khi có root cause + focused regression, hoặc evidence đủ mạnh chứng minh framework/test-lifecycle behavior với repeatable clean full-suite verification. Hai targeted non-reproductions hiện tại không đủ để đóng.

## Accepted limitations and future enhancements

### UX-CART-01 — Draft cart does not survive reload or separate tabs

- **Severity:** Not applicable.
- **Classification:** Accepted current limitation / future enhancement candidate; không phải confirmed bug.
- **Status:** Documented / Deferred.
- **Current behavior:** Guest draft cart dùng volatile React in-memory state. Cart được giữ qua activation, credential recovery, checkout/resume và REST/realtime refresh trong cùng page lifecycle, nhưng không được giữ sau full page reload và không đồng bộ sang tab khác.
- **Expected for current scope:** không silently submit draft; authoritative menu price và ordering permission vẫn do server revalidate. Cross-reload/tab persistence chưa phải approved requirement.
- **Workaround:** giữ tab Guest hiện tại mở cho đến khi submit; sau reload hoặc ở tab khác, tạo lại draft.
- **Target:** candidate review tại [M4.5 — UI/UX Implementation & Polish](planning/roadmap.md#m45--uiux-implementation--polish). Owner gate phải quyết định persistence model, expiry, menu/version reconciliation và privacy trước implementation.
- **Resolution / verification:** No fix scheduled. Nếu được approve, add explicit acceptance/tests cho reload/tab behavior và bảo đảm persisted draft không trở thành credential hoặc auto-submit.
