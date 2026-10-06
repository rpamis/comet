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
comet application install <export>/application.json --project . --scope project --host claude-code --json
comet application install <export>/application.json --project . --scope user --host codex --json
```

不带 `--confirmation-hash` 的 install 只返回预览：目标、作用域、文件、固定依赖、宿主入口与冲突。用户明确批准后，将当前预览的 hash 传入同一命令执行安装。内容、目标或已有安装改变后需要重新预览。`--user-root <directory>` 选择隔离用户目录；默认用户作用域使用当前 HOME。只交付包而不安装宿主 Skill 时省略 `--host`。

托管版本保存在目标 `.comet/applications/<id>/versions/<content-hash>/`。升级需显式 `--upgrade`，同版本不同内容拒绝。新的 Run 使用当前默认版本；活动 Run 按自己保存的原 `packageRoot` 继续，不迁移到新定义。固定 Skill 与同名宿主依赖冲突时保留现场，不覆盖用户内容。

```bash
comet application uninstall <id> --project . --scope user --json
# 用户批准预览后，使用同一命令加 --confirmation-hash <current-hash>
```

卸载只取消新 Run 的默认入口和本次管理的宿主入口，保留全部版本及依赖。用户级应用可能有其他项目的活动 Run，因此不会按当前项目的枚举结果清空版本，也不提供隐式 purge。结果会明确展示保留范围。

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
