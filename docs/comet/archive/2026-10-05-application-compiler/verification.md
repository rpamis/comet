---
generated_from_state_version: 1
---

# 验证

## 当前结果

- 结果: **已归档**
- 验证情况: **已完成检查，验证结果已确认**
- 目标周期: 1
- 迭代: 1
- 验证器尝试次数: 1
- 完成时间: 2026-10-05T18:58:39.510Z
- 摘要: 独立只读验收 A16/A17：先读取正式brief、完整目标Spec R16/R17、children契约、候选实现/测试及正式检查，最后读取Builder交接。候选HEAD441b16c3、baseb55b1bed、分支/worktree/contractHash及Action71身份一致，工作区干净。复用Action70九项正式Runtime检查，全部passed/exit0，逐份日志SHA相符；契约为10文件86项，npm包安装与公开消费者成功。额外核对32个候选文件摘要、57份父保存材料摘要、清单内开发日志与3个真实安装包实现摘要；公开包只读探针验证编译器解析、非法JSON方案拒绝且不生成目标、完成字段伪造拒绝、修正真实输出后接受且文件不变。默认Native definition经defineWorkflow规范化实测hash仍500dc5be719eb5493dbdadf35c372de49f0232439eef849bb521f6b3db346aff。没有重跑已匹配完整计划；未执行全仓/CI/真实Hook或模型12样本/完整双作用域安装与外部服务，其验收仍属于后续delivery-validation，不能宣称整体生产验证完成。

## 验收

| 编号 | 结果 | 来源 | 验收项 | 原因 |
| --- | --- | --- | --- | --- |
| A16 | passed | brief.md | 相同方案与依赖生成一致的有效产物；未声明转换、缺失验证器及重复或冲突身份在执行前被发现。 | R16：workflow-generation compiler从declarative native/classic/report composition生成application.mjs，真实调用现有公开领域工厂并按声明选择extension scopes/顺序/替换；bindings.mjs仅返回validators/executors，禁止手写application.mjs或返回workflows/handler覆盖。prepare装配实际有效定义供确认；compile绑定完整规范化plan（图、handler/validator版本引用、组合、身份、Skill资源/适配、模块真实源文本）并重新读取依赖装配核对图。确认hash仅校验材料一致，文档明确不代表真实用户授权，后续Creator须保存决定。同方案资源双编译contentHash一致；Native全scope与candidate-only生成不同图/绑定/工厂闭包；Classic不同同点顺序经真实Git项目原Open领域证据检查分别派发alpha/beta，伪域摘要拒绝；编译独立report审批前等待，跨进程原Run审批后完成发布。未声明edge、缺validator/可路由host、重复Skill/workflow/executor、内置身份冲突和实际图偏差在创建目标前拒绝。正式Action70九项含build/API/生成物/真实npm消费者；三个安装JS SHA一致。恢复/安装身份及入口由同源manifest/plan派生。 |
| A17 | passed | brief.md | 非法 JSON、缺失必填数据、过期工件、错误候选和伪造完成字符串无法满足相应检查；拒绝后保留现场并给出修正动作。 | R17：plan实际JSON解析与Ajv结构必填校验；业务createApplicationArtifactValidator严格校验成功输出结构，bindingHash绑定原Action.input，currentCandidate实际读取与原Action候选和output.candidateHash一致，protected路径读取真实字节核对SHA，再解析实际JSON运行Ajv/schema、requiredText和可选业务检查，异步检查后重读候选与工件防漂移。Action70正式工件回归实证非法JSON、缺items/空数据、旧摘要、错候选/Action、completedChecks字符串/字段、候选变化和空业务验收结果拒绝，SDK保留原Action/claim/inputHash/被拒Outcome，实际文件不改写，返回修正动作；修正真实文件后同Action新outcomeId完成。独立实际npm包探针再次确认完成字段伪造被拒、正确候选/工件SHA接受且文件保留；公开包消费者先waiting且无publish，新进程显式审批后同Run completed。没有将Builder自评或仅存在文件当通过证据。 |

## 检查

| 检查 | 命令 | 工作目录 | 状态 | 退出码 | 耗时 |
| --- | --- | --- | --- | ---: | ---: |
| 构建候选与生成Runtime | build.js | . | passed | 0 | 23589 ms |
| 完整Child契约与相关应用回归 | D:/Project/Comet/node_modules/vitest/vitest.mjs run test/domains/workflow-generation/compiler.test.ts test/domains/workflow-application test/domains/comet-native/native-application.test.ts test/domains/comet-classic/classic-application.test.ts test/scripts/sdk-api.test.ts test/repository/native-runtime-assets.test.ts test/repository/comet-entry-runtime-assets.test.ts | . | passed | 0 | 405023 ms |
| Native生成物确定性 | scripts/build/build-native-runtime.mjs --check | . | passed | 0 | 1171 ms |
| Entry生成物确定性 | scripts/build/build-entry-runtime.mjs --check | . | passed | 0 | 300 ms |
| 公开SDK API报告 | scripts/release/check-sdk-api.mjs | . | passed | 0 | 16844 ms |
| 架构许可与目录归属 | scripts/lint/architecture.mjs | . | passed | 0 | 2896 ms |
| 受影响生产模块lint | D:/Project/Comet/node_modules/eslint/bin/eslint.js domains/workflow-generation domains/workflow-application | . | passed | 0 | 1425 ms |
| 候选文件格式 | D:/Project/Comet/node_modules/prettier/bin/prettier.cjs --check AGENTS.md CHANGELOG.md config/repository-layout.json docs/architecture/workflow-application-compiler.zh.md domains/workflow-application/application.ts domains/workflow-application/artifact-validator.ts domains/workflow-application/index.ts domains/workflow-generation/compiler.ts domains/workflow-generation/index.ts package.json scripts/lib/workflow-application-compiler-example.mjs scripts/release/check-sdk-api.mjs scripts/release/package-e2e.mjs test/domains/workflow-application/artifact-validator.test.ts test/domains/workflow-generation/compiler.test.ts test/scripts/sdk-api.test.ts | . | passed | 0 | 1565 ms |
| 真实npm包安装与消费者及恢复 | scripts/release/package-e2e.mjs | . | passed | 0 | 133198 ms |

### Builder 报告的证据

以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。

- 构建候选与生成Runtime: passed — —
- 完整Child契约与相关应用回归: passed — —
- Native生成物确定性: passed — —
- Entry生成物确定性: passed — —
- 公开SDK API报告: passed — —
- 架构许可与目录归属: passed — —
- 受影响生产模块lint: passed — —
- 候选文件格式: passed — —
- 真实npm包安装与消费者及恢复: passed — —

## 阻塞项

_无。_

## 风险与跳过的工作

_未报告风险。_

## 之前的迭代

_没有之前的迭代。_



## 结论

独立只读验收 A16/A17：先读取正式brief、完整目标Spec R16/R17、children契约、候选实现/测试及正式检查，最后读取Builder交接。候选HEAD441b16c3、baseb55b1bed、分支/worktree/contractHash及Action71身份一致，工作区干净。复用Action70九项正式Runtime检查，全部passed/exit0，逐份日志SHA相符；契约为10文件86项，npm包安装与公开消费者成功。额外核对32个候选文件摘要、57份父保存材料摘要、清单内开发日志与3个真实安装包实现摘要；公开包只读探针验证编译器解析、非法JSON方案拒绝且不生成目标、完成字段伪造拒绝、修正真实输出后接受且文件不变。默认Native definition经defineWorkflow规范化实测hash仍500dc5be719eb5493dbdadf35c372de49f0232439eef849bb521f6b3db346aff。没有重跑已匹配完整计划；未执行全仓/CI/真实Hook或模型12样本/完整双作用域安装与外部服务，其验收仍属于后续delivery-validation，不能宣称整体生产验证完成。
