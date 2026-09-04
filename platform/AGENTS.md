# 平台与安装生命周期

<!-- comet-development-rule:platform-lifecycle -->

- 平台目录、Skill、Rule、Hook 和配置格式必须以目标平台当前官方契约为依据；复制文件成功不等于平台会加载或执行它。
- 新平台或新资产覆盖完整的 init、inspect/doctor、update 和 uninstall 生命周期，并验证 project/global 作用域。
- 所有安装和卸载测试使用临时项目与临时 HOME，不读取或修改开发者真实配置。
- 平台差异集中在 `platform/` 适配器，不把路径、shell 或版本判断散落到 domain。
- 声称 Hook 或 Rule 支持前，执行宿主能够识别的真实入口；静态路径断言只能证明安装布局。
