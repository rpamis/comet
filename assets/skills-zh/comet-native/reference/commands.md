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

## Controller trust 与 review policy

```text
comet native trust keygen --identity <path> --private-key <outside-project-path>
comet native trust identity --private-key-env <name> --identity <path>
comet native trust policy \
  --implementation-identity <path> \
  --reviewer-identity <path>... \
  --waiver-identity <path>... \
  --controller-private-key-env <name>
comet native trust authorize <change-name> \
  --controller-private-key-env <name> \
  --output <path>
```

在创建第一个 signed-v2 change 之前，宿主/controller 先在当前 Agent 无法替换的项目外只读边界中预置 `~/.comet/native-controller-trust.json`，把项目物理根 hash 绑定到 controller 公开 identity。POSIX 普通文件必须由不同 UID 持有，且文件和父目录链对当前进程不可写；Windows 本机同用户文件不构成 trust anchor，必须由宿主提供 Runtime 可验证的只读挂载能力，否则失败关闭。Native 命令不会创建或修改这个项目外 store。随后分别准备 implementation、reviewer 与 waiver signer 的公开 Ed25519 identity。`trust keygen` 只允许拥有对应角色的外部 operator 在能验证 owner-only mode 的 POSIX 上把私钥写到项目外；Windows 会拒绝持久化私钥，应由外部 secret store 生成并通过 `--private-key-env` 用 `trust identity` 导出公开 identity。任何平台都不能打印或把私钥写入项目。

`trust policy` 是 controller/operator provisioning primitive，不是当前实现 Agent 的普通步骤。它用外部 trust root 对应的 controller 私钥签署 `.comet/native-review-trust.json` v2 policy，在 mutation lock 内使用原子 exclusive write，并且只允许在没有 active change 时首次创建；不能覆盖现有策略。controller、implementation、所有 reviewer 与所有 waiver signer 的 key 必须全局唯一。`trust authorize` 再签发只对指定项目物理根、policy hash、`signed-v2` protocol 和 change name 有效的 creation authorization。

当前 Agent 不得接收 controller、reviewer 或 waiver signer 的私钥值，也不能自行执行上述外部签名。外部调用必须一次性注入签名环境变量，并在命令结束后立即清除；只把公开 identity、authorization 文件或 receipt ref 返回给当前 Agent。缺少任何 owner/controller 动作时停止并报告 blocked，不能生成替代 key、复用 implementation key 或降级 protocol。

## Change 管理

```text
comet native new <change-name> --creation-authorization <path> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
```

`new` 在配置缺失时创建默认配置和 `<project>/docs/comet/`，并写入 `verification_protocol: signed-v2`。`--creation-authorization` 必填；Runtime 会验证外部 controller trust、policy 签名，以及 authorization 对项目物理根、policy、protocol 与 change name 的绑定。创建 baseline 时即使 Git ignore `.comet/`，也会强制捕获公开 policy，并在 change 内保存 controller 签名的创建时 policy 快照与 authorization。只有 controller store 明确列出的旧 change 才按 `legacy-v1` 读取；marker、创建 binding 或外部 trust 不一致会使 status、next 和 Archive 全部失败关闭。完整目标规格写入 `specs/<capability>/spec.md`；`next` 自动推断 create/replace 并冻结 canonical hash。删除 capability 使用 `spec remove`，不要手工编辑 `spec_changes` 或 `verification_protocol`。

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
comet native evidence format [--entries <path>]

comet native receipt manual <change-name> \
  --acceptance <id> \
  --responsible <text> \
  --step <text> \
  --observation <text> \
  --confirmed

comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <1..3600000>] \
  -- <executable> [args...]

comet native receipt implement <change-name> prepare \
  --identity <path> --output <preparation.json>
comet native receipt implement sign \
  --preparation <preparation.json> \
  --identity <path> --private-key-env <name> \
  --output <attestation.json>
comet native receipt implement <change-name> finalize \
  --preparation <preparation.json> \
  --attestation <attestation.json> \
  --confirmed

comet native receipt review <change-name> prepare \
  --implementation-receipt <ref> \
  --report <verification.md> \
  --required-receipt <ref> \
  --identity <path> \
  [--unified-io-receipt <ref> \
   --adversarial-paths-receipt <ref> \
   --generated-assets-receipt <ref> \
   --lifecycle-eval-receipt <ref>] \
  --output <preparation.json>
comet native receipt review <change-name> approve \
  --preparation <preparation.json> \
  [--attest-manual <ref>]... \
  [--findings <path>] \
  --checked-acceptance-applicability \
  --output <approval.json>
comet native receipt review sign \
  --approval <approval.json> \
  --identity <path> --private-key-env <name> \
  --output <attestation.json>
comet native receipt review <change-name> finalize \
  --preparation <preparation.json> \
  --approval <approval.json> \
  --attestation <attestation.json> \
  --confirmed

comet native receipt waive <change-name> \
  --acceptance <id> \
  --blocked-receipt <ref> \
  --reason <text> \
  --risk <text> \
  --alternative-receipt <ref> \
  --identity <path> \
  --private-key-env <name> \
  --confirmed
```

`checkpoint` 只保存同阶段摘要、下一动作和内容寻址的产物 manifest；它通过 revision/CAS 防止覆盖，不改变 phase。`check` 只允许在 Verify 且已有 implementation scope 时运行 Comet 内置的有界只读文本扫描；它不调用 Git、shell、项目脚本、外部 Skill 或外部进程，把原始结果写到 `runtime/evidence/check-receipts/`，再同时绑定原 check receipt 与 typed static-inspection required receipt。检查发现问题或 stale 返回 1，但 receipt 仍会落盘。

`receipt automated` 直接执行 `--` 后的 executable 与 argv，不经过 shell；全局 `--json`/`--project-root` 解析在 `--` 停止。子进程只继承运行测试所需的系统环境白名单，不继承 signing secret。默认 timeout 为 120 秒，最大 3,600,000 毫秒；超时终止进程树并生成 blocked receipt。运行期间 worktree 或 after-fence scope/snapshot 漂移也会 blocked。`receipt manual` 只用于真实人工步骤和观察，必须显式确认。

`receipt implement prepare/sign/finalize` 把 Runtime 派生当前 bindings、完整 acceptance set 与 run/scope execution ID、项目无关的纯签名、以及无私钥的最终重验分离。完成最终报告后，外部预信任 reviewer 使用 `receipt review prepare/approve/sign/finalize` 引用 attestation、报告和至少一个 required-check receipt。`approve` 必须在当前 Agent 之外执行：Runtime 从报告重建 canonical acceptance matrix，重放 automated receipt、重跑 static inspection，并要求 reviewer 用 `--attest-manual` 明确覆盖每个 manual receipt；纯 signer 只签署完整 approval。未解决 P0/P1 会阻断 pass。高风险 scope 还必须为统一 I/O、对抗路径、生成物和真实生命周期 Eval 四项分别传入真实 typed receipt。`receipt waive` 只能由外部预信任 waiver signer 对一个非 passed blocking receipt 签名，并绑定替代 automated/manual typed receipt；不能把 failed/skipped/blocked 结果直接改写成 pass，也不能把 review 当作直接 acceptance evidence。

所有 signer/helper 调用都由对应外部角色一次性注入私钥环境变量并在调用后立即清除。implementation/review 的 `sign` 是不读取文件系统、项目、Git 或子进程的纯签名边界；尤其不能在会重放项目命令的 reviewer `approve` 进程中注入私钥。当前 Agent 只能请求签名并接收 receipt ref，不能读取私钥或代替 reviewer/waiver signer 执行签名。Verify 与 Archive 会使用同一 graph validator 重验 matrix、policy、receipt、waiver 和 replay；任一绑定事实变化都会使 review stale。

写 verification.md 的 `# Acceptance evidence` 机器块前，用 `evidence format` 把条目数组序列化成规范 Markdown 文本再粘贴，不要手工排版 JSON。默认从 stdin 读取，也可用 `--entries <path>`；输出已包含 markers、固定排序与缩进。

## 阶段推进

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <runtime/evidence/receipts/...json>] \
  [--evidence-receipt <runtime/evidence/receipts/...json>]... \
  [--waiver <runtime/evidence/waivers/...json>]... \
  [--independent-review-receipt <runtime/evidence/receipts/...json>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256>
```

- Shape：brief 和拟议规格通过后推进。Sequential 与 Batch 都必须取得最终共享理解确认并传 `--confirmed`。成功进入 Build 时，Runtime 会把 confirmed approval 绑定到当前 contract hash。
- Build：重新检查 brief 和拟议规格；至少给出一个真实项目产物，或使用 `--no-code-reason`。旧 change 若仍为 `approval: implicit`，必须先确认当前共享理解；若 contract 在 approval 后变化，status/next 会要求用户重新确认当前 contract。两种情况都只有取得确认后才传 `--confirmed`。无法证明完整 scope 时，第一次调用返回 scope hash 与有界未归属明细而不推进；超出明细预算的变化由 `scope-detail-overflow` 的数量与内容 hash 表示。只有用户接受具体风险后，才可用完全匹配的 `--allow-partial-scope`、理由与 `--confirmed` 重试。
- Verify：必须提供 `--result` 和完整 `--report`。signed-v2 pass 必须包含 fresh required receipt、与验收矩阵精确匹配的 acceptance receipt refs、signed implementation attestation 所绑定的独立 acceptance-applicability review，以及所有 waiver refs。review ref 同时放入 `--evidence-receipt` 与 `--independent-review-receipt`；required receipt 可显式传 `--receipt`，省略时 Runtime 在锁内运行内置 check。failed/skipped/blocked/scan-limit/timeout/无效 receipt 阻断 pass；高风险 review 四项检查缺一不可。fail 回到 Build，可用失败分类和检查 ID 形成无进展签名；pass 进入 Archive。
- Repair：第三次相同失败会返回 manual stop。scope 真正变化时普通 Build `next` 会结束旧 repair episode 并继续；scope 不变时只能用 status 返回的 signature 和非空摘要 override 一次。单个 episode 的 semantic repair budget 与已耗尽 override 不可绕过；通用 Run iteration 只提供事件序号，不是长期 change 的永久停止条件。
- Archive：只能由 `archive` 命令完成，不能用 `next` 代替。先 `--dry-run`，再把同一次预演返回的 `preflightHash` 原样传给 `--expect-preflight`；Runtime 在锁内重算，并在 spec operations 完成后、`archive-change` move 之前再次执行最终 freshness fence，发生漂移时保留 active change 并由同一事务恢复。

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
