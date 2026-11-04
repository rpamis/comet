# Native bugfree 实施记录

## Builder 交接前的记录

本文件记录 Builder 交接前的实现和验证事实。后续独立验收、用户接受及归档进度以 Runtime 当前状态和生成的验收报告为准，不以本节的阶段描述代替。

工作区为 `D:\Project\Comet` 的 `052`，比较基线为 `144880f53ae7b826d8d5b58997ac51ee6ace5f26`。用户已确认完整 Shape 并进入 Build。首轮 Builder 为 native-bugfree:4；独立 Verifier :6 已提交真实 fail，Runtime 返回 Build，首轮修复为 :7；第二轮 Verifier :9 以36项通过、A36失败返回Build，当前由原Builder领取 :10 补齐。

配置、固定策略、最终语义审查任务包、紧凑结果、补查、修复续审、独立身份限制、真实报告和旧定义兼容已落地。普通新 Run、固定扩展应用和 Supervisor 父级最终 Verify 均有真实临时项目测试。Child 与集成检查继续原协议。

用户已确认中文产品 Skill并授权同步英文；双语入口、bugfree参考和manifest已同步。用户随后明确将当前开发版本统一为0.5.2，所有较高开发版本的Changelog合并到0.5.2；package.json和assets/manifest.json均为0.5.2。origin/master的0.5.3仅作为比较记录，版本决策以用户本次明确要求为准。最终独立验收尚未完成。

## 实现位置

| 行为                                       | 主要源码                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 严格配置、默认值、渲染及合并               | `domains/workflow-contract/project-config.ts`、`types.ts`                                                    |
| 不可变模式与旧定义限制                     | `native-verification-policy.ts`、`native-sdk-create.ts`、`native-sdk-definition.ts`、`native-application.ts` |
| 完整基线、真实变化范围和审查会话建议       | `native-verifier-context.ts`                                                                                 |
| 当前模板与精简任务包                       | `native-sdk-continuation.ts`                                                                                 |
| 独立身份、候选及结果校验                   | `native-sdk-application.ts`、`native-verifier-protocol.ts`                                                   |
| 按实际方法生成报告，保留前轮失败与是否重跑 | `native-sdk-report.ts`、`native-verification-report-v2.ts`                                                   |
| 模式展示                                   | `native-sdk-status.ts`、`native-output-language.ts`                                                          |

除表中共享配置外，Native 文件均位于 `domains/comet-native/`。生成的 Native、Classic、Entry bundle 来自实际构建，没有直接在 `.mjs` 中修改业务逻辑。公开 Native SDK 增加 `prepareNativeVerificationBaseline`，已同步 API 报告。

## 验收项与证据入口

本表用于 Builder 自检与后续独立验收，不代替 Verifier 的逐项结论。未列独立执行证据的边界仍须明确保留限制。

| 验收 ID      | 实现及当前证据                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1–A3        | `native-bugfree.test.ts` 的配置组覆盖缺省、合法往返、非法类型及合并保留；`native-config.test.ts` 和 `global-config.test.ts` 覆盖相邻配置契约。                                                                                            |
| A4、A6       | `native-verifier-context.test.ts` 的 pins mode 案例在创建后改回 standard，仍按原 bugfree 执行；公开安装包 new 返回 bugfree。                                                                                                              |
| A5、A34      | 原 workflow hash 的 golden 测试、`native-sdk-definition-selection.test.ts` 和 v1 验证器限制；standard 相邻测试分别记录，未运行所有历史 workflow 套件。                                                                                    |
| A7、A27      | `native-bugfree-application.test.ts` 的真实扩展步骤与冷恢复案例保留模式、Action 和确认来源；原标准应用测试的已知失败另见下节。                                                                                                            |
| A8、A12、A30 | pins mode 案例用空计划完成候选绑定、独立紧凑回报和报告，再等待用户；断言报告没有伪造命令检查。                                                                                                                                            |
| A9、A15      | standard 仍使用原完整结果解析；bugfree 专用字段在 standard 解析中拒绝。原检查计划、身份、日志和候选校验未放宽。                                                                                                                           |
| A10          | 实际 Builder 冒充 Verifier 被拒绝；实现会话全集检查同时覆盖父级、Child 和集成修复。                                                                                                                                                       |
| A11          | 原 SDK Action 领取及 unknown 恢复机制保持，未添加第二套派发状态；相关 unknown 案例单独运行。                                                                                                                                              |
| A13–A14      | 紧凑协议组覆盖漏项、重复、未知、集合交叉、混用及 fail/blocked 优先关系，调用原完整验收校验。                                                                                                                                              |
| A16–A17      | 原检查执行、请求失败拒绝及日志篡改案例；实际诊断失败案例确认失败后不派发 Verifier，且原失败结果保留。                                                                                                                                     |
| A18          | actual requested-check 案例真实执行最小命令，再由原会话领取并完成后继 Action。                                                                                                                                                            |
| A19          | 原补查上限与 ID/命令冲突规则继续生效；未新增另一套预算。                                                                                                                                                                                  |
| A20          | actual repair 案例产生新候选、附相邻变化，建议原独立审查会话，重新覆盖全部验收。                                                                                                                                                          |
| A21          | 根据需求周期、原执行状态、所有实现参与会话及前后候选工作区核对续审资格；平台会话不可恢复时，指引要求改用新独立会话。未声称已在真实平台模拟所有会话丢失情形。                                                                              |
| A22          | explicit reverify 案例要求 fresh，原审查会话的再次回报被拒绝。                                                                                                                                                                            |
| A23          | actual candidate drift 和 corrupted creation baseline 案例均拒绝紧凑 pass；不得从当前候选补造创建基线。                                                                                                                                   |
| A24–A25      | 继续使用原报告 Action、用户 Wait、Archive 校验和事务恢复；未接受不归档。公开 CLI smoke 停在真实结果确认 Wait，没有伪造用户接受。                                                                                                          |
| A26          | 真实 Supervisor 扩展测试保留 Child 检查、反向审查和集成修复；最终父级任务包正确指向集成 worktree。                                                                                                                                        |
| A28–A29      | `verificationContext` 无 Builder 自评或成功日志正文；完整需求与验收 ID、创建基线至当前变化、相邻候选变化和真实失败仍可取得。完整 SDK inspect 不变，Skill 指引只把当前任务包和模板提取进模型。                                             |
| A31          | test/app/native-bugfree-cli.test.ts 真实进程执行新建、领取、提交、补查、doctor冷恢复和accept-result；3文件33项修复检查通过，未用handler代替CLI边界。                                                                                      |
| A32          | 实际 `npm pack`、临时目录 `npm install --ignore-scripts`，以安装包中的 `bin/comet.js native new` 创建 bugfree Run；最终0.5.2包已重新打包安装，双语指引及编译模块哈希一致，安装版CLI显示0.5.2并成功创建bugfree Run；不含真实平台Hook证明。 |
| A33          | 首轮平台任务 /root/native_bugfree_verifier 独立领取 :6，结束后由 followup_task 恢复同一任务，核对原候选及claim并提交真实fail；原历史已保留。fixture身份仍只证明Runtime关联。                                                              |
| A35          | actual diagnostic failure 案例保留真实失败，后继修复可零命令语义确认；报告列出前轮失败及本轮未重跑，不把失败改成通过。明确要求的执行检查仍由 Agent 理解并独立核对。                                                                       |
| A36          | 详见 `2026-11-03-native-bugfree-eval-preparation.zh.md`。24个候选、6个流程种子、内容/锁文件摘要、隐藏判定、指标映射与公开CLI离线收集已准备并经确定性测试；模型执行和正确率/性能对照未执行。                                               |
| A37          | 中文使用说明、SDK 说明、源码、API 报告和 Runtime 生成物已准备；中文经用户确认后同步英文，manifest 与 0.5.2 Changelog 已更新；最终独立验收尚未完成。                                                                                       |

## 已执行检查

原始命令输出保存在本机忽略目录 `.tmp/native-bugfree/`，不作为可随 Git 分发的测试产物。这里的测试计数按各次执行记录，重复运行不可累加成独立覆盖数量。

- 最终核心轮：`native-bugfree.test.ts`、`native-verifier-context.test.ts`、`native-sdk-definition-selection.test.ts`、`native-verifier-protocol.test.ts`、`native-verification-report-v2.test.ts`，5 文件 65 项通过。后补的创建基线损坏案例单独 1 项通过。
- 配置与 Skill/项目规则契约轮：`native-sdk-skill-routing.test.ts`、`native-source-coverage-contract.test.ts`、`development-agent-rules.test.ts`、`native-config.test.ts`，4 文件 63 项通过。
- 最终边界轮：`native-bugfree-cli.test.ts`、`native-bugfree-application.test.ts`、`global-config.test.ts`，3 文件 8 项通过，包含真实 CLI、固定应用冷恢复和 Supervisor 的 Child/集成/父级完整链路。
- 标准行为定向轮：8 项中 7 项通过、1 项失败；额外恢复/冲突/Archive 轮 9 项中 8 项通过、1 项失败。两项失败均已用比较基线的相同测试复现。
- `pnpm build`、`pnpm check:generated`、`pnpm check:sdk-api` 通过。构建包含 TypeScript 和实际 Runtime 资产生成。
- 受影响文件 Prettier 与定向 ESLint 通过。完整 `pnpm lint` 中 ESLint 为 0 error、8 条既有 warning，架构检查因原有 `.codex-remote-attachments` 顶层目录失败；未删除目录或修改许可规则。
- `pnpm verify:changed --base 144880f53ae7b826d8d5b58997ac51ee6ace5f26 --plan --json` 已检查选择范围。它选择整个 Native/domain 套件，实际按具体行为运行上述最小相关测试，没有把整套 domain 测试记为通过。

- 双语与发布资产轮：native-sdk-skill-routing、native-source-coverage-contract、native-runtime-assets，3 文件 22 项通过。

## 基线失败

在独立临时目录展开比较基线源码，复用依赖但独立构建后，以下原断言均重现相同失败：

1. `native-sdk-application.test.ts` 的 `reverifies the same candidate after a passed result without returning to Build` 在首次 Runtime 检查前新增 `settings.json`，触发候选漂移拒绝。
2. `native-application.test.ts` 的真实 disk Skill 案例在 before-write Hook 断言期望 false、实际 true。
3. 同文件 Supervisor 案例在公开 CLI 已自动完成准备后仍寻找 pending prepare，得到 undefined。
4. `native-sdk-application.test.ts` 的 `generates a missing report without overwriting a user-moved file or inventing a backup` 在首次检查前新增普通文档，触发候选漂移。

以上未静默删除、跳过或弱化原断言，也未纳入本轮修复范围。另外 `native-config.test.ts` 原期待值缺少实际已存在的 `change_walkthrough: true`；已用原实现重现，并补齐该事实与新增模式的精确期望。

## 首轮独立验收及修复

独立Verifier首次审查32项通过、4项失败、1项阻塞，已正式提交并返回Build。失败与阻塞均保留，未改写为通过：A14完整结果格式未强制fail优先；A30普通成功复用缺来源；A31公开CLI补查/接受/恢复证据不足；A36只有准备计划；A37尚未遵守用户新版本要求。

修复加入完整格式负例，先在旧代码失败，再修正bugfree两种格式的一致判定，保留standard兼容。报告从实际Runtime收据标明新执行或复用及原Action、候选和日志；真实后继候选收据复用测试通过。公开CLI完整链路通过；冷恢复测试已清空内置sdk-runs后从真实checkpoint恢复，未修改恢复实现。对照材料新增冻结JSON、隐藏判定与离线collect测试，3项通过。没有启动模型或容器。版本与Changelog统一为0.5.2。修复后状态/配置等7文件99项、协议/报告/完整CLI等3文件33项、离线准备3项均通过；这些轮次存在重复用例，不能相加作为独立案例数。最终0.5.2包安装后版本、双语资产和新建模式均核对通过，构建/生成物/SDK API/格式和定向ESLint通过，架构检查仍仅被原附件目录阻塞。

## 第二轮独立验收及真实边界补齐

第二轮保留36项通过结论，仅A36因函数级种子与已确认类别不符判为fail，已正式返回Build。现补齐分文件模块、真实Node CLI、持久化完成点退出与新进程恢复、真实浏览器及HTTP请求，以及真实SDK/Git Child检查、集成和父级候选。两个Child先在正确基线上通过共享存储检查，缺陷只在父级提交前引入；父级不自报不存在的命令通过。隐藏判定使用源码字节一致的副本，不修改绑定候选。Agent/User仍为模拟，模型或容器均未启动。

实际父级空计划准备还暴露了parent validator无条件要求检查的遗漏：已只对bugfree允许空计划，standard、Child和集成检查原要求不变。原失败日志rich-preparation-tests-3.txt与通过日志rich-preparation-final.txt均保留。补齐后24候选和6参考流程重放通过、公开离线装配与遥测映射通过；相关产品协议/生成资产5文件65项通过。standard 对照父级也已真实准备并保留必需语法检查，不能把语法通过当成语义通过。最终新候选仍须独立验收。

## 尚未完成与授权边界

双语 Skill、发布清单和 Changelog 已同步。本 change 仍在 Build，最终独立验收和用户接受尚未发生。未运行仓库全量、真实平台 Hook、模型 Eval、性能/正确率对照、发布或部署；不得据普通测试声明正确率保持或优化比例达标。没有提交、推送、PR、归档或工作区清理，website 内容及引用未变。任务未完成，因此尚未发送任务完成邮件。
