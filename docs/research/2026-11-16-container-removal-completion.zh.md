# Docker 容器删除完成检查

来源：[PR #562 的 Linux Runtime smoke](https://github.com/rpamis/comet/actions/runs/43824667030/job/133156268104)，提交 `12becade`。

## 观察与复现

原真实 Docker 集成检查的 Skill worker 已退出，但读取到 `executionStatus: stopping`，错误为“原实验容器仍未清理，停止未完成”；Application 超时清理案例通过。原断言、容器清理范围和其他实验存活断言均保留。

原日志没有保存 `docker stop` / `docker rm` 的 stderr，因此无法仅凭该日志证明 Docker 当时返回了删除进行中。调查得到一个可重复触发同一错误的分支：`--rm` 已开始自动删除，显式 `rm --force` 返回删除进行中，随后的查询仍短暂看见容器。

[Moby Engine API 变更记录](https://github.com/moby/moby/blob/master/api/docs/CHANGELOG.md)说明，自动删除由 daemon 在容器退出后执行；删除中的容器具有 `removing` 状态，再次删除可返回 `removal of container … is already in progress`。这里的自动删除解释是基于该接口行为的推断，原 CI stderr 缺口没有改写成已观测事实。

新增普通单元测试 `test/domains/eval/eval-container-removal.test.ts` 在 Docker 命令边界重放此响应：后续两次查询仍可见容器，随后消失。未修复代码的合法完成案例失败，另两个失败保护案例通过；修改后三个案例通过。测试不创建容器、不请求模型，不启动 Eval。

## 修改范围

只在明确收到删除进行中错误时，使用已有删除命令的 10 秒时限，等待本项目、本实验已登记容器消失。停止和删除各执行一次，随后保留原有完整归属及清理检查。权限错误不进入等待；删除一直未完成时仍失败，不生成停止成功证明，不删除其他实验。

稳定案例：`eval-562-container-removal-in-progress`，登记于 `config/workflow-regressions.json`。原 Docker 集成测试没有删除、跳过、缩窄或延长时限。

## 验证边界

- 定向单元测试：3 个通过；其中合法删除完成案例先失败、后通过。
- 已登记案例执行：1 组、3 个断言通过；原容器清理、进程清理证明和公开 CLI 生命周期三个文件共 41 个测试通过。
- `pnpm build`、`pnpm lint`、`pnpm check:generated`、受影响文件 Prettier 和网站 `mint validate` 通过。没有运行本地全量测试。
- 原故障边界：由最新 GitHub CI 的真实 Docker 集成检查确认；最终结果另按该提交实际 CI 记录报告，不以单元测试替代。
- 未在本地启动容器 Eval 或真实模型 Eval，用户没有授予该执行范围。

## 同轮其他修正

发布测试的四处 npm URL 判断改为解析后的精确 hostname 比较，保留原发布顺序、预览、失败和补发断言。发布测试 30 个通过。网站中英文 0.5.4 更新日志同步新增发布自动化及本次容器清理行为。
