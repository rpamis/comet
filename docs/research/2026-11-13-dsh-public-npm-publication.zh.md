# DSH 插件公共 npm 发布

来源：`report:dsh-plugin-public-npm-053`。用户要求直接在 master 修复并发布，便于用户通过包名安装。

## 原因与复现

基线 `e4f9987b` 已发布 `@rpamis/comet@0.5.3`，但查询公共 registry 的
`comet-dsh-plugin` 返回 E404。插件构建器替换了版本和 CLI 依赖，却把源码模板中的
`private: true` 一并复制到正式产物；主包发布不会自动发布独立插件。

在原构建器上，将现有公开构建测试改为要求正式包可公开发布后，执行：

```text
pnpm exec vitest run test/scripts/dsh-plugin-build.test.ts -t "builds an installable bundle"
```

断言因构建产物仍包含 `private: true` 失败。对应案例登记为
`dsh-plugin-public-npm-package`，测试选择器见 `config/workflow-regressions.json`。

## 调整与验证边界

源码模板保持私有，防止发布 `0.0.0` 和未替换的 CLI 依赖。仅正式构建包移除
`private`，设置公共 registry 与 `access: public`；主包版本和 CLI 依赖匹配关系保留。
发布说明要求分别发布两个包，并在发布后从公共 registry 拉取验证。

修改后，DSH 打包测试及发布元数据测试共 12 项通过。生成物检查、主包构建、SDK API
兼容检查、架构检查与 lint、格式检查、主包及插件发布文件扫描通过；lint 保留 9 个
已有警告。实际 npm 包含 103 个文件、13 个 Skills，压缩体积 7,314,299 字节，发布预演通过。

本次发布的是独立插件的首个 `0.5.3`，依赖已经发布的主包 `0.5.3`，不重新发布主包。
真实 npm 发布、下载和隔离安装结果分别记录在本次交付中；构建与单元测试本身不证明
公共 registry 可下载或真实桌面平台已经加载插件。本次不启动真实模型 Eval。
