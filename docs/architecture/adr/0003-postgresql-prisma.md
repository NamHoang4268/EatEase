# ADR-0003: PostgreSQL and Prisma

- Status: **ACCEPTED**
- Date: 2026-10-26

## Context

EatEase cần relational integrity giữa TableSession, Orders, Bill, Payment và Settlement; đồng thời cần partial uniqueness, transaction, row locking và audit history.

## Decision

- PostgreSQL là system of record.
- Prisma là ORM/migration tool mặc định.
- Database constraints có authority cao hơn convenience của ORM.
- Review generated migrations và dùng custom SQL khi cần partial index, check/composite constraint hoặc database-native capability.
- Integration/concurrency tests chạy trên PostgreSQL thật.

## Consequences

- Business invariants được enforce tại database boundary.
- Prisma tăng TypeScript productivity nhưng team phải hiểu SQL/transactions.
- Migration review là bắt buộc; không dùng `db push` như production migration strategy.
- Raw/typed SQL hoặc row-locking API được phép trong repository implementation có kiểm soát.

## Alternatives

- MongoDB: linh hoạt nhưng kém phù hợp với relational/financial invariants của domain này.
- Drizzle/query builder: SQL control tốt; có thể reconsider nếu Prisma cản trở critical design thực tế.
- TypeORM: không được chọn do Prisma baseline đã được phê duyệt.
