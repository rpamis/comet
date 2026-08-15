# Outcome

让发布目录中的 `comet-hook-router.mjs` 与当前 `domains/comet-entry/` 源码同步，消除父级 Verify 发现的生成物过期问题。

# Scope

- 使用仓库规定的 Entry runtime 构建脚本重新生成发布资产。
- 保留当前 Hook Router 的路由行为，只更新由源码生成的资产差异。
- 验证生成物 freshness，并覆盖 Entry runtime 资产测试。

# Non-goals

- 不修改 Hook Router 的业务逻辑、Native/Classic 状态机或项目规则选择逻辑。
- 不重开或修改已归档的父级子 change。
- 不新增用户可见配置、CLI 命令或 Dashboard 页面。

# Acceptance examples

- A1：`node scripts/build/build-entry-runtime.mjs --check` 通过。
- A2：`test/repository/comet-entry-runtime-assets.test.ts` 全部通过。
- A3：生成物只包含当前 Entry runtime 源码对应的同步结果。

# Constraints and invariants

- 生成文件只能由 `scripts/build/build-entry-runtime.mjs` 产生，不能直接在资产文件中编写业务逻辑。
- Native 与 Classic 的路由边界保持不变；当前修复只覆盖父级验收项 A273。

# Decisions

- 这是父级 Verify 失败后的唯一 repair child，仅覆盖 A273。
- 生成资产继续纳入仓库并随源码一起检查，不把过期资产留给安装用户。

# Open questions

无。

# Verification expectations

- 运行 Entry runtime 资产测试、生成物检查、TypeScript 检查和受影响文件格式检查。
