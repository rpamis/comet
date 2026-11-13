# 固定应用的 0.5.2 升级验证

来源：report:2026-11-10-agent-platform-execution。比较基线：630ce380787f446e803f94b4b90cbbdbf8663364。当前版本 0.5.3，原发布包 @rpamis/comet 0.5.2。

## 发现与修正

原 Native/Classic 固定应用包经过旧版公开 CLI 创建、批准和查询，升级后被 Runtime 版本全等检查提前拒绝。绕过这一检查的隔离诊断副本仍分别因旧 definition 整图校验、Classic 输出 schema 新增可选字段而拒绝。Classic 工厂也缺少原业务 Run 的读取适配。

当前修正仅允许 0.5.2 固定 Native/Classic 包继续原 Run。原包和依赖字节、应用身份、原定义与原 Run 的绑定仍核对；已持久化升级的 Run 必须匹配当前工厂。当前工厂只构造当前业务图，原绑定、扩展 validator、批准和当前 SDK 结构检查继续生效。身份中的 runtimeVersion 保持原 manifest 值。新 start、Standalone、其它版本或改过的包仍按原规则拒绝。

Classic 输出只接受新增可选 checks/checksReason 的已知差异，不接受其他 schema 漂移，不把缺失检查当通过。先读取并校验原 Portable/状态投影，再在外层适配返回的 Run，避免用新图去误判原 checkpoint。只读适配不写回；实际业务提交才持久化。

## 实际公开 CLI 证据

原根与原包保持不动，只切换临时安装依赖，未重绑定路径、改原 claim 或改写输入。隔离目录：

`C:/Users/BENYM/AppData/Local/Temp/comet-fixed-052-review-0e70dbe59dbd4c34bfee022c543ae06e/`

- `results.json`：16 条结果，10 条旧版成功、4 条原包在新 CLI 中的预期失败、2 条隔离诊断副本失败。原始请求和 stdout/stderr/exit 分别保存。
- `frozen-native.json` / `frozen-classic.json`：原包和原业务材料字节；旧机制记录另标为来源证据，不导入或恢复旧执行器。
- `green-results.json`：Native 两次查询、原候选审查结果续交、持久化后两次查询成功。全部 8 个原包文件字节不变，原扩展 input/inputHash/claim 不变，原 Action succeeded，后续独立 Verifier pending。
- 首轮 Classic 暴露适配位置错误：升级后的 Run 与原 checkpoint 被错误比较。曾按明确 next 续行成功，但这一结果不足以证明首次只读无感升级，失败日志保留。
- 修正位置并重新构建后，`second-green.mjs` 只还原原 Classic Portable/投影字节，未改底层 Run、包或路径；不调用 next。`second-green-results.json` 的四次独立进程查询全部成功：Classic 两次首次只读查询返回当前 v2，项目、包、全部业务 Runtime 文件字节无变化；Native 已持久化 v4 的两次再加载成功，原扩展领取和输入仍保持。

原 Shape/组合批准和 Builder 报告为明确标记的隔离协议模拟。Native 原版确实运行了一条确定性 Node 检查，并用真实候选审查脚本输出续交；没有伪造旧检查回执。Classic 最小包未配置执行 host，其旧版待领取 Skill 曾正确拒绝领取，未宣称执行完成。

## 其它实际检查与限制

- 两次 `pnpm build` 成功，日志 `coverage/fixed-application-compat-build.log` 与 `coverage/fixed-application-compat-build-second.log`。
- 当前通用加载边界定向测试 3 通过；首次运行发现写入入口仍依赖 resolver 隐式创建目录，修正为明确 ensure 后通过，原失败保留。
- 这份证据覆盖两种真实旧固定包及 Native 已领取扩展续交；未覆盖全部自定义扩展、完整后续验收/归档、安装打包或真实平台 Hook。
- 未执行 Eval、模型评估或全量测试。上述确定性旧检查和候选脚本不是模型行为证据。

本切片已由 Spec 复核确认；整轮测试迁移和当前差异检查仍在进行，不能据此宣称整个任务完成。

## 无 definition.json 的原包

Standards 复核另建全新临时项目，直接使用真实 0.5.2 官方 Native 样板，原包从创建起未声明 definition，不是删除已固定包中的文件。旧公开 CLI start/next/inspect/claim/inspect 五次成功，只模拟原 Shape 领取。切换当前已构建 0.5.3 后，两个独立进程查询均成功返回 v4；原 Action ID、step、attempt、input/inputHash、claim、running 状态及全部 Wait 保持，7 个固定包文件字节不变。

共 7 次公开 CLI 调用成功；原始结果、操作脚本与只读前后字节比较位于 `C:/Users/BENYM/AppData/Local/Temp/comet-052-no-definition-standards-7fc47fe5a7d449d7b3ad4bf1e0461100/`。未续交 Shape 结果、执行 Skill、检查器、模型或 Eval；此切片不能替代带定义旧包的候选扩展续交证据。
