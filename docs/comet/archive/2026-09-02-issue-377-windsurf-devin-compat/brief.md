# Outcome

修复 Issue #377 的 Windsurf/Devin Desktop 兼容问题。Comet 保留 `windsurf` 平台参数，使用 OpenSpec 当前的 `.devin/` 作为默认目录，同时兼容旧的 `.windsurf/` 安装。

# Scope

- 更新 Windsurf 平台注册信息：`.devin/` 是 canonical Skill root，`.windsurf/` 是 legacy Skill root；保留平台 ID 和 OpenSpec tool id `windsurf`。
- OpenSpec 的 project/global staged copy 同时接受 `.devin/` 与 `.windsurf/` 输出，并统一把 staged 内容写入 `.devin/`。
- 保持旧目录可以被检测、读取和卸载；不自动删除或覆盖旧目录中的用户文件。
- 更新 Native snapshot 排除项、README 中的平台路径说明和英文 CHANGELOG。
- 补充当前/旧 OpenSpec 输出、平台发现、默认目录和已有参数的回归测试。

# Non-goals

- 不新增独立的 `devin` 平台 ID。
- 不修改 OpenSpec 上游包或它自己的迁移交互。
- 不把旧目录中的用户文件静默搬走，不要求新旧目录双向同步。
- 不扩展为通用配置目录迁移框架；本次只处理 Issue #377 涉及的 OpenSpec 和平台 Skill root 兼容。

# Acceptance examples

- A1: OpenSpec 1.11 通过 `--tools windsurf` 生成 `.devin/` 时，Comet project init/update 成功，并把 OpenSpec 文件写入 `<project>/.devin/`。
- A2: 旧版 OpenSpec 生成 `.windsurf/` 时，Comet project/global init/update 仍成功；project staged output 会写入 canonical `.devin/`，global 旧目录仍能被识别和更新。
- A3: 已有 `.windsurf/` 的项目仍能被识别为 `windsurf`，Comet 可以读取其中的 managed Skills；卸载可以清理 Comet-managed files，但不删除用户文件。
- A4: `comet init` 默认创建 `.devin/`；Native snapshot 默认排除 `.devin/skills/**`，同时保留 `.windsurf/skills/**` 对旧安装的兼容。
- A5: `--platform windsurf`、已有 Superpowers 映射和 Windsurf Hook 映射继续有效，不需要新的 `devin` 平台参数。

# Constraints and invariants

- `windsurf` 继续是稳定的 Comet platform ID 和 OpenSpec CLI 参数。
- `.devin/` 是当前 canonical path；`.windsurf/` 继续作为 legacy compatibility path。
- OpenSpec 实际生成目录可能因 CLI 版本不同而是 `.devin/` 或 `.windsurf/`。
- 不能静默覆盖或删除已有用户文件。
- 当前工作区是从最新 `master` 创建的 Native hotfix worktree；原 checkout 中已有的 `website` 改动不属于本 change。
- 先运行覆盖当前改动的最小相关测试；只有涉及生成物时再构建对应 runtime。
- 验证通过后先取得用户对 GitHub 操作的明确授权，再提交并推送 hotfix 分支、使用仓库的 `fix` 模板创建 pull request；不直接合并 PR。

# Decisions

- 采用 `.devin/` canonical、`.windsurf/` legacy 的兼容方案，跟随 OpenSpec 当前 tool contract。
- 保留 Comet 的 `windsurf` ID 和 `openspecToolId`，避免已有脚本、配置和平台映射失效。
- 生成文件只写一个当前目录，不双写；旧目录仅用于发现、读取和清理 Comet-managed 内容。
- project install 用 staging 统一收敛旧/新 OpenSpec 输出；global install 对旧版输出保留可识别、可更新的兼容行为，不做静默用户文件迁移。

# Open questions

无。

# Verification expectations

- 先运行平台注册、平台发现、OpenSpec project/global 安装和 Native snapshot 配置的最小 Vitest 测试。
- 再运行受影响的 init/update/uninstall 集成测试，确认默认输出、旧目录发现和用户文件保护。
- 如果修改 Native snapshot 默认配置，运行 `pnpm build:native-runtime` 同步生成资产，并检查生成物一致性。
- 最终根据改动范围运行 lint、格式检查和必要的全量测试；验证通过后提交、推送并创建 GitHub pull request。
