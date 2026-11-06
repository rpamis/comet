---
generated_from_state_version: 14
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 3
- 验证器尝试次数: 1
- 完成时间: 2026-11-03T16:33:45.198Z
- 摘要: 已使用独立只读平台会话核对当前候选全部37项，全部通过，整体pass。当前:11正式检查原始日志摘要匹配：冻结材料准备4项、产品协议和资产65项通过；另核对真实CLI/恢复证据及最终0.5.2安装资产。A36认可真实边界材料、隐藏判定和离线装配准备，不代表模型质量或优化目标已验证。未修改产品、运行Eval/全量、代用户接受、归档、提交、推送或清理；等待Runtime报告与用户决定。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 配置省略、两种合法值：缺省 standard，合法值往返不变。 | 已读共享配置解析、默认值、渲染和合并实现：省略为standard，仅两种合法模式；当前正式协议检查覆盖往返断言并通过。 |
| A2 | passed | brief.md | 非法配置类型和值：明确拒绝，不能静默退回 standard。 | 解析器明确拒绝null、布尔、数组、对象、空串、大小写变体及其他值，未回落默认值；参数化负例已由当前正式检查执行通过。 |
| A3 | passed | brief.md | init/update/配置合并：保留模式、未知字段及未涉及配置；不恢复预算字段。 | 配置管理值和无损合并保留合法模式及未知字段，init/update沿用该生命周期；默认生成standard，未恢复snapshot预算或修改仓库配置自证。 |
| A4 | passed | brief.md | 新 Run 创建：从项目配置固定模式，状态和 Shape 展示相同。 | 创建锁内读取项目配置，将明确verifyMode写入Run输入；状态和Shape使用同一固定来源。已核对实际安装包新建bugfree结果及模式实现。 |
| A5 | passed | brief.md | 旧 Run 与旧定义：缺字段继续 standard；伪造 bugfree 字段不能改变旧定义。 | 缺字段按standard；固定v1定义拒绝bugfree。已核对完整pre-bugfree定义hash golden、历史定义派生和当前正式兼容检查通过记录。 |
| A6 | passed | brief.md | 中途修改配置：当前 Run 模式不变，新 Run 使用新值。 | nativeVerifyMode仅读取不可变Run输入；创建后修改配置的实际流程断言保持bugfree，新建路径重新读取配置。 |
| A7 | passed | brief.md | checkpoint 恢复：保留原模式、候选、Action 和审查来源；不读取本机模式替代。 | 真实CLI测试清空本机sdk-runs等目录后经doctor从checkpoint恢复，核对原模式和Verifier Action；扩展应用冷恢复也保留来源，没有以本机配置替换。 |
| A8 | passed | brief.md | 普通候选空命令计划：零子进程检查，仍有候选绑定，必须等待独立 Verifier。 | bugfree模板默认空检查，verify.checks仍完成真实候选绑定；已读零命令流程断言与正式证据，不生成测试通过，结果仍等待独立Verifier和用户。 |
| A9 | passed | brief.md | standard 行为：原检查模板、完整结果校验及新候选独立审查语义不被放宽。 | standard保留原模板和原完整结果parser，不接受紧凑字段；新父级空计划例外仅限bugfree。四个原断言失败已在144880f5隔离基线重现，未作为本轮通过证据。 |
| A10 | passed | brief.md | 主 Agent 冒充 Verifier：相同 Builder 身份、参与过实现的会话或错误 claim 均不能通过。 | bugfree结果核对claim与输出身份，并排除当前Run所有四类实现Action的参与会话；主Builder冒充负例及候选身份检查保留，本轮使用独立平台canonical身份。 |
| A11 | passed | brief.md | 同一候选重复派发：已运行/未知 Action 不产生第二个正式 Verifier。 | 复用原SDK领取、幂等和unknown执行协议，没有第二套派发状态；同候选活动Action只能沿原领取继续。实际本轮仅有本人领取的:12正式Verifier。 |
| A12 | passed | brief.md | 紧凑全部通过：明确 ID 完整覆盖才通过，报告按实际方法生成。 | 通过ID显式覆盖后规范化为语义审查理由，不生成命令或日志证据；已核对紧凑全通过、零命令报告与正式检查。 |
| A13 | passed | brief.md | 紧凑集合异常：漏项、未知 ID、重复、交叉重复、混用 passed 均拒绝。 | 紧凑集合精确校验并集、唯一性和全部ID，拒绝遗漏、未知、交叉重复及混用passed；当前正式协议负例通过。 |
| A14 | passed | brief.md | 总 verdict 与逐项不一致：按第 10 节规则拒绝，不能靠总 pass 补齐结论。 | 完整及紧凑bugfree结果共同执行覆盖校验并要求failed优先；已读完整格式旧红日志和修复后通过记录，standard原parser保持原语义。 |
| A15 | passed | brief.md | 完整旧结果：旧格式仍可读；standard 不接受 bugfree 专用字段。 | 未携带紧凑字段时继续读取完整旧格式；standard exactKeys拒绝passedAcceptanceIds，相关兼容断言在当前正式检查通过。 |
| A16 | passed | brief.md | 必需检查失败：紧凑 pass 仍被拒绝；旧成功、换 ID 和删除计划不能掩盖当前失败。 | 当前计划与补查结果一起进入requiredChecksPassed约束，失败不能pass，检查ID换命令冲突被拒绝；实际诊断失败仍保留且不会派发Verifier。 |
| A17 | passed | brief.md | 真实检查复用：复用原 Action 和日志，保持环境、计划与完整输入校验。 | 未改动原计划、环境、完整输入与日志复用约束；已读实际后继候选reusedFrom来源断言及通过日志，正式收据日志SHA核对一致。 |
| A18 | passed | brief.md | 同候选补查：原会话继续，检查只执行请求集合，不扩为全量。 | 同候选补查维持原会话和attempt，真实CLI测试运行所请求的actual-value检查后由原会话完成后继Action；不扩为全量。 |
| A19 | passed | brief.md | 两轮补查上限：沿用原上限，未解决问题不能自动通过。 | 原NATIVE_MAX_REQUEST_CHECK_ROUNDS两轮上限、等价重复请求及命令冲突校验仍生效，未新增超限后自动通过或另一套预算。 |
| A20 | passed | brief.md | 修复后续审：新 Action 绑定新候选；符合条件时建议原会话，覆盖全部验收 ID。 | 修复流程产生新候选及Action，实际变化包含完整和相邻差异；符合条件时从正式历史推导原会话，需重新claim并回报全部验收。 |
| A21 | passed | brief.md | 续审不满足条件：会话丢失、参与修改、需求变化、工作区变化时选择 fresh。 | 续审限定最近Shape周期内已完成的正式审查，核对实现参与、候选快照及工作区；旧执行未完成不能复用，平台会话不可恢复时产品指引要求fresh。 |
| A22 | passed | brief.md | 用户要求重新验收：新 attempt 使用新独立上下文，保留原历史。 | 用户要求同候选重新验收时session为fresh，旧reviewer再次回报被拒绝，历史保留；已读该真实流程测试和已有通过日志。 |
| A23 | passed | brief.md | 输入缺失或漂移：不完整快照、并发改写、正式需求漂移均不能通过。 | 创建基线及当前输入必须完整，pass前重读实际候选及正式需求；实际漂移、损坏基线负例拒绝通过，不能从当前字节补造历史基线。 |
| A24 | passed | brief.md | 报告失败恢复：不重新调用模型，恢复原报告 Action。 | 报告继续由独立Runtime Action生成并核对摘要；失败沿原报告Action恢复，不重新调用Verifier。未把基线同样失败的missing-report旧断言写为通过。 |
| A25 | passed | brief.md | 接受与 Archive：未接受不归档；接受后继续核对绑定；未知副作用不重放。 | 独立pass后仍停在verify.confirm，接受后再核对报告和输入，Archive事务及unknown副作用恢复未放宽；真实CLI模拟接受明确标注，本真实change未代用户接受。 |
| A26 | passed | brief.md | Supervisor 作用范围：仅父级最终 Verify 启用；Child/集成原要求不变。 | 已读真实Supervisor扩展链路及新的双模式准备：Child/集成仍需非空真实检查及验收；仅父级bugfree可空计划，任务包指向实际集成worktree。 |
| A27 | passed | brief.md | Native 扩展应用：扩展步骤仍执行，旧固定应用不被配置升级。 | 新扩展工厂保留登记的候选、Child、集成和父级步骤；固定旧定义走v1兼容并拒绝bugfree字段。扩展冷恢复和边界链路已有实际通过记录。 |
| A28 | passed | brief.md | 精简任务包：无 Builder 自评、完整聊天和成功日志正文；需求、失败及所有验收项仍可取得。 | bugfree投影仅包含已批准引用、全部验收、真实变化、检查摘要和原正式审查，未传Builder自评或成功日志正文；公开完整inspect仍兼容，Skill要求本地保存后提取当前材料。 |
| A29 | passed | brief.md | 任务包变化范围：首次覆盖 change 全部实现差异；续审另提供相邻差异，包含删除/重命名/未跟踪文件。 | 创建时捕获完整输入基线，以路径/hash/mode比较当前候选，新增删除覆盖重命名和未跟踪内容；续审额外给相邻候选变化，没有缩成最近commit。 |
| A30 | passed | brief.md | 报告事实：零命令不写测试通过；复用不写新执行；模式、方法和结果一致。 | 报告从实际收据区分executed/reused并保留原Action、attempt、candidate、check及日志；真实复用报告断言通过，零命令不写测试通过，历史失败不被改写。 |
| A31 | passed | brief.md | 公开 CLI 与 bundle：新建、领取、回报、补查、接受、恢复均从公开入口完成。 | 已读spawnSync公开CLI测试及helper，new、claim、record-outcome、补查、清空sdk-runs后doctor冷恢复、accept-result均由真实进程完成；3文件33项通过记录存在。 |
| A32 | passed | brief.md | 安装包：临时项目安装实际 npm 打包产物后配置生效，未携带仓库源码仍可运行。 | 独立执行安装版--version得0.5.2，确认无domains源码和test；package/manifest、编译application/report、Native next及双语指引SHA均与当前一致，冻结tgz摘要匹配，安装版new实际输出bugfree。 |
| A33 | passed | brief.md | 平台独立会话：平台真实创建和恢复会话；身份独立，等待超时不重派。 | 原平台任务:6恢复记录保留同canonical、claim及candidate，当前原Run显示其真实fail收据；当前新独立只读平台任务领取:12，未重复派发。Runtime关联证据不被表述为平台外身份认证。 |
| A34 | passed | brief.md | 历史与其他 workflow：Compat、Classic、历史 archive 和旧 SDK checkpoint 保持原行为。 | 旧定义hash、v1校验器和checkpoint身份保持，Compat/Classic无模式回填路径；共享配置生成资产同步且generated检查通过。未声称已执行全部历史套件或真实Hook。 |
| A35 | passed | brief.md | 修复后处理前轮诊断失败：用户要求的执行检查仍需真实通过；自主诊断失败可由独立 Verifier 确认语义修复，历史失败不得被隐藏或写成测试通过。 | 前轮真实诊断失败进入任务包和报告，后继修复允许语义确认但保留原失败、本轮未重跑；当前必需计划仍不可豁免，用户/项目明确检查要求须有真实通过证据。 |
| A36 | passed | brief.md | 模型对照授权与证据边界：遵守来源第16节；未获明确授权不启动 Eval，准备冻结案例、独立判定和指标采集；未执行时保留待验证状态，不宣称正确率或性能收益。 | 已独立核对24候选12对和6流程种子、逐文件/判定/锁文件/Runtime/tgz摘要；跨模块、持久化退出73后第二进程、真实CLI、浏览器DOM及HTTP、必需命令、双模式真实SDK/Git父级准备均有实现及当前4项正式通过日志。隐藏真值不装入模型工作区，完整Skill公开离线collect收集30目标，遥测缺失保留null。本项仅认可准备；模型执行环境、最终人工复核/快照冻结及质量性能对照仍待授权后核对，不计模型通过。 |
| A37 | passed | brief.md | 产品文档与发布资产：按来源第17—18节同步正式规格、中文及经确认的英文 Skill、配置说明和 Runtime 生成资产；根据实际 master/tag 决定版本与英文 Changelog，分别记录各验证层级。 | 已核对双语Skill语义同步、产品/SDK/配置说明、API报告及生成资产；package/manifest/Changelog按用户最新明确决定统一0.5.2。构建、生成、API、格式和定向检查有通过记录；完整架构lint因既有附件目录失败如实保留。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| 全部冻结候选、双模式Supervisor和完整离线装配 | node_modules/vitest/vitest.mjs run test/domains/eval/native-bugfree-preparation.test.ts | . | passed | 0 | 178362 ms |
| 最终配置协议、报告、兼容与资产 | node_modules/vitest/vitest.mjs run test/domains/comet-native/native-bugfree.test.ts test/domains/comet-native/native-sdk-definition-selection.test.ts test/domains/comet-native/native-verifier-protocol.test.ts test/domains/comet-native/native-verification-report-v2.test.ts test/repository/native-runtime-assets.test.ts | . | passed | 0 | 7538 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- 修复后的配置、状态与兼容测试: passed — 7文件99项通过，包括9个真实临时项目验收路径。
- 完整格式优先级、报告来源与真实CLI: passed — 3文件33项通过；CLI真实执行new/claim/outcome/request-checks/doctor checkpoint recovery/accept-result。实际收据复用来源另1项通过。
- 冻结材料与公开离线收集: passed — 3项普通确定性测试通过：24候选/6参考修复、摘要、隐藏判定、30任务离线collect与遥测缺失值；无模型或容器。
- 最终0.5.2包与构建: passed — build/check:generated/check:sdk-api/受影响格式/定向ESLint通过；最终npm包安装版--version=0.5.2，资产和编译模块哈希匹配并成功new bugfree。
- 已有环境与基线失败: failed — 原附件目录仍阻塞架构lint；4项历史失败在比较基线复现，未修改断言。
- 模型Eval/平台Hook/全量: not-run — 未授权模型Eval；无本地全量、真实平台Hook、质量或性能实测。
- 真实类别与对照准备: passed — rich-preparation-final 3项通过（24候选和6参考终点含真实浏览器及2个真实Supervisor）；standard-frozen-parent 1项通过；完整Skill及公共引用离线装配2项通过。产品协议/报告/资产5文件65项通过。Package 0.5.2已再打包安装并逐项比较最终native-sdk-application/report/next资产hash。
- 已知限制: 尚无模型质量或性能对照，不能声明正确率保持或收益比例达标；冻结小型案例不代表全部生产难度。
- 已知限制: 真实平台Hook及仓库全量未运行；原附件目录及4项基线失败保留。
- 已知限制: 所有fixture用户决定均为标记的模拟；真实用户尚未接受本change结果。无提交/推送/PR/清理。

## 阻塞项

_无。_

## 风险与跳过的工作

- 没有模型正确率、漏检率、耗时或token收益实测；未启动模型/容器Eval。正式模型运行前仍须核对执行环境、最终人工复核、完整快照摘要与用户授权范围。
- 仓库全量和真实平台Hook未执行；四个原测试断言已在隔离基线重现失败，未删除或降低断言。完整架构lint仍因既有.codex-remote-attachments目录失败，不能宣称全部检查通过。

## 之前的迭代

| 目标周期 | 迭代 | 尝试 | 结果 | 未解决项 | 摘要 | 完成时间 |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A14, A30, A31, A36, A37 | 同一独立只读平台任务恢复后核对全部37项：32项通过，A14/A30/A36/A37失败，A31公开CLI完整边界证据不足；整体fail，应返回Build。A33已据真实同任务恢复及原领取身份核对通过。其余首轮结论保持；原候选未修改。没有启动Eval、全量、真实平台Hook、提交或归档。 | 2026-11-03T14:34:06.949Z |
| 1 | 2 | 1 | fail | A36 | 独立只读核对当前修复候选全部37项：36项通过，A36失败，整体fail，应返回Build补齐冻结基准的真实跨模块、持久化重启、CLI、浏览器和Supervisor材料。已核对正式Runtime收据及日志摘要、公开CLI流程和最终0.5.2安装资产；未启动模型/容器Eval或全量测试，未修改产品、接受结果、归档、提交或推送。 | 2026-11-03T15:09:44.946Z |
| 1 | 3 | 1 | pass | — | 已使用独立只读平台会话核对当前候选全部37项，全部通过，整体pass。当前:11正式检查原始日志摘要匹配：冻结材料准备4项、产品协议和资产65项通过；另核对真实CLI/恢复证据及最终0.5.2安装资产。A36认可真实边界材料、隐藏判定和离线装配准备，不代表模型质量或优化目标已验证。未修改产品、运行Eval/全量、代用户接受、归档、提交、推送或清理；等待Runtime报告与用户决定。 | 2026-11-03T16:33:45.198Z |



## 结论

已使用独立只读平台会话核对当前候选全部37项，全部通过，整体pass。当前:11正式检查原始日志摘要匹配：冻结材料准备4项、产品协议和资产65项通过；另核对真实CLI/恢复证据及最终0.5.2安装资产。A36认可真实边界材料、隐藏判定和离线装配准备，不代表模型质量或优化目标已验证。未修改产品、运行Eval/全量、代用户接受、归档、提交、推送或清理；等待Runtime报告与用户决定。
