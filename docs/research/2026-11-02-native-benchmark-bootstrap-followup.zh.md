# 内置数据集启动链路后续修复

日期：2026-11-02。来源：`report:2026-11-02-workbuddy-verifier-bootstrap`。本轮用户要求修复，没有启动新的 Eval、模型调用、任务评分或评测容器。此前失败运行保留在[试跑记录](2026-11-02-native-benchmark-glm53flash-smoke.zh.md)中。

## 修复内容

前一轮已生成仅含运行时依赖的 Comet 安装清单，解决完整仓库清单触发 npm `edgesOut` 的解析问题。本轮继续检查安装结果和后续 WorkBuddy 评分入口。

WorkBuddy 固定源码的 [pyproject.toml](https://github.com/Tencent/workbuddy-bench/blob/625b2233093ae4f23e76be28c1f341d41cc70373/pyproject.toml) 通过 `tool.uv.sources` 固定 Harbor `v0.18.0`，但现有 Docker 装配只执行 `pip install git+...workbuddy-bench`。普通 pip 不应用这个 uv 来源，当前解析实际选择了 PyPI 的 `harbor-0.25.0`；原日志同时保留下载 metadata 和 wheel 的记录。

现已在 pip 命令中显式固定两个 Git 提交：

- WorkBuddy：`625b2233093ae4f23e76be28c1f341d41cc70373`。
- Harbor：`527d50deb63a5d279e8c20593c18a2cbc7f61f9e`，通过 `git ls-remote` 核对为上游 `v0.18.0` 标签对应的提交；[该版本项目声明](https://github.com/harbor-framework/harbor/blob/527d50deb63a5d279e8c20593c18a2cbc7f61f9e/pyproject.toml)为 `0.18.0`，要求 Python 3.12 或更高。

评分依赖安装到 `/opt/comet-verifier` 独立 venv。WorkBuddy 评分入口改用 `/opt/comet-verifier/bin/python -I`，避免从题目的 Python 导入路径加载评分模块。未替换容器 PATH，原始测试脚本及其子命令继续使用题目 Python。SkillsBench 的评分解释器没有改动。

## 实际验证

- 新增两项定向 Python 测试在修改前均失败，修改后通过；数据集模块共 17 项测试通过。断言覆盖固定 Git 提交、独立 venv、专用评分命令、`-I`、正常 reward 与清理步骤。
- 使用前一轮已成功安装的最小运行时依赖，在独立目录复制当前 `bin`、`dist`、`assets` 和原始项目清单，通过真实 `bin/comet.js` 执行 `--version`、`native init`、`native root show`。返回版本 `0.5.4`，初始化创建 `.comet/config.yaml`，root 查询成功。HOME、配置目录与项目均隔离，Daemon 关闭，没有启动 Agent 或模型。初次探针遗漏 `root` 的 `show` 子命令而返回 64，修正探针输入后成功，未当作产品缺陷。
- Python 3.12 普通安装对照中，旧命令选择 Harbor `0.25.0`，新命令成功解析两个 Git 固定提交；但两条完整安装最终均因下载摘要校验失败而退出 1，没有执行新环境的模块导入检查。不能将其记为安装成功。

安装失败保留的摘要分别为：

```text
before expected: 2cbd737377e710ee740d261c94e93fa0f08e6d037c18f17513cc0a2d94479a34
before received: eae4d9199ae057c991672bb0c12371890054e73460c5f776d44562110d562197
after expected:  2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9
after received:  e7a12e990ccf66bd4472785772c688ad98c85d680a7ce6e717b171c74ec5194a
```

- Ubuntu 24.04 普通安装探针使用校验过的官方 Node `22.20.0` 压缩包，SHA-256 为 `00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc`。WSL 访问 PyPI 的 SSL 连接超时，venv seed 失败；npm 安装也未完成。已按专属临时目录中的 Node 可执行路径停止该探针进程，未终止整个 WSL 或修改系统网络。Linux 安装不计为通过。

探针、普通安装日志和隔离 CLI 项目位于 `.comet/eval/launches/2026-11-02-bootstrap-repair-linux/`，不随 npm 分发。下载摘要失败的具体包或传输原因尚未定位，没有关闭摘要检查、放宽版本检查或为取得通过结果删除失败日志。

## 回归与剩余验证

新增登记案例：`eval-workbuddy-verifier-dependency-pins`、`eval-workbuddy-private-score-interpreter`。对应确定性测试固定装配和执行边界；真实任务镜像中的评分库安装及专用解释器仍为 `pending`。

后续执行者应先确认下载链路能够返回符合摘要的 Python 包，再在用户明确要求启动 Eval 后验证真实镜像、GLM、Native 流程及原始评分。本轮修复未构成新的 Eval 授权，也没有把静态断言、公开 CLI 或普通安装结果替代为模型通过证据。

代码修改集中在数据集 Python 适配、对应测试与回归登记，Changelog 合并到现有 `0.5.4` 的最终能力描述；当前 `origin/master` 为 `0.5.3`，不新增版本。保留其余工作区修改，未提交、推送、发布或修改 `website`。

最终定向检查：正式回归入口选择 7 个登记案例，汇总 1 组、7 项 Vitest 测试通过、0 失败；Ruff、lint（0 错误、8 条既有警告）、架构检查、登记及基线保留、受影响文件 Prettier、`git diff --check` 通过。npm dry-run 压缩大小为 18,940,380 字节、展开大小为 73,942,512 字节，包含更新的适配模块，运行缓存文件数为 0。未运行仓库全量测试、完整构建、真实平台 Hook 或新的 Eval。
