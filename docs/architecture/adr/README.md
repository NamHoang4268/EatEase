# Architecture Decision Records

ADR ghi lại lý do và trade-off của quyết định kỹ thuật lâu dài. ADR đã accepted không bị rewrite để che mất lịch sử; thay đổi lớn tạo ADR mới với quan hệ `Supersedes`.

| ADR                                          | Decision                                                       | Status   |
| -------------------------------------------- | -------------------------------------------------------------- | -------- |
| [ADR-0001](0001-modular-monolith.md)         | Modular Monolith                                               | ACCEPTED |
| [ADR-0002](0002-typescript-web-api-stack.md) | TypeScript, Next.js và NestJS                                  | ACCEPTED |
| [ADR-0003](0003-postgresql-prisma.md)        | PostgreSQL và Prisma                                           | ACCEPTED |
| [ADR-0004](0004-rest-realtime-outbox.md)     | REST, Socket.IO và transactional outbox                        | ACCEPTED |
| [ADR-0005](0005-monorepo.md)                 | Monorepo boundaries                                            | ACCEPTED |
| [ADR-0006](0006-m1-technical-foundation.md)  | M1 runtime, workspace, local development và quality foundation | ACCEPTED |

## Template

Mỗi ADR mới nên có: Status, Context, Decision, Consequences, Alternatives và References/Related decisions.
