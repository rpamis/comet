# A5 Classic 临时验收 helper

本目录仅完成静态装配。尚未运行脚本、语法检查、Runtime、模型、Docker、编译或 collect；不能记为通过。

接口固定为 `node driver.mjs seed|checkpoint|validate --cli-root /opt/comet-current --root /workspace`。Classic 本 helper 只支持容器内这两个固定路径，不支持本机任意路径 dryrun。名称沿用复用的 A3 seed：`classic-052-edit`。项目必须独立；A3、A4 原文件不变。

- `seed` 调用只读挂载的 `../original-a3/classic/driver.mjs seed`，通过真实公开 CLI 建立 full Run、原 Design/Plan 批准、A/B 各一次检查、原 Verify 与本地 Archive 批准；这些历史角色均为明确的确定性模拟。随后仅追加 canonical proposal 和 values spec：新命令 `node export-values.mjs --format json` 输出 left/right/sum JSON。原实现不变，新功能没有批准，也不预填 Agent 分类。
- `checkpoint` 读取 seed 写入 `.git/052-a5-fixture-evidence/a5-baseline.json` 的本地基线、实际 Run、当前 Agent 的正式材料判断、原检查 log/manifest 和当前文件。要求准确绑定两份正式编辑与原批准来源。调用 `classic guard classic-052-edit archive --json`，不带 `--apply`，检查该语义判断阻止归档，且调用前后完整 Run 和计数均不变。没有模拟用户或 Verifier，没有 Runtime 推进请求。本地基线在此时不视为可信；最终 validator 必须与真实 seed tool_result 中的 baselineHash 精确匹配。
- `validate` 只读 `classic/baseline.json`、上层 `model-tool-evidence.json`、实际 Runtime 与文件。它不会再次调用 Guard，不运行 checks/Archive，不从项目内可写基线或模型手写 proof 取证。它要求原全部 Actions、waits、evidenceWaits、commands 和 Run hash 保持一致，A/B 计数及真实收据不变，HEAD 和原业务文件不变，新增正式文本保持精确字节，模型最后真实消息请求决定。

三个输出前缀为 `COMET_052_A5_SEED_PROOF=`、`COMET_052_A5_CHECKPOINT_PROOF=`、`COMET_052_A5_VALIDATE_PROOF=`；schema 为 `comet.052.classic-a5.<mode>.v1`。基线 schema 为 `comet.052.classic-a5.baseline.v1`；`baselineHash` 是 `sha256(JSON.stringify(baseline))`。stdout 仅含完整 Run hash、各原 Actions/waits 身份摘要和文件摘要，不放完整 Run。baseline.formalContext 提供 `.git/052-a5-fixture-evidence/formal-edit-context.json` 引用与 SHA-256；模型可从该文件读取两份原批准全文和新增编辑后全文，checkpoint/validate 都检查其字节摘要。原始完整 seed Run 仍在 `.git/052-a5-fixture-evidence/baseline.json`，验证器重新读取实际 Run 并比较整份摘要，不信任这份可写历史副本。

装配器需要复制 A3 Classic 的 `driver.mjs`、`deterministic-driver.mjs`、`common.mjs` 到 `052-a5/original-a3/classic/`。本 helper 调用 seed 时显式指定公开 CLI，故不走 `cli-worker.mjs`。Comet 当前包位于 `/opt/comet-current`，OpenSpec 和安装环境沿用既有 Classic 容器；`COMET_DATA_DIR` 必须由 harness 提供并在同一 persistent volume 继承。没有 Superpowers 安装或调用；历史文档路径只是既有 legacy layout。此 helper 不读取或记录任何密钥。

主模型第一次真实 Bash 必须是 seed。模型运行期间 checkpoint 读取指定的本地 seed 基线；harness 在实际模型结束后取得配对 tool_use/tool_result，从 seed proof 冻结 baseline 到只读 `/_eval_trusted_oracles/052-a5/classic/baseline.json`。最终 validator 不允许本地回退。最终 host oracle 需要：`workflow: "classic"`、`subjectExitCode: 0`、`seedWasFirstBash: true`、`ordered: true`、`proofs: {seed:[proof],checkpoint:[proof]}`、两项 bindings（`mode`、`toolUseId`、`toolResultHash`、`proofHash`）、`forbiddenSkills: []`、既有 extra-Agent/子 Claude 审计字段，以及从实际最后 assistant event 提取的 `finalAssistantText` 和原始模型事件流 `rawStreamHash`。不能信任模型填写这些字段。

公开边界依据：`classicSdkArchiveGuard` 在 `apply=false` 时只调用 `assertClassicSdkArchiveReady`，在 `executeClassicSdkArchivePreflight` 和 `executeClassicSdkArchive` 前返回。就绪检查读取当前正式判断，`requirements-changed` 会拒绝候选。checkpoint 将要求 CLI 正常返回结构化 `checks.blocked=true` 和该语义原因，排除运输失败、无效命令或无关故障。此证据仅证明只读预检阻塞，不声称真实 Archive 执行失败。

subject prompt 只说明新增功能尚未得到回答、要核对已有批准与正式编辑并按公开 continuation 处理到需要用户决定的位置；不要预填 decision 枚举、receipt/Action ID 或留存选择。要求模型记录自己的判断后运行 checkpoint 并以真实消息请求用户决定，不能自行批准、实施新功能或执行流程修订。
