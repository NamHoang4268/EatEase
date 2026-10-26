# ADR-0005: Monorepo

- Status: **ACCEPTED**
- Date: 2026-10-26
- Refined by: [ADR-0006](0006-m1-technical-foundation.md) for the initial M1 package set

## Context

Web/API/contracts/infrastructure phát triển đồng bộ bởi một project team, trong khi vẫn cần boundary rõ và tránh chia sẻ domain implementation tùy tiện.

## Decision

Sử dụng monorepo logic:

```text
apps/web
apps/api
packages/contracts
packages/config
packages/testing
infrastructure
docs
```

M0 chỉ tạo placeholder top-level. Tooling/subdirectories được tạo ở M1 sau approval.

ADR-0006 giữ monorepo boundary này nhưng giới hạn initial M1 shared packages vào `packages/eslint-config` và `packages/tsconfig`. Các package generic như `common`, `contracts`, `config`, `database` hoặc `testing` chỉ được tạo sau khi có demonstrated need và đúng dependency boundary.

## Consequences

- Atomic changes và unified quality checks.
- Shared contracts dễ quản lý.
- Phải kiểm soát dependency direction; frontend không import backend/domain internals.
- Workspace tooling là M1 decision/task, chưa được tạo trong M0.
