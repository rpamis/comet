# 用户问题与回归案例维护

修复用户报告时，以“原问题能被再次检出”为完成条件。Review、单元测试与模型 Eval 各自提供证据，不能用其中一项通过替代其他必要边界。

## 从报告到案例

1. 保存 Issue URL，或为聊天、线上反馈指定稳定的 `report:<id>`。敏感日志先脱敏；登记来源不等于公开用户原始数据。
2. 拆分报告中的独立行为。例如“恢复后继续执行”与“恢复后重复写入”是不同断言，不能只测其中一个。记录旧版本、输入、环境、实际结果、预期结果和禁止结果。
3. 用最小临时项目或对应发布产物复现，定位根因。优先让同一案例先在旧代码失败、再在新代码通过，注明两个代码版本、执行命令和结果。没有旧版本或环境时写明缺口，保留替代证据；无法复现的问题仍标记未复现/未解决，不改写为已验证修复。
4. 新增测试或复用已有测试。复用须说明哪个断言对应哪个报告行为；仅链接一个大测试文件不够。每个已修复行为至少关联一个稳定 case ID，复杂问题可关联多个。
5. 登记案例，填写 PR 声明，运行定向检查和原故障边界的验收。分别列出通过、失败、未运行与原因。Review 核对全部已修复行为，不能只审核声明中的子集。

## 登记与精确执行

`config/historical-workflow-regressions.json` 保留冻结的历史基线。后续新增案例写入 `config/workflow-regressions.json`，格式如下。此处名称是示意，登记时必须替换为真实测试及实际完整名称：

```json
{
  "schema": "comet.release.bad-cases.v1",
  "cases": [
    {
      "id": "workflow-recovery-no-duplicate-write",
      "behavior": "恢复已完成的写入步骤时不重复产生副作用",
      "sources": ["report:stable-report-id"],
      "coverageLevel": "public-cli",
      "reproduction": "运行公开恢复命令两次，旧版本重复执行已经完成的写入",
      "expected": "恢复成功并保留一次写入的结果",
      "forbidden": "再次产生同一写入副作用",
      "rootCause": "恢复入口未核对已完成步骤的持久化证据",
      "tests": [
        {
          "file": "test/domains/example/recovery.test.ts",
          "namePattern": "does not repeat completed writes",
          "requiredNames": ["recovery does not repeat completed writes"]
        }
      ]
    }
  ]
}
```

`coverageLevel` 为 `unit`、`runtime` 或 `public-cli`，如实说明登记测试的边界；`reproduction`、`expected`、`forbidden`、`rootCause` 必须给出具体内容。

`file` 指向真实的 Vitest `.test.ts` 文件，`namePattern` 精确选择目标测试，`requiredNames` 使用执行报告中的完整测试名称。不要使用 `.*` 或整个 suite 代替目标行为；不能将不存在、未执行、跳过或失败的测试当作覆盖。新增登记支持跨产品领域，不限于 Native/Classic。

当前增量格式只支持已覆盖案例，不提供 `excluded` 或 `retired` 豁免状态。现有来源、行为与测试映射受保护，只能追加；附加验收允许从 `pending` 单向更新为 `verified`，但必须保留原层级和证据并追加实际验收证据；若测试需要迁移，当前实现仍须保留旧映射。不得通过改 ID、删除登记、skip 或降低断言消除失败。确需移除旧入口时，应先设计可审计的迁移机制，提供来源和行为覆盖的去向、等价或更强的执行证据，并单独经 Review 确认，不能把破坏校验作为迁移方案。

## PR 声明

PR 正文保留且只保留一个 `badcase-registration` HTML 注释块。涉及用户行为修复时，逐项声明来源、行为和案例 ID；`source` 必须同时保存在对应案例的 `sources` 中：

```text
<!-- badcase-registration
{"status":"fixes","fixes":[{"source":"report:stable-report-id","behavior":"恢复已完成的写入步骤时不重复产生副作用","caseIds":["workflow-recovery-no-duplicate-write"]}]}
-->
```

确实没有用户行为修复时，使用以下结构，并将理由替换为本次差异的具体说明。它不是“修了问题但没时间测”的豁免：

```text
<!-- badcase-registration
{"status":"no-user-behavior-fix","reason":"本次只修正文档中的链接，未改变产品行为或声称修复用户行为问题","fixes":[]}
-->
```

在仓库根目录运行：

```bash
pnpm check:badcase-registration --base <完整40位比较基线SHA> --pr-body <PR正文文本文件>
```

单独执行已登记案例（替换为真实 case ID）：

```bash
pnpm test:core-regressions --case workflow-recovery-no-duplicate-write --list
pnpm test:core-regressions --case workflow-recovery-no-duplicate-write
```

`--list` 只显示选择结果，不算执行通过；执行前会检查 Runtime 生成物是否与源码一致，不会自动重建。按风险先构建受影响产物，再运行选定案例，不因登记问题默认跑全量。

执行时，某组的子进程失败、报告缺失或必过断言未通过，不会阻止后续组执行。全部选择组结束后，`coverage/core-regressions/summary.json` 汇总成功组数、成功组的通过测试数和全部失败组；任一组失败，命令仍以非零状态退出。每组原始报告分别保留，旧报告在该组开始前清除。构建新鲜度等预检失败仍会停止执行，避免验证错误的 Runtime。

共享测试入口 `test/helpers/runtime-home.ts` 为所有 Vitest 套件和子进程准备同一物理临时根及隔离数据根。普通夹具不依赖 macOS `/var` 或 Windows 短目录名等隐式别名；涉及这些行为的案例须显式创建目录链接或短路径，并保留普通文件、已跟踪输入和 Runtime 归属的反例，不能靠环境规范化移除产品覆盖。

省略 `--pr-body` 时可检查登记差异；CI 通过真实 PR 事件读取正文。登记/声明的结构检查与案例执行不是同一件事，必须同时提供相关案例的实际执行结果。修改 PR 正文后会重新触发 CI，应核对最新结果，不能沿用旧声明的通过状态。

PR 使用实际目标分支 SHA、push 使用事件的旧 SHA 比较基线，检查历史覆盖没有缩减。手动 `workflow_dispatch` 缺少这些事件基线时回退到 `github.sha`，只证明当前清单一致性和本次实际执行结果，不能据此声称检查了历史缩减。首次引入清单时，只有比较基线提交真实可读且该文件确实不存在才允许初始化；缺失提交不能当作空清单跳过。

## 选择故障边界

- 纯函数或局部规则：用单元测试精确固定输入和输出；同时判断用户是否通过另一个入口触发该规则。
- CLI、Runtime 命令 bundle、安装与发布包：从公开入口在隔离目录操作真实产物，检查退出状态、文件和持久化状态；源码单元测试不能证明 bundle 或 npm 包正确。
- 状态转换、恢复与迁移：固定旧状态/版本，覆盖合法推进、失败中断和再次恢复，断言状态、候选与证据绑定、副作用次数。迁移样本保留，不用新状态覆盖旧 fixture。
- 安全和审批：根据原故障增加未批准不推进、不写入，拒绝无效或陈旧证据，隔离 workflow/候选，恢复不重复执行等反例；也要验证有效批准后的合法路径，避免“全部阻止”造成假通过。
- 真实平台 Hook：验证平台实际传入事件和安装入口，不能由直接调用内部 Guard 替代。
- 模型遵循协议：跑当前应用的真实模型 Eval，保留候选、模型、环境、命令与结果。静态场景校验、mock adapter 和测试收集成功只证明对应层。
- UI 交互：通过浏览器重现并验证用户操作路径，保留所用界面/构建、步骤和结果；DOM 单测或接口测试不能代替交互验收。

登记器当前只绑定 Vitest 案例。格式上可选的 `additionalAcceptance` 数组用于记录额外边界；凡涉及 UI、模型或真实平台 Hook 的问题，必须登记对应必要验收，不能因字段可省略而省略验收。每项包含 `layer`（非空的具体层级名称）、`status`（`pending` 或 `verified`）和 `evidence` 数组。`verified` 必须有非空证据，PR 的已修复声明不能引用仍有 `pending` 验收的案例。外部验收证据是否真实、是否覆盖行为仍由 Reviewer 核对，CI 不会因记录存在就执行浏览器或模型。真实模型、平台 Hook 和浏览器验收的实际记录应同时列在 PR/验收记录中，不要为满足登记伪造一个通过的占位测试。可以登记真实覆盖共享确定性契约的测试，但必须明确它未覆盖的边界。

完整发布流程会运行：

```bash
node scripts/lint/workflow-regressions.mjs --require-acceptance
```

该检查阻止仍有 `pending` 附加验收的案例进入发布结论，但不会自动启动浏览器、平台 Hook 或真实模型。`regressions-only` 可以单独运行仍待附加验收的确定性伴随测试，结果只证明该层，不构成发布放行。所有测试层并未因此统一自动运行；必要外部验收必须实际完成并提供证据。

## 未完成与例外

凭据缺失、环境不可用、超时、无法复现和不适合自动化时，明确记录已完成部分、限制、人工复现/验证记录、负责人及下一步。必要的故障边界尚未验证就不能宣称该问题已完成，也不能通过 `no-user-behavior-fix` 隐藏缺口。是否合并与是否证明用户问题已解决分别说明。

自动校验可以验证声明、来源映射和可执行案例，不能推断所有遗漏的用户报告，也不能判断描述和断言在语义上完全等价。作者负责完整声明，Reviewer 负责检查报告拆分、未声明行为、覆盖层级、安全反例和例外证据。检查通过不免除这些责任。
