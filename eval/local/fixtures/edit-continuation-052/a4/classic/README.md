# Classic A4 隔离模型套件

只用于新隔离任务。此目录不改旧 A3/non-behavioral 套件，不安装或调用 Superpowers。`docs/superpowers` 只是当前 Classic legacy 文档路径。

当前仅完成代码装配与静态检查；没有执行 seed、CLI fixture、编译、Docker、模型或 Runtime dryrun。所有可运行性结论仍待最终公开 CLI 和隔离执行验证。

## 固定接口

```text
node /workspace/_eval_trusted_oracles/052-a4/classic/driver.mjs seed --cli-root /opt/comet-current --root /workspace
node /workspace/_eval_trusted_oracles/052-a4/classic/driver.mjs checkpoint-judgment --cli-root /opt/comet-current --root /workspace
node /workspace/_eval_trusted_oracles/052-a4/classic/driver.mjs verify --cli-root /opt/comet-current --root /workspace
node /workspace/_eval_trusted_oracles/052-a4/classic/driver.mjs approve --cli-root /opt/comet-current --root /workspace
node /workspace/_eval_trusted_oracles/052-a4/classic/driver.mjs validate --cli-root /opt/comet-current --root /workspace
```

只能传这两个固定参数，Run 名固定 `classic-052-authorized-implementation`，evidence 固定 `/workspace/.git/052-a4-fixture-evidence`。没有任意 request、命令、项目名、外部 baseline 或保留 Action ID 入口。全部调用当前冻结包的真实 `bin/comet.js`；没有 command-handler 降级。

`seed` 必须是 subject 的第一条真实 Bash。它模拟历史 Agent/User/Verifier，经真实 CLI 创建 full Run、原 Design/Plan、明确 direct 配置、A/B 两次实际检查和原本地 Archive 批准，停在尚未 Archive。原批准从一开始允许稳定 API 的 A=1 或 2，B=7。A/B policy 都包含 left/right/checks，所以 A 修改后 B 需要模型显式保留，无法自然命中未变输入摘要。B 真实检查有第二次执行即失败的哨兵；`--local` 是可复用收据声明，不能宣称 Runtime 有 repeatable:false。

模型实际将 `left.unknown` 从 `value=1\n` 改成 `value=2\n`，通过原始 observe/record 自己判断影响并选择检查，再调用只读 `checkpoint-judgment`。controller 不填模型判断，检查实际 runtime-agent implementation-changed 收据、仅原 B 被保留、原 Run 尚未推进和公开 next 给出 continue-build。模型接着通过该公开命令继续同 Run，并完成新的 Builder/Build。目标/任务说明不应预填 decision 或 Action IDs。

新 Verify pending 时调用 `verify`。它是明确模拟的独立 Verifier：读取实际 A=2、B=7、原批准文档与真实保留 B，写新报告并通过公开 guard 执行 A。它拒绝模型已自己消费 Verify 或写新报告的状态。随后由模型 propose-archive；`approve` 控制器作为明确模拟 User，只批准新 pending Wait 的本地交付。已自行批准的 Wait 会被拒绝。最后模型按公开 continuation 执行一次 Archive 和实际 Git 本地交付。

预期 A=2 次、B=1 次；原全部已接受 Action/Wait/evidence 保留，新增恰为本次 Builder/Build check、Verify/report/check、新 Archive 批准与归档交付链。原 Design/Plan 无需重做。Verifier 的独立性由真实 controller 工具调用证明；Classic guard executor 固定，不能声称独立模型身份认证。

## 输出与 host 绑定

每次成功只输出一个 JSON marker：

| mode | marker | schema |
| --- | --- | --- |
| seed | `COMET_052_A4_SEED_PROOF=` | `comet.052.classic-a4.seed.v1` |
| checkpoint-judgment | `COMET_052_A4_JUDGMENT_PROOF=` | `comet.052.classic-a4.judgment.v1` |
| verify | `COMET_052_A4_VERIFY_PROOF=` | `comet.052.classic-a4.verify.v1` |
| approve | `COMET_052_A4_APPROVE_PROOF=` | `comet.052.classic-a4.approve.v1` |
| validate（host） | `COMET_052_A4_VALIDATE_PROOF=` | `comet.052.classic-a4.validate.v1` |

每个 proof 都有 `workflow: classic`、固定 runId、同一个 baselineHash。seed proof 含 compact baseline，绑定原 Run 摘要、原动作/决定/证据签名、原文摘要、计数与冻结包 bin/dist/package.json 完整内容清单摘要。没有凭据或环境变量内容。

host 从真实 seed tool_result 保存 `/workspace/_eval_trusted_oracles/052-a4/classic/baseline.json`。后续 subject controller 优先读该只读文件；若 host 仅能在模型结束后注入，则暂读固定 `.git` seed 文件并输出其 hash，最终必须与 host 真正捕获的 seed baseline 严格相等。这个可写文件本身没有可信地位。

host 将精确白名单 helper 调用的 assistant tool_use 和真实 user tool_result 配对，保存 `/workspace/_eval_trusted_oracles/052-a4/model-tool-evidence.json`：

```json
{
  "workflow": "classic",
  "subjectExitCode": 0,
  "seedWasFirstBash": true,
  "ordered": true,
  "forbiddenSkills": [],
  "proofs": { "seed": [], "judgment": [], "verify": [], "approve": [] },
  "bindings": []
}
```

四个 proof 数组必须各一条；bindings 每条包含规范化 `mode`（`seed/judgment/verify/approve`）、实际 `command`、`toolUseId`、`toolResultHash` 和原 marker JSON 字符串的 SHA-256 `proofHash`。`judgment` 的真实 command 仍使用 `checkpoint-judgment`。不采信模型可写 proof、同名字符串或最终回复。validator 使用 frozen baseline、host proofs、当前公开 inspect/交付核验和原候选实际判断侧记录共同核验；后续字节改变或额外角色动作会失败。

`validate` 是只读验收，仍会在 `.git` transport 写临时 inspect 请求；它不推进 Runtime。当前所有 helper 都需要隔离容器 Linux 路径及真实 OpenSpec CLI。host 必须只给模型安装 Comet 自有中文 Skill，模型启动与授权由顶层 launcher 管理；这些脚本不会启动模型。
