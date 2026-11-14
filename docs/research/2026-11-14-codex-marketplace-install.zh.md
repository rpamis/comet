# Codex Git 地址安装修复

来源：`report:codex-marketplace-windows-install-20261114`。

用户只需在 Codex 添加插件市场时填写 `https://github.com/rpamis/comet`，Git 引用和稀疏路径留空，随后选择 Comet 安装。用户不需要构建源码或执行 npm 安装命令。

## 问题与修复

1. **Windows 检出失败**：基线 `9b2c15a8cbb321ae4e36d48849676e14d90eba24` 的两个研究快照路径在报告中的 Codex 临时目录下分别达到 270、271 个字符。隔离 Git 全局和系统配置、关闭 `core.longpaths` 后，在同为 84 字符的 checkout 根目录运行真实 `git clone`，两条路径均报 `Filename too long`，退出 128。仅将两个快照的文件名缩短为 `checks.test.ts.txt`，原内容不变，保留原目录与历史断言。相同条件下的候选克隆退出 0，完整检出 4,288 个文件，工作树干净。
2. **仓库缺少市场入口**：基线未跟踪 `.agents/plugins/marketplace.json`；`plugin/codex/` 仅是模板，缺少实际安装所需的 Skills、服务器和配套 CLI 包。新增仓库根市场清单，并让现有构建器生成可单独发布的 `@rpamis/comet-codex-plugin@0.5.3`。市场使用 Codex 支持的 npm 来源，客户端自动下载完整产物，无需用户填写稀疏路径。

用户要求不因本次安装修复发布 0.5.4。保持主包和插件版本 0.5.3；主 CLI 无需重新发布。Codex 插件 npm 包此前不存在，必须首次单独发布，不能将主包已经发布视为插件已经可安装。

市场格式依据 [Codex 官方市场配置文档](https://developers.openai.com/plugins/build/plugins#marketplace-metadata)：Git 仓库提供根市场清单，插件来源可指定 npm 包，客户端下载时不运行生命周期脚本。npm 是维护者的分发渠道，用户输入仍只有 Git 地址。

## 已执行的验证

- 修改前，`pnpm exec vitest run test/repository/codex-marketplace.test.ts` 两项失败，分别命中两条超长路径和缺失市场清单。
- 修改前，插件包定向测试在真实构建后因缺少 `comet/package.json` 失败。
- 修改后，`pnpm exec vitest run test/scripts/codex-plugin-build.test.ts test/repository/codex-marketplace.test.ts test/repository/release-metadata.test.ts` 通过 9 项。包测试执行真实 `npm pack --ignore-scripts`、解包、包内容比对和 MCP 启动，保留原 tar 归档验证；检查无生命周期脚本、Skills/MCP/CLI/Hook 文件齐全。本地安装 Skill 目录继续被 Git 忽略。
- 补充 npm 与 tar 产物完整字节比对时，一轮测试因对大 Buffer 使用通用深比较超时；改用 `Buffer.equals` 保持全部文件的字节一致性检查，没有提高超时或缩小比较范围，再运行相同定向命令。
- 隔离 Git 配置和默认路径限制下，旧版 clone 退出 128；只含两个文件重命名的候选 clone 退出 0，文件数相同。候选通过独立临时索引生成，不修改真实分支提交或真实暂存区。
- `pnpm build:codex-plugin --output-root D:/Project/Comet/dist/codex-plugin/0.5.3-marketplace-fix-20261114` 成功，生成完整本地市场与插件归档。
- 使用独立临时 `CODEX_HOME` 执行 `codex plugin marketplace add <构建目录> --json` 和 `codex plugin add comet@comet-market --json` 成功。`codex plugin list --json` 返回版本 0.5.3、`installed: true`、`enabled: true`。没有改动真实 Codex 插件安装；临时目录导致的辅助命令别名警告不影响安装结果。
- `pnpm lint` 退出 0，架构检查通过；存在 9 条未改动文件的 unused-vars 警告。
- badcase 登记与基线保留检查、受影响文件格式检查、`git diff --check` 通过。完整发布附加验收检查按预期拒绝尚未公开安装的案例，不能作为发布通过记录。

最终待发布产物为 `dist/codex-plugin/0.5.3-marketplace-ready-20261114/rpamis-comet-codex-plugin-0.5.3.tgz`，真实 `npm pack --ignore-scripts` 生成 209 个文件、压缩大小 27,023,649 字节；对应插件根目录为同级 `comet/`。

维护阶段曾为当前用户设置 `git config --global core.longpaths true`，作为本机缓解；仓库修复的克隆验证明确隔离该设置，不依赖它。网站子模块保持原样。

## 尚未完成的远端验收

公共 npm 查询 `@rpamis/comet-codex-plugin@0.5.3` 返回 E404；主包 `@rpamis/comet@0.5.3` 存在。本地安装通过不能证明 GitHub 地址安装已恢复。

用户后续明确要求先提交并推送全部修复，包发布由用户执行。因此先交付 Git 修复，保持主包版本 0.5.3；公共 npm 包发布前，远端安装仍缺少插件产物。用户可直接发布已验证的 tarball：

```powershell
npm publish "D:\Project\Comet\dist\codex-plugin\0.5.3-marketplace-ready-20261114\rpamis-comet-codex-plugin-0.5.3.tgz" --access public --registry https://registry.npmjs.org/
```

负责人：用户负责包发布，维护者负责发布后的验收。包发布后从公共 registry 拉取验证，再使用独立 Codex 配置只传 Git 地址添加市场并安装 Comet。完成后将登记项 `codex-marketplace-git-url-installation` 的远端附加验收由 `pending` 更新为 `verified`，追加真实结果。未完成前不宣称该用户问题已经关闭。

未执行全量测试：影响范围为市场清单、插件构建与两条归档路径，定向检查覆盖相关行为。未执行 Eval：用户没有启动授权，改动不涉及模型行为。没有执行真实平台 Hook、npm publish 或桌面 UI 安装；用户已授权本轮提交并推送代码，包由用户另行发布。CLI 安装不冒充其他层级的验证证据。
