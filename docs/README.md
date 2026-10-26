# EatEase documentation

Thư mục này là source of truth cho product, architecture và implementation planning. Chat history không được xem là nguồn thay thế lâu dài.

## Product

- [MVP requirements](product/requirements.md): phạm vi sản phẩm, actors và end-to-end workflow.
- [Business rules](product/business-rules.md): invariants và policy nghiệp vụ authoritative.

## Architecture

- [Overview](architecture/overview.md): system context, module boundaries và runtime direction.
- [Data model](architecture/data-model.md): ERD, relational model và database constraints.
- [State machines](architecture/state-machines.md): lifecycle và transition ownership.
- [API contracts](architecture/api-contracts.md): contract cho first vertical slice.
- [Permissions](architecture/permissions.md): role-permission matrix và scope rules.
- [Security](architecture/security.md): guest/staff cookies, CSRF, origin và WebSocket security.
- [ADR index](architecture/adr/README.md): các architecture decisions.

## Planning

- [Roadmap](planning/roadmap.md): milestone sequence M0–M5.
- [Implementation plan](planning/implementation-plan.md): dependency order và task tracker.
- [Phase 1](planning/phase-01.md): chi tiết first business vertical slice.
- [Decision log](planning/decision-log.md): `APPROVED`, `PROPOSED`, `OPEN`, `DEFERRED`.

## Development

- [Git workflow](development/git-workflow.md): Conventional Commits, task branches, Pull Requests và Codex authorization rules.

## Maintenance rules

- Business policy authoritative nằm trong `product/business-rules.md`.
- Schema/constraint authoritative nằm trong `architecture/data-model.md`.
- Lifecycle authoritative nằm trong `architecture/state-machines.md`.
- Không sao chép toàn bộ quyết định sang nhiều file; dùng relative links.
- Mỗi thay đổi lớn phải cập nhật decision log và ADR nếu phù hợp.
