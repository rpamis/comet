# Dependabot 依赖安全修复

2026-11-15，工作分支 `054`，比较基线 `05f86a863f1fd076045db1824a57f2703dd52626`。使用已授权的 GitHub CLI 读取全部未关闭告警，共 5 条；按漏洞拆为 3 个回归案例。

| 告警                                                                                                                           | 漏洞与回归案例                                                   | 原锁定版本                           | 修复版本      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------ | ------------- |
| [207](https://github.com/rpamis/comet/security/dependabot/207)、[208](https://github.com/rpamis/comet/security/dependabot/208) | GHSA-g3hv-75wg-m249；`dependency-minimatch-glob-amplification`   | minimatch 10.2.3 / 10.2.5 / 10.2.6   | 11.0.1        |
| [209](https://github.com/rpamis/comet/security/dependabot/209)                                                                 | GHSA-mf5v-w3w3-f6cg；`dependency-opentelemetry-traceparent-dos`  | opentelemetry-api 1.45.1             | 1.45.2        |
| [203](https://github.com/rpamis/comet/security/dependabot/203)、[204](https://github.com/rpamis/comet/security/dependabot/204) | GHSA-3fx2-cqw9-xr3c；`dependency-langgraph-stream-path-encoding` | langgraph 1.2.6；langgraph-sdk 0.4.4 | 1.2.14；0.4.6 |

## 修改范围

- 在 `package.json` 的 npm、pnpm overrides 中固定 minimatch 11.0.1，并由对应包管理器更新两份锁文件。npm 锁文件根版本同步为当前已有的 0.5.4。
- 在 `eval/pyproject.toml` 增加 LangGraph、SDK 安全下限，并提高 OpenTelemetry API 下限。约束不把可选依赖变成默认安装项。
- 使用 `uv lock` 定向升级；解析器同时更新 OpenTelemetry SDK 1.45.2 和 semantic-conventions 0.66b2，以满足依赖兼容性。其余包版本保留。
- 在现有 `test/repository/dependency-boundaries.test.ts` 中追加回归，保留原断言；在 `config/workflow-regressions.json` 登记来源、行为和精确选择器。锁文件检查仅证明依赖解析边界；额外 Python 探针验证实际已安装包的行为。
- Python 探针保存在 `test/fixtures/dependency-security/python-probe.py`，使用 HTTP MockTransport，不连接模型或业务服务器。
- `origin/master` 和上一发布 tag `0.5.3` 的版本为 0.5.3，当前分支已有 0.5.4；只在现有 0.5.4 Changelog 追加 Security 条目。

## 旧新版对照

先新增断言，再升级依赖。同一 Vitest 文件在旧锁文件与旧安装依赖下 5 项失败、2 项原测试通过；升级后 7 项全部通过。

- minimatch：8 组 `**/../a/b` 在旧版生成 256 项，超过 `braceExpandMax=64`；新版最多 64 项。正常正向、反向匹配断言均通过。
- 锁文件：原 minimatch、OpenTelemetry API、LangGraph 和 SDK 的版本检查全部失败；更新后全部通过。

从 `eval/` 运行相同 Python 探针：

```powershell
# 旧版隔离环境，不更改项目环境。
uv run --no-project --isolated --with langgraph-sdk==0.4.4 --with opentelemetry-api==1.45.1 --with httpx python ../test/fixtures/dependency-security/python-probe.py

# 新版项目锁定环境。
uv run --locked --all-extras python ../test/fixtures/dependency-security/python-probe.py
```

旧版三项均失败，新版三项均通过：

- `check_sync`、`check_async`：旧版将攻击输入规范化成 `/assistants/a/graph` 与 `/other/path`；新版将 `/`、`#` 保留为编码后的 ID 内容。正常流式输出仍返回预期值。
- `check_traceparent`：旧版接受超过 512 字符的后续版本 traceparent，新版拒绝；正常 traceparent 继续可用，含长空白与换行的输入也被拒绝。没有用耗时阈值推断漏洞，未运行资源耗尽压力攻击。

## 验证结果

已通过：

- `pnpm exec vitest run test/repository/dependency-boundaries.test.ts`：7/7。
- `pnpm audit --json`、`npm audit --json`：各严重级别均为 0 条漏洞。
- `pnpm install --frozen-lockfile --ignore-scripts`：锁文件一致，安装成功。
- `uv lock --check`、`uv sync --locked --all-extras`、`uv pip check`：成功，93 个已安装 Python 包依赖兼容。
- 新版 Python 探针：3/3；LangChain、LangSmith、Langfuse、LangGraph 导入成功。
- `uv run --locked --all-extras ruff check ../test/fixtures/dependency-security/python-probe.py`：通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm check:sdk-api`：8 个公开入口均与接受的 API 报告一致，覆盖使用 minimatch 的 API Extractor。
- `pnpm check:badcase-registration --base 05f86a863f1fd076045db1824a57f2703dd52626`：通过。
- 受影响的手写 JSON、TypeScript、Changelog 的 Prettier 检查及 `git diff --check`：通过。

受阻或未执行：

- `pnpm lint` 的 ESLint 部分通过，架构检查因任务开始前已有的未跟踪 `.codex-attachments/` 不在顶层许可清单中失败。`pnpm verify:changed --base 05f86a863f1fd076045db1824a57f2703dd52626` 同样停在该检查；随后单独完成类型、格式和定向测试。保留附件，没有修改架构许可来绕过检查。
- 额外对包管理器生成的 `pnpm-lock.yaml` 运行 Prettier 时提示格式差异；该文件不在仓库 `format:check` 范围内，保留 pnpm 原生输出，没有整体重排锁文件。
- 本机 Node 22.20.0 低于原有 jsdom、lint-staged 的 engines 要求，npm 更新锁文件时出现警告；本次验证命令实际均已单独记录结果，未调整无关依赖或 Node 安装。
- 未运行仓库全量测试、完整构建、npm 包安装端到端测试或真实平台 Hook；改动集中于依赖解析和开发工具，已运行针对性行为、锁文件、类型和 API 提取检查。
- 未启动任何真实模型或容器 Eval，用户未授权启动，也没有模型行为变更需要本次证明。
- 本记录整理时尚未提交或推送，后续交付以 Git 提交和远端分支记录为准。未创建 PR、发布 npm 或手动关闭告警。GitHub 告警是否关闭仍需修复进入默认分支后由 Dependabot 重新扫描；本机审计通过不代表远端告警已关闭。

未改动网站子模块及已有附件。后续由维护者合并修复、检查默认分支扫描结果；已有附件导致的架构检查阻塞单独处理。
