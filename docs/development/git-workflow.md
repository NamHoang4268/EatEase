# Git workflow

Tài liệu này là nguồn chuẩn cho commit messages, branch strategy và Pull Request workflow của EatEase. Quy trình được giữ gọn cho personal project, không yêu cầu Jira ID, ticket prefix hoặc mandatory ticket reference.

## Commit messages

Sử dụng [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): short description
```

Description viết bằng English, ngắn gọn và ở imperative form.

Ví dụ:

```text
docs(repo): establish git workflow
feat(api): implement table activation
feat(web): add customer menu page
fix(api): prevent duplicate order submission
refactor(db): simplify billing queries
test(api): cover concurrent activation
ci(github): add validation workflow
chore(deps): update dependencies
```

Không thêm Jira task ID hoặc ticket reference bắt buộc vào commit message.

## Branch strategy

- `main` là stable integration branch.
- Tạo branch mới cho mỗi task hoặc coherent change.
- Đặt branch name ngắn gọn, descriptive và phản ánh loại thay đổi, ví dụ:
  - `feat/table-activation`
  - `feat/customer-menu`
  - `fix/duplicate-order`
  - `docs/git-workflow`
  - `chore/project-foundation`
- Giữ thay đổi focused; không đưa unrelated work vào cùng branch.
- Luôn bắt đầu branch mới từ một local `main` đã được cập nhật.

## Pull Request workflow

Với các development task thông thường:

1. Tạo task branch từ `main`.
2. Implement thay đổi đúng phạm vi.
3. Chạy tests và validations liên quan.
4. Review diff và commit bằng Conventional Commits.
5. Push task branch.
6. Tạo Pull Request target vào `main`.
7. Ghi short summary, testing evidence và các documentation updates liên quan trong PR.
8. Review PR trước khi merge.
9. Ưu tiên **Squash and Merge** để giữ lịch sử dễ đọc.
10. Cập nhật local `main` và dọn các merged branches.

Không development trực tiếp trên `main` trong workflow thông thường.

## Codex authorization rules

- Codex không tự động tạo branch, commit, Pull Request, merge hoặc push nếu chưa có explicit authorization cho chính operation đó.
- Với mỗi task, Codex nên đề xuất branch name và commit message phù hợp.
- Hoàn thành implementation không đồng nghĩa được phép merge.
- Milestone approval gates vẫn áp dụng độc lập với PR approval.
- Không force-push hoặc rewrite shared history nếu chưa có explicit authorization.

### Task handoff

Sau mỗi completed task, Codex cung cấp:

- Exact `git add -- <scoped files>` command.
- Full `git commit -m "type(scope): description"` command.
- Push command đúng current task branch, dùng `--set-upstream` khi branch chưa có upstream.
- Suggested Pull Request title và PR body gồm summary, important decisions, verification, risks/open items và out-of-scope notes.

Các command này chỉ là handoff để project owner review/thực hiện; việc cung cấp command không phải authorization để Codex tự commit, push, tạo PR hoặc merge.

## Initial repository exception

M0 documentation baseline có thể được commit trực tiếp vào `main` vì đây là commit thiết lập repository trước khi normal feature development bắt đầu.

Suggested initial commit message:

```text
docs(repo): establish EatEase project baseline
```

Tất cả development sau initial baseline phải tuân theo task branch và Pull Request workflow ở trên.
