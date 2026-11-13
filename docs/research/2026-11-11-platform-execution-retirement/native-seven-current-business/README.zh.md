# Native 七档业务测试迁移

授权来源：report:2026-11-10-agent-platform-execution。比较基线为 630ce380787f446e803f94b4b90cbbdbf8663364。仅退休本次明确撤下的普通执行、重复状态、自动扫描合同；不将未支持的旧跨根续行或旧执行器称为已修复。

59 原声明、61 原参数用例逐条原文和分类见 declaration-review-map.json；33 项保留业务，25 项混合迁移，1 项纯 mandatory-check 模型退休。旧完整文件正文见 tests.json，原病例字段及链见 registry.json，选择器映射见 mapping.json。所有未触及选择器原样保留；通过 CAS 追加，不改写任何历史节点。

当前七档保留 57 项可运行选择（另 1 项原 autolink CLI/bundle 测试本轮不重跑，沿用根完整 Native 实跑通过证据，避免测试辅助器自行 build）。新增真实 SDK source-CLI Archive/cleanup 4 参数场景。根正式应用、构建及定向复测仍是合入条件，Temp source 代理不冒充生成 bundle 验证。

实测与限制见 FINAL.zh.md。原 compiled CLI/bundle 未随本子任务构建，未启动 Eval。当前 SDK 方法均用真实工厂、实际 Run/批准/领取和公开 source CLI，未绑定合成旧图。legacy-overlay 是明确建模的缺字段旧投影，不称真实052；真实050升级测试沿用冻结发布 Run。

Review 条件：必要业务的 root 源码修正合入后，通过全部当前相关定向选择；源代码中的旧 final-verification 写入/恢复实现和门面出口物理删除；保留实际 Git/Archive/cleanup 责任；静态 evidence/registry 和 tests.patch 正反检查通过之后，才可应用退休/替换。
