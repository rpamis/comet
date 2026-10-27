# Vitest 覆盖率修复

`vitest@4.1.12.patch` 回补上游 [#10643](https://github.com/vitest-dev/vitest/pull/10643)，对应问题 [#10581](https://github.com/vitest-dev/vitest/issues/10581)。

测试 worker 可能在动态导入完成前退出。原版本只在模块求值结束后登记代码包装器的偏移；未完成模块会以零偏移参与覆盖率合并，把已执行语句记为未覆盖，也可能把未调用函数记为已覆盖。补丁在开始求值前登记同一偏移，保留结束后的完整耗时记录。

补丁通过 `package.json` 的 `pnpm.patchedDependencies` 和锁文件应用，不改变覆盖率范围、门槛或测试选择。回归测试为 `test/repository/coverage-runtime.test.ts`，同时检查真实命中和未执行代码的零命中。

升级到包含该上游修复的版本时，移除补丁前运行该回归测试；不能仅凭版本号或覆盖率数值上升判断修复存在。
