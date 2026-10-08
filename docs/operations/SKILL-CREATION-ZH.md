# 使用 `/comet-any` 创建和交付工作流应用

描述目标后，`/comet-any` 调查真实 Skill，展示流程、工件、检查、失败路径和能力限制。用户确认方案后，Creator 编译完整 SDK 应用包，实际加载验证，再展示安装预览。创作与业务执行分别拥有自己的 Run；查询与恢复都保留原 Run ID。

支持三种起点：Native 的新增步骤、执行指导和附加验收；Classic full、hotfix、tweak 的 Skill 编排；拥有独立业务规则的 SDK 工作流。Native 主流程保留默认行为，报告审批样板不自动获得 Native 独立验收语义。

## 开始和继续

在 Agent 平台调用 `/comet-any` 并描述目标、需要的 Skill 和交付位置。宿主按公开 CLI 的当前 Action 工作：

```bash
comet creator guide --project . --json
comet creator candidates --project . --json
comet creator start <name> --project . --goal "<目标>" --install-target .claude/skills/<application> --host claude-code --json
comet creator status <name> --project . --json
comet creator next <name> --project . --json
```

`analyze` 由宿主真实读取并加载所需 Skill，提交实际内容的适配契约、固定摘要与执行模块。`compile`、`verify`、`preview`、`install` 由 `next` 的机器执行器完成。方案确认和安装确认分别绑定当前 Wait；前者不能代替后者，安装批准也不能代替业务发布批准。

## 完整包与本地安装

应用包包含 `application.json`、入口 Skill、执行与验证模块，以及固定的 Skill、脚本和资源。依赖缺失、漂移、输出 Schema 不匹配或验证器未注册会阻塞；不能用完成字符串替代实际产物和检查。

Creator 直接安装到当前创作已确认的项目相对目标。需要完整导出、双作用域托管安装或升级时，使用以下入口：

```bash
comet application export <package>/application.json <empty-export-directory> --project . --json
comet application distribute <export>/application.json --project . --platform claude --platform cursor --scope project --json
comet application distribute <export>/application.json --project . --platform codex --platform workbuddy --scope user --json
comet application distribute <export>/application.json --project . --platform all --scope project --preview --json
```

`distribute` 使用与 `comet init` 相同的 Comet 平台身份和 Skill 目录，包括项目与用户作用域的路径差异。`--platform` 可以重复，`all` 选择全部已注册平台；多个平台共享同一 Skill 目录时只安装一次。`install` 也接受 `--platform`，省略平台时只安装应用包。

不带 `--confirmation-hash` 的安装或分发只返回预览：目标、作用域、文件、固定依赖、各平台入口、所需宿主能力与冲突。用户明确批准后，将当前预览的 hash 传入同一命令执行安装。`--preview` 显式要求只读，不能与确认参数同时使用。内容、目标或已有安装改变后需要重新预览。`--user-root <directory>` 选择隔离用户目录；默认用户作用域使用当前 HOME。

分发安装入口和固定 Skill、脚本及资源，不修改平台已有的 Rule 或 Hook 配置。Comet 的共享工作流 Rule、Hook Router 和项目配置仍由 `comet init/update` 管理。预览中的 Rule/Hook 支持信息来自当前平台注册表；它不表示本次已安装或验证真实平台 Hook。宿主缺少 Skill 所需能力时，执行前仍会阻塞；文件安装成功不代表模型业务流程验收通过。

托管版本保存在目标 `.comet/applications/<id>/versions/<content-hash>/`。升级需显式 `--upgrade`，同版本不同内容拒绝；预览包含原来已分发的平台和本次新增平台，批准后更新全部托管入口。新的 Run 使用当前默认版本；活动 Run 按自己保存的原 `packageRoot` 继续，不迁移到新定义。固定 Skill 与同名宿主依赖冲突时保留现场，不覆盖用户内容；依赖内容改变时需要解决名称或固定版本冲突，不能静默覆盖。

```bash
comet application uninstall <id> --project . --scope user --json
# 只卸载一个平台的入口：
comet application uninstall <id> --project . --scope project --platform cursor --json
# 用户批准预览后，使用同一命令加 --confirmation-hash <current-hash>
```

卸载只移除本次管理的入口，保留全部版本及依赖。`--platform` 选择要取消的平台；共享目录仍被其他平台使用时保留入口。全部平台入口取消后才移除新 Run 的默认应用记录。用户级应用可能有其他项目的活动 Run，因此不会按当前项目的枚举结果清空版本，也不提供隐式 purge。结果会明确展示移除与保留范围。

## 可选 Eval

编译与加载验证后，`/comet-any` 会提供可选 Eval。选择评估后自动生成并冻结 2–4 个用例，在隔离工作区执行所选 Agent 和模型，检查业务产物与真实 SDK Run，最后返回报告。选择跳过则继续安装预览，并保留未评估状态。失败或未完成时可以重试、修订应用后重测，或明确跳过；原失败不会变成通过。重试和修订优先复用原用例，应用或配置变化后需要重新确认。

可选 `--eval-config <JSON文件>` 设置 agent、model、judgeAgent、judgeModel、maxTurns 和 timeoutSeconds。默认 8 轮交互、1200 秒总时限；这是执行范围限制，报告记录可获得的费用信息，并说明缺失项。凭据只从执行环境注入，不进入方案、应用包或报告。

也可以独立评估同一个 SDK 应用：

```bash
comet eval <package>/application.json --project . --collect
comet eval <package>/application.json --project . --agent codex --model <model>
```

`--collect` 只预览，不生成用例或调用模型。SDK 应用评估读取完整包、固定依赖和流程；不能用 `--quick` 的通用冒烟代替。安装与分发预览显示当前内容的评估状态、报告和限制；没有有效证据时明确显示未评估或证据失效，不阻止用户选择安装。

声明有外部副作用的 Skill 需要固定的测试替身。没有隔离实现时，评估会明确阻塞并保留未完成状态，不启动模型去执行真实外部操作。超时后的重试先核对原实验容器；无法确认停止时保留现场，不重复消费模型预算。

## SDK 样板与验证范围

`@rpamis/comet/applications/compiler` 的 `prepareWorkflowApplicationExample` 可生成 `native`、`classic-full`、`classic-hotfix`、`classic-tweak` 或 `standalone` 的完整本地样板。传入已有隔离项目的 `projectRoot`、空 `packageRoot` 和 `base`；返回 `application.json`。它不启动 Run、不提交用户决定，也不执行外部操作。

Native 样板检查普通候选、Supervisor 父级、Child 和集成候选各自的 `candidate.txt`。Classic 样板在原 Build 检查后追加真实工件审查，原阶段工作由宿主加载包内独立 Skill 执行；启动输入包含当前项目绝对路径 `projectRoot`，写入按这一实际工作区核对。独立报告样板生成草稿、核对来源、等待审批并本地发布；拒绝、修订和冷恢复保留原 Run。

定义检查、定向测试、生成 Runtime、npm 实际消费者、真实宿主 Hook/交接、真实模型 Eval 分别记录证据。编译成功不代表全部业务或生产验收通过。真实模型验收未运行、失败、超时或缺少轨迹时保持未完成。

## 恢复和边界

中断后先 inspect 原 Action，保留 attempt、inputHash 和领取身份，不重复已完成工作。未知外部结果先通过适配器查询：已执行则回传原结果；确认未执行且有证据时才走 SDK retry；没有核对能力时明确阻塞。凭据只从执行上下文注入，不进入方案、包、Run、报告或 Agent 配置。

只支持本地导出与安装，不提供远程 Git 分发或团队集中服务。旧生成链、旧 Creator 命令和 `workflow-protocol.json` 格式已退出；遇到旧格式提示重新生成，保留用户文件，不转换或迁移旧状态。

## 高级后端参考

```bash
comet creator dispatch <name> --project . --request <current-action-request.json> --json
comet runtime dispatch --application-file <package>/application.json --project-root . --request <request.json> --json
comet runtime dispatch --application <id> --project-root . --request <same-run-request.json> --json
```

按当前响应填写 claim、record-outcome 或 resolve-wait，使用真实宿主 session ID。`comet bundle`、`comet publish` 和 `comet eval` 的独立高级包与评估能力仍可使用；它们不再作为 SDK Creator 的旧生成或推进后端。
