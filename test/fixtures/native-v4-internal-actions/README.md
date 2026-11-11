# 原 Native v4 已批准结果前沿

`workflow.json` 是已有的旧 v4 定义。新增两份 Run 由真实已安装的 0.5.3 包在完全隔离临时项目生成：双 Child 实际 Git 提交与集成、Parent 验收、明确标记的模拟用户接受。旧包定义与该文件精确一致，既有 SDK 定义身份为 `26c4e50c65dcb5e1280529642a73b650400e3109ba6fa2efded90e03ad790443`。

- `approved-result-pending.json`：原批准 Wait `:17` 已解决，旧 `verify.revalidate` `:18` pending。
- `approved-result-unknown.json`：同一前沿已领取后记录 unknown，原 claim 保留。

来源与实际原型：`C:/Users/BENYM/AppData/Local/Temp/comet-old-v4-approved-frontier-7f3e61b5/` 的 `generate.mjs`、`verify-source.mjs`、`verify-current.mjs`、`current-results.json`。没有手工构造新的 Wait 或改写原输入；未执行模型、Eval、交付或旧 revalidate。这里是安装包证据，不声称 0.5.3 已发布。

测试只读取这些原字节，在内存中适配并调度当前业务图，不加载旧工厂、不迁移绝对路径、不执行归档或 Git。真正步骤名是 `verify.revalidate`，没有 `supervisor.parent.accepted` 别名。
