# ADR-0002: TypeScript, Next.js and NestJS

- Status: **ACCEPTED**
- Date: 2026-10-26

## Context

Hệ thống cần mobile guest flow, staff dashboards, REST API, WebSocket authorization và maintainable module structure. Legacy Express controllers cho thấy rủi ro business logic/authorization phân tán.

## Decision

- TypeScript xuyên suốt web/API/contracts.
- Next.js App Router cho web application.
- NestJS với Express adapter cho authoritative backend.
- Next.js không chứa authoritative business rules và không bypass NestJS commands bằng parallel mutation path.
- Realtime UI dùng Client Components; public/menu shell có thể tận dụng server rendering khi hợp lý.

## Consequences

- Shared language/tooling và typed public contracts.
- Nest modules/guards phù hợp module encapsulation và consistent authorization.
- Next.js caching/server-client boundary phải được review cẩn thận cho session/bill data.
- Express adapter ưu tiên ecosystem/familiarity; chỉ đổi adapter sau profiling.

## Alternatives

- Vite SPA: đơn giản nhưng ít integrated routing/rendering capability hơn.
- Express/Fastify thuần: ít abstraction nhưng dễ lặp lại inconsistency của legacy.
- Next.js Route Handlers làm backend chính: không chọn vì làm mờ bounded backend và operational authorization.
