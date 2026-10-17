/** 只描述接收方何时获取任务上下文；投影和 Guard 不执行检索。 */
export function taskContextRequest(options: {
  phase: string;
  language: 'en' | 'zh-CN';
  projectRoot?: string;
  sessionId?: string;
  instruction?: string;
  workflow?: 'native' | 'classic';
  change?: string;
}) {
  return {
    phase: options.phase,
    contextMode: 'snapshot' as const,
    commandArgs: [
      'comet',
      'task',
      options.projectRoot ?? '.',
      '--task',
      '<original-task>',
      '--phase',
      options.phase,
      '--session',
      options.sessionId ?? '<receiving-session-id>',
      '--context-mode',
      'snapshot',
      ...(options.workflow && options.change
        ? ['--workflow', options.workflow, '--change', options.change]
        : []),
      '--json',
    ],
    instruction: [
      options.language === 'zh-CN'
        ? '首次进入本阶段、交接给新 Agent 或上下文恢复后，由接收方用自己的会话标识和原始请求执行一次本命令，将返回的 context[].text 加入上下文；普通连续执行无需重复获取。将适用偏好和项目约束交给执行者与审查者。Skill 由平台按实际可用能力加载；不兼容或不可用时说明原因。已交付偏好不代表已加载或遵循 Skill；偏好不能代替 Runtime 检查或阶段授权。空结果或获取失败时沿用明确指令继续，不循环重试。'
        : 'On first entering this phase, handing off to a new Agent, or restoring context, the receiver runs this command once with its own session ID and the original task, then adds context[].text to context. Do not repeat during uninterrupted work. Pass applicable preferences and project constraints to implementers and reviewers. Load Skills using actual host capabilities; explain unavailable or incompatible choices. Delivery does not prove a Skill was loaded or followed; preferences do not replace Runtime checks or authorization. Continue with explicit instructions after empty or unavailable retrieval; do not loop on retries.',
      options.instruction,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
