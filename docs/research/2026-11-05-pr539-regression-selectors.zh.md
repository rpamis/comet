# PR #539 回归选择器修复

来源与任务授权：https://github.com/rpamis/comet/pull/539。用户要求修复该 PR，直到 CI 全部通过。比较候选为 `f11eae563774bf0367c44714f14fb4176f92d321`。

Ubuntu 运行 42040157431 的 219 组中，211 组通过、8 组失败。失败报告中的测试没有失败断言：部分登记使用裸测试标题，但 Vitest 的选择器和报告使用包含 describe 的完整名称；另有测试改名或缺失，使选择器执行零项。

五个 `ci539` 案例采用 `tests-moved` 修正执行身份。原登记、来源、完整测试正文和新旧选择器逐项保存在 `pr539-regression-selector-migration/`。迁移只为原名称补上原有 suite；测试正文、产品实现、文件和逐行为断言不变。没有放宽结果校验器、减少 requiredNames 或允许跳过。

`edit-review.test.ts` 补回登记要求的连续编辑、SHA256/Git 内容链和原收据保留测试，覆盖未判断内容、跨 change、执行权限变化、原执行者及决定不可被覆盖等反例。Eval 预览把既有预算断言恢复为其登记的独立测试；这些确定性测试不启动模型。Native SDK 编辑测试同时执行独立会话与当前会话，恢复历史登记名称并核对正式 Verifier、候选与 Run 不被普通编辑判断替换。

旧候选的逐组原始 JSON 与 `summary.json` 来自 CI artifact `core-regressions-ubuntu-latest`，本机保存在 `.tmp/ci539-current-core/`。修复后的实际执行结果在 PR #539 CI 修复记录中补充；选择器收集成功不能代替执行通过。Reviewer 仍须核对本次名称迁移及恢复的行为覆盖。
