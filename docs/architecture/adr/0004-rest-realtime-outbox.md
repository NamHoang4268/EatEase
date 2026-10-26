# ADR-0004: REST, Socket.IO and transactional outbox

- Status: **ACCEPTED**
- Date: 2026-10-26

## Context

Kitchen/waiter UI cần cập nhật nhanh, nhưng network/WebSocket delivery không đáng tin cậy và không được phép trở thành nguồn business state.

## Decision

- REST là authoritative command/query interface.
- Socket.IO phát notification sau commit.
- Business transaction ghi outbox event cùng state change.
- Publisher retry unpublished events; consumers/UI chịu duplicate và refetch authoritative REST data.
- Không thêm external broker trong MVP.

## Consequences

- Commit không phụ thuộc socket availability.
- Có eventual notification latency nhỏ.
- Cần outbox locking/retry/observability và cleanup policy.
- Event payload giữ tối thiểu, versioned và không chứa dữ liệu vượt permission.
