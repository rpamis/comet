# 按需使用与记录记忆

- **排查时按需查。** 先看本次已经收到的上下文。遇到像是项目旧问题的报错，或需要确认项目惯例时，运行 `comet knowledge query <project-root> --task "<报错或待确认的惯例>" --json`，已知目标文件或目录时加 `--path`。摘要相关且需要详情时再展开，用当前证据核对适用条件。需要确认个人偏好时，按需调用 `comet memory retrieve`。
- **复验通过后按需记。** 判断这次的做法能否帮下次任务省掉排查。值得复用就用 `comet knowledge remember` 记录现象、适用条件、有效做法和实际复验结果。本次属于已知工作流和 change 时，带上 `--workflow` 和 `--change`，保存返回的 slug。用户明确要求长期记住的偏好，用 `comet memory remember` 当场保存，沿用用户给出的适用范围。

正常收尾沿用工作流的完成命令。没有学习提交时，使用默认的 `not-run`，不创建空学习文件，也不为确认空队列运行 review。已经分别检查且确认没有可提交内容时，可以用 `--complete --learning-check no-observation --project-learning-check no-observation`；未执行检查时不能声明已经检查。

## 批量提交

有多条观察或经验，或者已有待评审动作、实际使用反馈需要合并提交时，准备一个临时 UTF-8 JSON 文件。用户无需编写 JSON，文件留在临时位置。

```json
{
  "schema": "comet.task-learning.v1",
  "personal": { "check": "no-observation" },
  "project": { "check": "no-observation" }
}
```

两个 `check` 分别填写：`submitted` 表示本次提交或已持有对应回执；`no-observation` 表示 Agent 已检查，确实没有可复用内容；未检查时填 `not-run`。缺少记录不能自动推断为已经检查。

需要保存内容时，增加相应数组，并将该部分 `check` 改为 `submitted`：

- `personal.observations`：可跨任务复用的用户纠正、偏好或协作习惯。每项包含 `scope`（`project` 或 `global`）、`category`、`text` 和稳定 `candidateKey`；`userEvidence` 保留最小用户原话。用户实际限定的阶段、路径、任务类型和操作分别写入 `phases`、`pathPatterns`、`taskTypes`、`operations`。用户明确要求长期记住时，仍立即调用 `comet memory remember`，不延迟到收尾。
- `project.memories`：当前项目中已验证且未来可复用的经验。每项包含 `title`、`text`，可附 `type`、`description`、`slug`、`paths` 和 `evidence`。`evidence` 为支持结论的项目相对文件路径数组；没有文件依据的已确认协作决策可省略。同一标题默认更新已有经验。
- `project.memorySlugs`：此前已用 `comet knowledge remember` 保存的本次 change 回执，无需重复提交正文。
- `project.reviews`：本次 change 的 `{ "id": "...", "actions": [] }` 评审动作。仅在完成响应提示存在待评审时，运行 `comet knowledge review <project-root> --workflow <workflow> --change <change-id> --json` 获取证据与字段要求。Agent 审核后将动作放入本数组；没有可复用结论时用空 `actions`。评审与经验在同一文件提交。
- `outcomes`：已实际使用且结果明确的上下文反馈，包含 `applicationId`、`outcome`。真实采用且验证通过时才使用 `used-successfully`，并填写 `evidence.decision` 和 `evidence.verification`（`command`、`success: true`）。未使用的条目不能标为成功。

个人记忆不保存任务摘要、实现进展、命令输出、测试结果或仓库公共事实。项目经验不保存一次性输出或未验证猜测。每类数组最多 16 项，整个学习文件最多 256 KiB。

一次提交并完成收尾：

```text
comet task <project-root> --task "<用户原始请求>" --complete --workflow <native|classic> --change <change-id> --learning-file <临时JSON文件> --json
```

使用文件时不再重复传 `--learning-check`、`--project-learning-check` 或 `--memory`。workflow 与 change 由命令绑定，不在数组中另填。

根据返回的 `learningSubmission.status` 报告结果。`applied` 表示已应用，`accepted` 表示已接收且仍有待处理项，`partial` 表示部分写入失败。确需继续处理时，参考 `personalObservations`、`errors` 和 `learningSubmission.nextActions`。修正失败项后可重交同一文件，已有回执会复用。学习未完成不阻断已完成的开发任务。

隐式工作流事件只写入现有学习队列，不在推进路径等待整理。待处理观察使用 `comet memory sync` 继续；排队不代表记忆已生效，也无需反复提交同一学习文件。显式记住、忘记和有证据的实际采用反馈仍立即处理。平台没有空闲事件适配时，需要显式运行 sync；安装插件不代表所有聊天都已自动接入。

旧版本不支持 `--learning-file` 时，沿用单项命令和显式检查参数，不循环重试不支持的选项。
