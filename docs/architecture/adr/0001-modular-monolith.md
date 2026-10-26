# ADR-0001: Modular Monolith

- Status: **ACCEPTED**
- Date: 2026-10-26

## Context

EatEase có nhiều business capabilities liên quan chặt qua transactional workflow. MVP cần tốc độ phát triển, consistency và vận hành đơn giản; chưa có nhu cầu scale/team boundary chứng minh microservices.

## Decision

Xây một NestJS deployable theo Modular Monolith. Module boundaries được định nghĩa trong [architecture overview](../overview.md). Cross-module behavior dùng explicit application services/events; không chia database theo service.

## Consequences

- Transaction nhiều module có thể dùng một PostgreSQL database.
- Deploy, local development và observability đơn giản hơn distributed system.
- Cần discipline để tránh module biến thành layered monolith không boundary.
- Có thể tách module trong tương lai nếu có measured need và stable contract.

## Rejected now

Microservices, Kafka và Kubernetes vì tăng operational/consistency cost mà chưa giải quyết nhu cầu MVP cụ thể.
