# Native 命令参考

优先使用已安装的 `comet native`。若宿主环境只提供 Skill 文件，使用本 Skill 的自带 runtime：

```text
node <comet-native-skill-root>/scripts/comet-native-runtime.mjs <command> [options]
```

两种入口的参数、stdout、stderr 和退出码相同。普通发现从当前目录向上寻找 `.comet/config.yaml` 或仓库根；生成式 launcher 可附加隐藏参数 `--project-root <path>`。

## 项目与根目录

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
```

`artifact-root` 必须是项目内相对路径，默认值是 `docs`。`.` 生成 `<project>/comet/`，`docs` 生成 `<project>/docs/comet/`。`init --language` 会把项目的 Native 默认语言持久化到 `.comet/config.yaml`；后续 `new` 未显式传入 `--language` 时继承该值。再次运行 `init --language` 可以改变以后新建 change 的默认语言，不改写已有 change。已有配置拒绝冲突的 `--root`；改变根目录必须使用 `root move`，不能直接改配置。

## Change 管理

```text
comet native new <change-name> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
```

`new` 在配置缺失时创建默认配置和 `<project>/docs/comet/`。完整目标规格写入 `specs/<capability>/spec.md`；`next` 自动推断 create/replace 并冻结 canonical hash。删除 capability 使用 `spec remove`，不要手工编辑 `spec_changes`。

canonical 并发变化导致冲突时，先重读并改写完整目标规格，再用 `spec rebase` 刷新 operation/hash、回到 Build 并清除原验证结论。

`show` 返回状态、brief 和拟议完整规格。`status` 返回有预算的阶段、证据新鲜度、finding 摘要、checkpoint、repair 状态和 continuation。`status <change-name> --details` 还会返回：

- 最多 50 条详细 findings；
- `findingsTruncated` 标记；
- 恢复细节；
- 首个 `acceptancePage`。

findings 被截断时，先处理已返回项，再重新读取 details。`nextCursor` 非空时，用 `--acceptance-cursor` 逐页读取，直至为 null。acceptance cursor 只允许与具体 change 和 `--details` 同用，并绑定当前 acceptance hash。

`status` 与 `show` 始终只读。恢复已确认的目标 change 时显式运行 `select`，不要新增 `resume` 命令。`new` 与 `select` 都会写项目级共享 `.comet/current-change.json`，并把 `workflow` 固定为 `native`；它们不会修改 Classic change。

`list` 与不带 change 的 `status` 返回同一种只读分页投影，每页最多 24 个 change；`nextCursor` 非空时原样传给 `--cursor`。cursor 绑定当前完整名称集合，change 增删后旧 cursor 会明确失效，不会错位分页。最多接受 4096 个可见 change，整页序列化结果不超过 512 KiB。`show` 还会限制规格数量、单文件、累计读取和最终输出大小；超限时拒绝，不截断需求正文。

## 阶段内进度与内置检查

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
```

`checkpoint` 只保存同阶段摘要、下一动作和内容寻址的产物 manifest；它通过 revision/CAS 防止覆盖，不改变 phase。`check` 只允许在 Verify 且已有 implementation scope 时运行 Comet 内置的有界只读文本扫描。它不调用 Git、shell、项目脚本、外部 Skill 或任何外部进程，不接受任意命令、路径、环境或超时参数，也不修改项目文件或 change/Run/trajectory；结果、issue 计数和 scope 新鲜度会写入独立的内容寻址 receipt。检查发现问题或 stale 返回 1，但 receipt 仍会落盘。

## 阶段推进

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <runtime/evidence/check-receipts/...json>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256>
```

- Shape：brief 和拟议规格通过后推进；只有本轮包含用户刚确认的决定时才传 `--confirmed`。成功进入 Build 时，Runtime 会把 approval 绑定到当前 contract hash。
- Build：重新检查 brief 和拟议规格；至少给出一个真实项目产物，或使用 `--no-code-reason`。若 contract 在 approval 后变化，status/next 会要求用户重新确认当前 contract；只有取得该确认后才传 `--confirmed`。无法证明完整 scope 时，第一次调用返回 scope hash 与有界未归属明细而不推进；超出明细预算的变化由 `scope-detail-overflow` 的数量与内容 hash 表示。只有用户接受具体风险后，才可用完全匹配的 `--allow-partial-scope`、理由与 `--confirmed` 重试。
- Verify：必须提供 `--result` 和完整 `--report`；可选 `--receipt` 必须是当前 change、revision、contract 与 implementation scope 上 fresh 的内置 receipt。fail 回到 Build，可用失败分类和检查 ID 形成无进展签名；pass 进入 Archive。
- Repair：第三次相同失败会返回 manual stop。scope 真正变化时普通 Build `next` 会结束旧 repair episode 并继续；scope 不变时只能用 status 返回的 signature 和非空摘要 override 一次。单个 episode 的 semantic repair budget 与已耗尽 override 不可绕过；通用 Run iteration 只提供事件序号，不是长期 change 的永久停止条件。
- Archive：只能由 `archive` 命令完成，不能用 `next` 代替。先 `--dry-run`，再把同一次预演返回的 `preflightHash` 原样传给 `--expect-preflight`；Runtime 在锁内重算后才提交。

## 诊断与恢复

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

只读 doctor 不改文件。`--repair` 只处理可证明安全的 selection、陈旧锁、evidence retention、普通阶段 transition、workspace 身份修复和确定性事务恢复；用户编写的 YAML、Markdown 与规格不会被自动重写。

`--strategy` 是可选的事务恢复参数，不是普通 repair 的必填项。普通 transition 只支持 `continue`，不支持 `rollback`。

doctor 也会只读报告 evidence retention 候选。显式 `--repair` 只清理 active change 中至少 30 天、每种 evidence kind 最新 32 份之外、且依赖闭包证明未引用的派生 evidence/receipt；归档证据、当前状态引用、依赖项、较新文件和每类最新 32 份始终保留。删除按 dependents-before-dependencies 排序，并先进入同目录 quarantine；中断后只读 doctor 报告 recovery required，显式 repair 在无覆盖且身份匹配时恢复。存在 pending journal、损坏、原文件与 quarantine 冲突或未知/特殊文件时 fail closed，不为腾空间冒险删除。

普通 `new`、`next`、`archive`、`root move` 等写命令不会自动接管陈旧锁。只有显式 `doctor --repair` 会在证明本机 owner 已不存在、锁身份未变化且没有相冲突恢复事务时接管；活动锁和无法证明陈旧的锁始终保留。

## 输出与退出码

所有命令支持 `--json`。JSON 模式只输出一个对象，包含 `command`、`exitCode`、`data`，失败时还包含结构化 `error`。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 内置 `check` 完成但发现问题或结果 stale |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或产物无效 |
| `73` | 锁、事务、并发 hash 或根目录冲突 |
| `75` | repair stagnation 或 hard stop 阻塞继续 |
| `70` | 未预期的内部失败 |
