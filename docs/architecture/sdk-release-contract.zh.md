# SDK 发行契约

本契约适用于 `@rpamis/comet/runtime`、`@rpamis/comet/plugins` 和 `@rpamis/comet/plugins/comet`。Native、Classic 和原有状态文件的使用方式不变。

## 支持范围和升级

- 三个入口是公开消费入口，随 Comet 版本维护。已有深层导入保留兼容，新应用不应依赖 `domains/` 文件布局。
- 补丁版本保持公开参数、返回结果和既有错误码的含义。增加可选字段、接口或错误码时，宿主仍需保守处理未识别的内容；不能假设错误码集合永远不变。破坏性变化须提供明确的版本与升级说明。
- npm 包版本、Run 的 `protocolVersion` / `schemaVersion`、Workflow 的 `id` / `version` 是不同契约。更新 npm 包不会自动更新活动 Run 固定的流程定义，也不会自动迁移旧 change。
- 恢复时提供原 Workflow 和验证器版本。修改流程内容应使用新版本，并保留活动 Run 所需的旧定义；不能改写同版本定义或修改检查点摘要来强行续跑。
- 当前 SDK 是 Node.js ESM。Node 支持范围见 `package.json` 的 `engines`；CI 发布包验证覆盖最低 Node 22.16 和 Node 24。TypeScript 消费验证使用 5.9.3，覆盖 `NodeNext` 与 `Bundler` 解析，并检查引用到的声明文件。暂不承诺更早的 TypeScript、CommonJS `require` 或浏览器运行；`Bundler` 类型解析通过不代表浏览器可执行。

## 公开接口变更检查

先构建，再检查三个入口的公开声明报告：

```bash
pnpm build
pnpm check:sdk-api
```

接受有意的接口变更时执行：

```bash
pnpm update:sdk-api
```

报告保存于 `config/sdk-api/*.api.md`。普通检查不覆盖接受的报告；缺少声明、报告缺失或声明变化会失败。CI 在发布包验证前执行检查。更新报告不证明变化兼容，仍需审查参数、返回结果、恢复语义和旧消费者；声明报告也不能代替行为测试。

## 错误与恢复

`RuntimeProtocolError` 保留现有 `name`、`code` 和消息格式，新增只读的 `recovery` 建议；公开类型为 `RuntimeErrorCode` 和 `RuntimeErrorRecovery`。构造器仍接受宿主自定义或未来错误码，未知值返回 `manual-review`。CLI 的既有错误输出不变，不应通过解析消息文字决定是否重试。

| `recovery`            | 宿主应做什么                                                                         |
| --------------------- | ------------------------------------------------------------------------------------ |
| `inspect-run`         | 重新读取 Run，检查 revision、Action、Wait 或终态，再判断原请求是否仍适用             |
| `review-proposal`     | 展示当前提案并取得用户对当前哈希的决定；不能复用旧确认                               |
| `reconcile-execution` | 先停止或联系原执行者，核对外部副作用；结果未知不代表未执行                           |
| `inspect-outcome`     | 读取已保存结果及拒绝原因；如需修正，按原领取身份与结果标识规则提交，不重做外部动作   |
| `correct-input`       | 核对请求、配置或验证要求；遇到保存状态错误时停止排查，不能直接编辑 Run               |
| `restore-definition`  | 提供原定义、验证器或兼容的 Runtime，修正宿主注册；不要换定义解释旧状态               |
| `repair-storage`      | 检查目录、文件系统和原记录，保存现场后修复适配器或恢复有效备份；不要删除历史绕过校验 |
| `manual-review`       | 保留现场和错误信息，先诊断；不自动重试                                               |

这些值是排障起点，不是执行授权，也不是 `retryable` 开关。即使收到取消或 revision 冲突，也应查询已提交状态后再判断是否继续。外部动作只能在确认未执行并提交 reconciliation 证据后重试。原结果被拒绝时，不要用“未执行”重试掩盖已经发生的副作用。

```ts
import { RuntimeProtocolError } from '@rpamis/comet/runtime';

try {
  await runtime.execute(command);
} catch (error) {
  if (error instanceof RuntimeProtocolError) {
    // 向宿主展示建议；这里不自动调用 retry 或重复执行工具。
    showRecovery({ code: error.code, recovery: error.recovery });
  }
  throw error;
}
```

上例中的 `runtime`、`command` 和 `showRecovery` 由宿主提供。插件的异常行为仍见[插件指南](./plugin-sdk.zh.md)：关键 `invoke` 使用 `{ throwOnError: true }`，不能把默认的 `null` 返回当作成功。

## 消费者和恢复验证

`pnpm test:package-e2e` 将真实 npm tarball 安装到隔离项目，验证公开 JS 导入、TypeScript 消费、声明文件、原 CLI 与 Native/Classic 接入。类型检查不使用 `skipLibCheck`，同时覆盖 `NodeNext` 和 `Bundler`。

冻结恢复样本位于 `test/fixtures/runtime-sdk-v1-045/`，由提交 `5990e5c3b8e27dc7e11ed99f0d49f5a90e5159f0` 的隔离源码实际生成。它检查审批续跑、原 Action 保留、陈旧确认和定义漂移拒绝，以及未知执行不自动重发。同一消费者脚本也在安装后的包中运行。

该样本来自首个公开 SDK 的未发布 0.4.5 候选，不能称为已发布 SDK 跨版本证明：当前 master 没有这个公开 Runtime 入口。后续版本须追加由真实已发布包生成的样本，记录包版本或提交，不覆盖旧样本，也不使用当前代码重算其摘要。旧 Native/Classic change 继续由 `compat` 路径处理，不能用这个 SDK 样本代替其兼容验收。
