# Native 0.5.0 已批准 Shape 样本

`native-sdk-050-approved-shape.json` 由 tag `0.5.0`（`aeb1a6598034e28ce46b8422d4dbd8785e607bd7`）的实际 Runtime 在独立临时 Git 项目生成。生成使用该提交源码与当前缓存依赖构建的 CLI（不是当时 npm 包的独立安装），`native-sdk-application.ts` 与 tag 内容 SHA-256 均为 `14e0a00b65b31db442ad277aa7fc3278ff5716056817af3e043efddcbc8d3af1`。

步骤：初始化 main 分支并提交 README，执行 `new legacy-change`，写入样本 brief，执行 `next --summary` 准备批准，再以返回的 state version 和 `confirm-shape` 执行 `next --confirmed`。保存完整 Run 与原文，没有手工设置 Build、验收项、确认指纹或待执行 Action。

样本中的测试计划标题与现有验收边界回归一致；“计划行号”对应 issue #504 的已知列名，不声称其他列逐字还原了用户未提供的原始表格。0.5.0 把其正文并入最后一条验收，回归必须保留原 A2 和 Run 身份，不能截断旧验收文字猜测边界。

Run 内 UUID claim 值由隔离测试 Runtime 生成，仅属于已完成的样本动作，不是外部服务凭据；样本没有机器路径或真实用户信息。
