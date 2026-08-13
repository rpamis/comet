---
name: comet-safe-delivery
description: 在保护无关脏改动、关联 worktree、子模块和用户明确边界的前提下，提交、推送、合并或完成范围明确的 Comet 变更。用户要求提交、推送、合并回目标分支、清理 worktree 或交付已准备好的改动时使用。
disable-model-invocation: true
---

# Comet 安全交付

先读取 `../comet-github/references/maintainer-contract.md`。只有用户明确授权后才执行 Git 交付动作；本 Skill 永远不会发布到 npm。

## 交付前检查

1. 记录当前分支、upstream、`git status --short --branch` 和 `git worktree list --porcelain`。
2. 检查 diff，确定准确的目标路径。如果与无关改动重叠，先确认范围。
3. 确认目标分支和 remote，不要静默切换分支或改变交付目标。
4. 涉及子模块时，先确认子模块自己的分支/状态；得到授权交付时，先提交子模块，再更新父仓库 gitlink。

## 暂存与验证

- 只暂存明确的目标路径；混合工作区中不要使用宽泛的暂存命令。
- 检查 `git diff --cached --name-status`、`git diff --cached --stat` 和 `git diff --cached --check`。
- 让仓库 pre-commit hook 正常运行。如果 hook 修改了暂存内容，重新检查暂存文件名和 diff。
- 使用带类型前缀的提交信息，例如 `fix: ...`、`docs: ...` 或 `chore: ...`。

## 交付

只提交已确认的暂存范围，只推送用户明确指定的分支和 remote。完成后验证本地状态、commit SHA、upstream 关系和远端分支 SHA。分别报告 commit、push 和线上 CI 状态。

除非另行要求，不创建 PR、不合并远端分支、不删除分支、不移除 worktree、不改写历史。删除 worktree 或分支前，确认关联关系、准确目标和可恢复性；不得强制删除宽泛或未解析的路径。
