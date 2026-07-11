# npm 安装版 Eval Harness 设计

## 背景

`comet eval` 是普通用户验证 Skill 的入口，但 npm 包未发布仓库根目录的 `eval/` Harness。CLI 在未显式传入 `--project` 时把当前目录视为仓库根目录并以 `<cwd>/eval` 运行 `uv`，使全局安装用户在普通项目中得到误导性的 `spawnSync uv ENOENT`。

## 目标

- 全局或项目安装的 npm 包可直接运行 `comet eval`。
- `--project <dir>` 继续支持维护者指定外部、源码树中的 Harness。
- Harness 缺失与 `uv` 不可用必须给出不同且可操作的错误。
- 发布产物包含运行 Eval 所需的版本匹配 Harness，不包含缓存或报告产物。

## 设计

1. 将 `eval/` 加入 npm 发布白名单，并依赖既有忽略规则排除缓存、日志和本地运行产物。
2. Eval 命令新增内部默认 Harness 解析：未传 `--project` 时从已加载 CLI 模块的位置解析包根目录下的 `eval/`；传入 `--project` 时仍解析 `<project>/eval`。
3. 在调用 `uv` 前验证 Harness 根目录、`pyproject.toml` 与 `local/tests/tasks/test_tasks.py`。缺失时抛出包含已解析路径和恢复建议的 Harness 缺失错误；仅在 Harness 存在后检查并报告 `uv` 不可用。
4. 测试覆盖默认包内解析、显式项目覆盖、Harness 缺失错误，以及 npm 发布文件清单包含 Harness。

## 边界

- 不在 `init` 或 `update` 时下载 Harness；这会引入网络依赖与版本漂移。
- 不改变 `uv`、pytest、Docker 或模型提供商配置。
- 不更改 `--project` 作为外部 Harness 覆盖入口的兼容语义。

## 验证

- 针对 `eval` 命令的单元测试先失败后通过。
- 检查 `npm pack --dry-run` 的文件清单包含 Harness 入口。
- 执行构建、格式、架构 lint、相关测试与全量测试。
