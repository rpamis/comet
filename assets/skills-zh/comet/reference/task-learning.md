# 任务学习收尾

任务结束前，由 Agent 分别检查个人偏好与项目经验，准备一个临时 UTF-8 JSON 文件。用户无需编写 JSON；文件不放进 change 产物或提交。

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

完成标准：`learningSubmission.status` 为 `applied`，个人检查已核验，`projectLearning.submissionVerified` 为 `true`，项目待评审与待处理数量均为 0。`accepted` 表示仍有待处理项，`partial` 表示部分写入失败；读取 `personalObservations`、`errors` 和 `learningSubmission.nextActions`，按实际原因处理，修正后可重交同一文件，已有回执不会重复创建。观察被忽略或跳过时说明原因；确认没有合格观察后，移除该观察并声明 `no-observation`，不创建占位记忆。`not-run`、延迟、来源变化或调用失败需明确说明，学习未完成不阻断已完成的开发任务。

旧版本不支持 `--learning-file` 时，沿用单项命令和显式检查参数，不循环重试不支持的选项。
