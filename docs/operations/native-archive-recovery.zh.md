# 恢复 Native SDK 归档

先运行 `comet native status <change> --json`，保留原 Action、验收报告和事务。不要手改 Run 状态或删除事务文件。

- 新归档会在准备、应用 Specs、收尾及结果提交时核对候选实现。写入 Specs 前发现漂移会回到 Verify 的修订确认；按返回的 `revise-implementation` 命令修订，并重新验收、批准。
- 收尾在写入前明确发现漂移时，恢复已确认的实现与材料，再运行 `comet native archive <change>`。它继续原 Spec 事务，不重复应用 Specs。
- 执行结果未知时，先由原执行 Agent 确认执行已经停止，再运行 `comet native archive <change> --recover`。已完成收尾只凭完整持久收据补记原结果，不重新执行搬迁。
- 旧版已写入 Specs 的事务没有新归档摘要时，Runtime 会只读重建原 Spec 输入，精确匹配已保存的候选摘要。优先从 Git index/HEAD 读取与原目标哈希一致的版本；不会回写工作区或索引。
- 收尾已经完成且持久收据完整时，恢复输出会标记 `historicalRecovery: true`、`currentImplementationRevalidated: false`。这仅补记历史完成事实，不表示后续修改过的实现重新通过验收。

## 原 Spec 没有可用的 Git 版本

若错误提示缺少原文，只能提供归档前的真实备份，不能拿新 Spec 或当前实现代替。请把新备份文件放在项目之外；项目内新建 JSON 也会改变旧候选输入。文件最多 8 MiB，必须是普通文件，不能是符号链接。绝对路径只用于读取该备份，不扩大工作流可写范围；相对路径必须在项目内，不能包含 `..`。

备份格式如下。`runId` 和 `transactionId` 必须对应原 Run 与原归档事务；`ref` 是原事务中的项目相对 canonical Spec 路径，`content` 是完整 UTF-8 原文。

```json
{
  "schema": "comet.native.archive-originals.v1",
  "runId": "my-change",
  "transactionId": "原归档事务的 ID",
  "files": [
    {
      "ref": "docs/comet/specs/example/spec.md",
      "content": "# Example\n归档前的完整 Spec。\n"
    }
  ]
}
```

```bash
comet native archive my-change --legacy-spec-backup /absolute/path/original-specs.json
# 仅当原 Action 结果未知且原执行 Agent 已确认停止时：
comet native archive my-change --recover --legacy-spec-backup /absolute/path/original-specs.json
```

Runtime 拒绝未知字段、重复或事务外路径、错误 Run/事务 ID、错误原文哈希、链接与路径越界。所有原文还必须能重建原候选摘要；即使 Spec 备份正确，其他实现漂移仍会阻止归档。验证通过的备份原子保存为当前工作区、Run 和事务绑定的恢复证据；重复提交相同备份幂等，不覆盖不同内容。

例如：

- `schema、runId 或 transactionId 不匹配`：读取原记录后修正备份身份，不要创建新事务替代。
- `原文备份 ... 不属于原 Archive 事务`：移除多余路径，只提供原事务目标的备份。
- `候选实现已变化`：恢复原已确认实现；该备份不能授权新增代码。
- `旧检查缺少候选实现摘要`：不能用备份补造旧验收依据。尚未写入 Specs 时，按返回的 Verify 修订路径重新验收。

旧候选摘要本身缺失且 Specs 已写入时，备份不能补造验收依据。保留原事务、产物和检查记录，核对原证据；此损坏场景不能自动收尾。
