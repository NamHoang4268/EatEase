# M2.7 production verification evidence

Status: **M2.7 production verification COMPLETE; non-blocking limitations documented**

## Purpose and evidence boundary

Tài liệu này ghi lại production deployment và browser/database observations do owner thực hiện ngày `2026-10-31` và `2026-11-04` theo giờ Việt Nam (`UTC+7`, `Asia/Ho_Chi_Minh`). Nó là durable evidence cho functional M2.7 flow và các security checks được liệt kê rõ bên dưới, không phải chứng nhận universal spoof resistance hoặc production SLA.

Các nhãn evidence được dùng nhất quán:

- `PASS — production observation`: owner trực tiếp quan sát trên deployed application hoặc bằng read-only Neon query được ghi lại bên dưới.
- `PASS — automated tests`: behavior được repository tests/CI bao phủ; task tài liệu này không chạy lại test.
- `NOT EXECUTED — documented limitation`: check có chủ đích không chạy trên Production; automated evidence hoặc giới hạn còn lại được ghi rõ.
- `NOT IN SCOPE — future milestone`: behavior chưa thuộc M2.7.

Không có production request, database mutation, migration, seed hoặc provisioning nào được Codex thực hiện trong task lập tài liệu này.

## Deployment record

### Version and topology

- Repository: `NamHoang4268/EatEase`.
- Deployment commit: `bb179bdbcc34a65604d8d5110653f0df8a9bfcaf` (`bb179bd`).
- Staff Session restoration fix: PR #22, commit `3c4ffb1`; Render API và Vercel Web sau đó cùng deploy commit này.
- Merged PRs:
  - PR #19: `chore/managed-demo-staff-bootstrap`.
  - PR #18: `feat(join-code): implement secure table session joining`.
- Web: `https://eat-ease.vercel.app` on Vercel Hobby.
- API: `https://eatease-api-rbgu.onrender.com` on Render Free, Singapore.
- Database: Neon PostgreSQL Free, Singapore, database `neondb`.

Vercel Production reported **Ready** at `bb179bd`. Render reported **Live** at the same commit. Previously observed API responses were:

```text
GET /api/v1/health
{"status":"ok","service":"api"}

GET /api/v1/health/ready
{"status":"ready","database":"reachable"}
```

Sau khi cập nhật environment, Render được redeploy thành công với trigger `Environment updated`, trạng thái `Deploy succeeded | Live`, commit `bb179bd`, timestamp `2026-10-31 02:31:08 GMT+7` và duration `50.5 seconds`.

### Configuration represented by this verification

- `JOIN_CODE_HASH_SECRET` đã được cấu hình cho Render; giá trị không được ghi lại.
- Matching `API_PROXY_SHARED_SECRET` đã được cấu hình cho Vercel và Render; giá trị không được ghi lại.
- `TRUSTED_WEB_ORIGINS=https://eat-ease.vercel.app` được thêm vào Render để cho phép staff browser origin.
- All seven M2.1–M2.7 migrations đã được apply trước smoke test.
- Deterministic synthetic catalog đã được seed trước smoke test.

## Managed demo Manager provisioning

### Preconditions and scope preflight

Synthetic data đã tồn tại trước provisioning:

- Restaurant: `Bếp Mây Demo` (`10000000-0000-4000-8000-000000000001`).
- Location: `Chi nhánh Demo`, code `HCM-DEMO` (`20000000-0000-4000-8000-000000000001`).
- Tables: A01, A02, B01 và B02.
- Three menu categories and six menu items.

Owner chạy read-only Neon preflight:

```sql
SELECT l.id, l.restaurant_id, l.code, l.is_active, r.status
FROM location AS l
JOIN restaurant AS r ON r.id = l.restaurant_id
WHERE l.id = '20000000-0000-4000-8000-000000000001';
```

Observed result:

| id                                     | restaurant_id                          | code       | is_active | status   |
| -------------------------------------- | -------------------------------------- | ---------- | :-------: | -------- |
| `20000000-0000-4000-8000-000000000001` | `10000000-0000-4000-8000-000000000001` | `HCM-DEMO` |  `true`   | `ACTIVE` |

Owner independently checked the Neon direct endpoint hostname, used the direct/unpooled connection string and supplied the Manager password through PowerShell secure prompts.

### Provisioning command and result

```powershell
pnpm db:bootstrap:staff:managed -- --allow-managed
```

Observed CLI path and result:

```text
pnpm --filter @eatease/api db:bootstrap:staff:managed --allow-managed
tsx scripts/bootstrap-managed-staff.ts --allow-managed
Managed demo Manager provisioning completed.
```

A `pg-connection-string` warning noted a future compatibility change to `sslmode=require` semantics. It did not prevent this provisioning run from completing.

Provisioned identity:

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| Email        | `manager@demo.eatease.invalid`         |
| Display name | `EatEase Demo Manager`                 |
| Role         | Manager                                |
| Location     | `20000000-0000-4000-8000-000000000001` |

Subsequent production login confirmed that the account worked. This evidence does not claim that its password was rotated, reset or independently audited.

## Resolved deployment configuration issue

The owner opened `https://eat-ease.vercel.app/staff/login`. The UI first displayed `Đang kiểm tra phiên…`, then rendered the login form. The first login attempt failed with the generic UI message `Chưa thể đăng nhập. Vui lòng thử lại.`

The browser Network response was:

```json
{
  "error": {
    "code": "UNTRUSTED_ORIGIN",
    "message": "Request origin is not allowed.",
    "details": {},
    "requestId": "6158ec47-2131-4716-a9c0-a54aa05843bd"
  }
}
```

Investigation found that `TRUSTED_WEB_ORIGINS` was missing from the Render environment. Owner added the exact Vercel origin and redeployed Render successfully. No Vercel environment change, code fix or database change was required.

After redeployment, Manager login succeeded. The Staff UI showed `Activation desk`, `Yêu cầu kích hoạt bàn`, identity `EatEase Demo Manager`, location scope `20000000-0000-4000-8000-000000000001`, no initial pending activation request and no initial active TableSession. The generic login error UI was not changed during this verification.

## Public route and catalog evidence

The production root still displayed the M1 foundation page:

```text
Restaurant platform foundation
EatEase
The web and API workspace is ready for milestone-driven development.
API: available
```

This is expected for the current milestone. The Guest UI is served by repository route `apps/web/src/app/t/[publicId]/page.tsx`, exposed as `/t/:publicId`.

### Table discovery

The first investigative query assumed an incorrect table name:

```sql
SELECT *
FROM "table"
LIMIT 5;
```

Observed error:

```text
ERROR: relation "table" does not exist (SQLSTATE 42P01)
```

This was a manual query mistake, not an application failure. Owner then discovered the physical table names:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND (
    table_name ILIKE '%table%'
    OR table_name ILIKE '%dining%'
  )
ORDER BY table_name;
```

Observed tables:

- `restaurant_table`
- `table_session`

```sql
SELECT *
FROM restaurant_table
LIMIT 5;
```

Relevant observed fields:

| code | id                                     | public_id                              | capacity | physical_status | is_active |
| ---- | -------------------------------------- | -------------------------------------- | -------: | --------------- | :-------: |
| A01  | `30000000-0000-4000-8000-000000000001` | `31000000-0000-4000-8000-000000000001` |        2 | `AVAILABLE`     |  `true`   |
| A02  | `30000000-0000-4000-8000-000000000002` | `31000000-0000-4000-8000-000000000002` |        4 | `AVAILABLE`     |  `true`   |
| B01  | `30000000-0000-4000-8000-000000000003` | `31000000-0000-4000-8000-000000000003` |        4 | `AVAILABLE`     |  `true`   |
| B02  | `30000000-0000-4000-8000-000000000004` | `31000000-0000-4000-8000-000000000004` |        6 | `AVAILABLE`     |  `true`   |

All four records belonged to restaurant `10000000-0000-4000-8000-000000000001` and location `20000000-0000-4000-8000-000000000001`.

### A01 browser observation

Owner opened the following URL in a separate incognito browser session:

```text
https://eat-ease.vercel.app/t/31000000-0000-4000-8000-000000000001
```

The UI displayed restaurant `Bếp Mây Demo`, location `Chi nhánh Demo`, table A01, capacity 2, activation readiness, categories `Món Việt`, `Món nhẹ`, `Đồ uống`, six seeded menu items with descriptions/prices and an activation action. This verifies the public web → API → Neon catalog path for A01.

## Activation and Join Code smoke-test timeline

1. **Guest 1 requested activation.** From A01, Guest 1 selected `Yêu cầu kích hoạt bàn`; the UI changed to `Đang chờ nhân viên`.
2. **Manager received the request.** After refreshing Activation desk, Manager saw A01 in `Đang chờ xác nhận`, capacity 2, version 0, displayed expiry, and approval/rejection controls.
3. **Manager approved physical presence.** Manager checked `Tôi đã trực tiếp xác nhận khách đang có mặt tại bàn này.` and selected `Duyệt kích hoạt`.
4. **Guest 1 explicitly claimed access.** Guest 1 saw the approved message, selected `Tiếp tục với bàn đã kích hoạt`, then saw `Bàn đã sẵn sàng cho phiên của bạn` and `Đã cấp quyền tại bàn`.
5. **Guest 1 issued a Join Code.** A six-digit Join Code was generated successfully. Its plaintext was not retained in this evidence.
6. **Guest 2 joined independently.** In another browser session with separate cookies, Guest 2 opened the same A01 URL, entered the code and saw `Bàn đã sẵn sàng cho phiên của bạn` plus `Đã cấp quyền tại bàn`.

The Guest UI stated that sending orders belongs to a later milestone. No order submission was performed or verified.

## Subsequent production security verification

Các checks dưới đây được owner thực hiện ngày `2026-11-04` theo giờ Việt Nam (`UTC+7`). Không có Join Code plaintext, credential, raw IP hoặc secret nào được giữ trong evidence.

### Direct unsigned Render request

Owner gửi trực tiếp một unsigned `POST /api/v1/table-sessions/join` tới Render API, bỏ qua Vercel signer. Lúc `16:08:11`, Render trả HTTP `403 Forbidden` với application error `TRUSTED_PROXY_REQUIRED` và request ID `f6daa9bf-4f5e-43af-9855-34e3d9aa2103`.

Kết quả này xác nhận deployed API fail closed khi Join Code mutation không có valid trusted-proxy proof. Nó không tự chứng minh mọi forged-signature hoặc header-propagation scenario.

### Join Code rotation and revocation

- Rotation tạo replacement code; previous code bị reject ngay và replacement code được một Guest mới dùng thành công.
- Guest đã được authorize trước rotation vẫn truy cập được TableSession.
- Staff revocation làm current code bị reject cho new join.
- Các Guest đã được authorize trước revocation vẫn truy cập được TableSession.

Các observations này phù hợp với contract: rotation/revocation chỉ chặn new joins và không revoke existing Guest Sessions.

### Natural 30-minute expiration

- Code E1 được tạo lúc `17:17`.
- Một fresh Guest join thành công lúc `17:23`.
- E1 đạt contract expiry lúc `17:47`.
- Một fresh Guest bị reject khi thử E1 lúc `17:49`.
- Guest đã được authorize trước expiry vẫn hợp lệ sau browser refresh lúc `17:49`.

Không thay system clock, database timestamp hoặc TTL configuration. Kết quả xác nhận natural expiration chặn new joins sau đúng contract window mà không revoke existing Guest Sessions.

### Staff Session restoration regression

PR #22, commit `3c4ffb1`, chuyển Staff CSRF recovery sang `POST /api/v1/staff/auth/csrf-token` và giữ strict Origin/session validation. Sau khi Render API và Vercel Web cùng deploy commit này, owner xác nhận một existing Staff Session được restore sau browser refresh và CSRF recovery trả HTTP `200`.

### IP spoof-resistance audit and regression coverage

Focused code audit không tìm thấy confirmed bypass cho phép caller-supplied forwarding headers chọn IP rate-limit bucket. Vercel signer thay caller-supplied internal proof; Render verifier bind HMAC vào client IP, HTTP method, pathname và timestamp.

Regression evidence sau remediation:

- API Join Source IP tests: `31/31` PASS.
- Web proxy signer tests: `14/14` PASS.
- API và Web typechecks: PASS.
- Coverage gồm missing/malformed/combined proof, caller proof replacement, independent signed-field tampering, IPv4 và các IPv6 representations được hỗ trợ hiện tại.

Equivalent IPv6 textual representations vẫn chưa được canonicalize. Tests cố ý preserve behavior hiện tại và không claim chúng tạo cùng signature hoặc rate-limit bucket.

### Wi-Fi and mobile 4G IP bucket separation

Owner thực hiện đúng một invalid Join Code attempt qua Wi-Fi và một attempt qua mobile 4G. Cả hai đều bị reject; không chạy threshold loop. Read-only Neon observation sau đó thấy hai distinct `IP_TABLE` fingerprints, chỉ ghi prefix không thể dùng để khôi phục raw IP:

| Network | Fingerprint prefix | failed_attempts | updated_at (UTC+7)    |
| ------- | ------------------ | --------------: | --------------------- |
| Wi-Fi   | `a47e1248baf4`     |               1 | `2026-11-04 18:40:57` |
| 4G      | `ca09f7f90a42`     |               1 | `2026-11-04 18:50:40` |

Không bucket nào bị blocked. Observation này xác nhận hai deployed network identities tạo distinct persistent buckets; nó không chứng minh universal spoof resistance hoặc mọi IPv4/IPv6/provider topology.

## Read-only database evidence

### Active TableSession

The initial query used a non-existent `created_at` column:

```sql
SELECT id, table_id, status, created_at
FROM table_session
WHERE table_id = '30000000-0000-4000-8000-000000000001'
ORDER BY created_at DESC;
```

Observed error:

```text
ERROR: column "created_at" does not exist (SQLSTATE 42703)
```

Owner inspected the schema:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'table_session'
ORDER BY ordinal_position;
```

Observed columns: `id`, `restaurant_id`, `location_id`, `table_id`, `activation_request_id`, `status`, `activated_by_membership_id`, `activated_at`, `checkout_locked_at`, `closed_by_membership_id`, `closed_at`, `close_reason`, `version`.

The corrected query was:

```sql
SELECT
    id,
    table_id,
    status,
    activated_at,
    closed_at,
    activation_request_id
FROM table_session
WHERE table_id = '30000000-0000-4000-8000-000000000001'
ORDER BY activated_at DESC;
```

Observed one row:

| Field                 | Value                                  |
| --------------------- | -------------------------------------- |
| id                    | `eafcab5e-e87b-4583-8740-58689cab7e28` |
| table_id              | `30000000-0000-4000-8000-000000000001` |
| status                | `ACTIVE`                               |
| activated_at          | `2026-10-30 19:44:39.772+00`           |
| closed_at             | `NULL`                                 |
| activation_request_id | `5e9e9908-6e23-410a-b3b0-c3147aa7a51c` |

This establishes that exactly one TableSession for A01 was returned by this query at verification time. It does not assert the absence of sessions for other tables.

### GuestSession membership

Owner discovered relevant tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND (
    table_name ILIKE '%guest%'
    OR table_name ILIKE '%participant%'
    OR table_name ILIKE '%session%'
  )
ORDER BY table_name;
```

Observed tables: `guest_session`, `session_join_code`, `staff_session`, `table_session`.

Owner inspected `guest_session` without selecting credential hashes:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'guest_session'
ORDER BY ordinal_position;
```

Observed columns: `id`, `restaurant_id`, `location_id`, `table_id`, `table_session_id`, `token_hash`, `csrf_token_hash`, `access_level`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `last_seen_at`, `created_at`, `version`, `previous_token_hash`, `previous_csrf_token_hash`, `previous_token_valid_until`.

No token or CSRF hash value was selected or shared. Final verification query:

```sql
SELECT
    table_session_id,
    access_level,
    COUNT(*) AS guest_count,
    COUNT(*) FILTER (WHERE revoked_at IS NULL) AS not_revoked_count
FROM guest_session
WHERE table_session_id = 'eafcab5e-e87b-4583-8740-58689cab7e28'
GROUP BY table_session_id, access_level
ORDER BY access_level;
```

Observed result:

| table_session_id                       | access_level    | guest_count | not_revoked_count |
| -------------------------------------- | --------------- | ----------: | ----------------: |
| `eafcab5e-e87b-4583-8740-58689cab7e28` | `ORDER_ENABLED` |           2 |                 2 |

This establishes that two non-revoked GuestSession records were associated with the same active A01 TableSession at verification time. It does not independently prove source-IP separation, expiry enforcement, every authorization boundary or the absence of sessions outside A01.

## Evidence status

### PASS — production observation

- API liveness and database readiness returned the recorded healthy bodies.
- Managed demo Manager provisioning completed.
- Manager login succeeded after correcting `TRUSTED_WEB_ORIGINS`.
- Public A01 table and seeded catalog rendered.
- Guest activation request reached the Manager queue.
- Manager approval completed after physical-presence confirmation.
- Guest 1 explicitly continued and received table-session access.
- Guest 1 created a six-digit Join Code.
- Guest 2 accepted that code in an independent browser session.
- One active A01 TableSession was observed.
- Two non-revoked `ORDER_ENABLED` GuestSessions were linked to that TableSession.
- Direct unsigned Render Join Code mutation returned `403 TRUSTED_PROXY_REQUIRED`.
- Rotation rejected the previous code, accepted the replacement and preserved existing Guest access.
- Revocation rejected the revoked code and preserved existing Guest access.
- Natural 30-minute expiration rejected E1 after expiry and preserved the previously joined Guest.
- Staff Session restoration survived browser refresh after PR #22 deployment; POST CSRF recovery returned `200`.
- Wi-Fi and mobile 4G invalid attempts produced two distinct non-blocked `IP_TABLE` fingerprints.

### PASS — automated tests

Existing repository evidence, not rerun for this documentation task:

- GitHub CI passed for the merged managed-bootstrap and M2.7 PRs.
- M2.7 implementation evidence records 47 API unit/request tests, 34 web unit/component tests and 8 focused PostgreSQL integration tests passing on isolated local database `eatease_m2_test`, plus formatting, lint, typecheck and production builds.
- Focused tests cover fixed 30-minute code TTL and 120-second recovery; Host-only issue; explicit replacement; independent member join; expiry; operation-scoped recovery/idempotency; guest/IP/aggregate rate-limit persistence; signed source-IP verification; spoofed-header rejection; distinct trusted-IP buckets; frontend retry-key reuse; CSRF recovery; and explicit Host/staff replacement confirmation.
- Additional IP spoof-resistance regression evidence records `31/31` API tests and `14/14` Web tests passing, plus API/Web typechecks.

Automated coverage supports threshold/concurrency behavior that was intentionally not load-tested on Production. Production observations confirm deployed fail-closed behavior and two-network bucket separation, but do not establish universal spoof resistance.

### NOT EXECUTED — documented limitations

- Production rate-limit thresholds were not exercised with brute-force/high-volume traffic; threshold, cooldown and concurrency enforcement remain supported by PostgreSQL integration tests.
- Equivalent IPv6 representations are not canonicalized and may create distinct fingerprints. This is a non-blocking hardening follow-up.
- The evidence does not cover every proxy provider, VPN, NAT, IPv4/IPv6 transition or compromised-secret scenario.

### NOT IN SCOPE — future milestone

- Order submission, immutable Order/BillLine persistence and consolidated bill preview.
- Kitchen/fulfillment workflows.
- Settlement, TableSession closure and physical table reset.
- Outbox publication/realtime delivery.

## Limitations and non-claims

- M2.7 acceptance and scoped production verification are complete based on functional observations, focused security checks and automated coverage. This is not a general security certification.
- No Join Code, password, database URL, endpoint hostname secret, cookie, CSRF value or token is recorded here.
- The successful browser flow does not independently prove every concurrency, authorization, expiry or rate-limit invariant.
- The read-only queries establish only the rows and scopes they explicitly selected at that moment.
- The resolved `TRUSTED_WEB_ORIGINS` incident was a deployment configuration issue, not a code or database defect.
- The two investigative SQL errors were incorrect manual schema assumptions, not application failures.
- Production threshold testing was intentionally omitted to avoid blocking legitimate demo users.
- IPv6 textual canonicalization remains a non-blocking follow-up.

## Production demo cleanup recommendation

Cleanup was not performed as part of this documentation task.

- A01 was observed with an active TableSession and authorized Guest Sessions during verification. No later session-close evidence is recorded here, so these records may remain until their normal lifecycle/expiry.
- Rotated, revoked and expired Join Code records are historical evidence; they cannot authorize new joins and do not require direct deletion.
- If Staff UI reports a current active Join Code, an authorized Manager may revoke it through the existing staff workflow. Do not delete or rewrite Join Code rows manually.
- Guest credentials should expire through their configured idle/absolute timeouts. No manual database revocation is required solely for this verification record.
- TableSession close, table cleaning and return to `AVAILABLE` belong to M4 and are not implemented by M2.7. Leave A01's synthetic demo state intact until an approved application workflow can close it; do not issue direct SQL updates to simulate lifecycle transitions.
- The synthetic Manager may remain for the portfolio demo. Log out/revoke its current Staff Session when it is not needed; any account removal or password rotation should use a separately reviewed operational procedure.

The absence of cleanup does not block M2.7 completion because cleanup is an operational follow-up, not an M2.7 acceptance criterion.
