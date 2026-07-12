# CLI Banner 品牌动效设计

## 背景

`comet init` 当前输出单色静态 `COMET` ASCII Banner，并使用两行标语 `Agent Skill Harness Phase-Guarded Automation / From Idea To Archive`。它能表达产品名称，但没有体现 Comet 图标由品牌蓝、扫光和粒子消散构成的视觉特征。CLI `--help` 与 `package.json` 也使用同一旧标语，需要随 Banner 一起保持一致。

## 目标

- 为交互式 `comet init` 增加一次短促、克制的彗星扫光动效。
- 使用与 Comet favicon 同风格的深蓝、品牌蓝和亮青蓝层次。
- 将 CLI 标语统一为 `Agent Skill Harness For Turning Ideas Into Evaluated Workflows`。
- 保证自动化、无颜色和不支持动态刷新的终端输出稳定、可读。
- 动效或终端能力检测失败不得阻断安装流程。

## 交互与视觉

Banner 保留现有六行 `COMET` ASCII 字形。交互式终端中，Logo 从左向右逐列完成一次约 600–800ms 的扫光：未扫过区域使用深蓝，扫光前沿使用亮青蓝，扫过区域稳定为品牌蓝。扫光到达右侧时，Logo 右边短暂显示少量 `·`、`•` 粒子并快速消失，呼应 favicon 右侧的像素拖尾。

动效结束后保留稳定的品牌蓝 Logo，并在下方居中显示单行标语：

```text
Agent Skill Harness For Turning Ideas Into Evaluated Workflows
```

动画只播放一次，不循环，不加入声音，也不延长后续安装步骤的输出节奏。
动画不发送隐藏或显示光标的控制序列，避免 Ctrl+C 或终止信号在 JavaScript 清理路径之外中断时遗留隐藏光标。

## 架构

新增独立的 CLI Banner 模块，负责以下边界明确的能力：

1. 保存 Logo 字形、标语和品牌色板。
2. 生成无 ANSI 控制符的静态 Banner。
3. 根据当前动画进度生成单帧彩色 Banner。
4. 判断运行环境是否允许动画并播放帧序列。
5. 清理临时帧并留下最终静态彩色 Banner。

`init` 命令只调用一个 Banner 输出入口，不持有颜色、计时或光标控制逻辑。CLI 根命令描述和 `package.json` 描述直接使用新标语；不在本次改动中调整 README 或 website 内容。

## 降级与错误处理

以下情况不播放动画，直接输出无控制字符的静态 Banner：

- 使用 `--json`；该模式继续抑制全部 Banner 输出。
- 标准输出不是 TTY。
- 检测到 CI 环境。
- 设置了 `NO_COLOR`。
- 终端能力不足或动画播放期间发生异常。

动画入口必须在写入帧前完成能力判断。播放异常被局部捕获并回退到静态输出，不改变 `comet init` 的退出码，也不影响安装步骤。静态文本不得依赖 ANSI 支持，便于日志采集与快照测试。

## 测试

- 单元测试验证新 Logo 标语、静态输出和标语居中规则。
- 使用可控时钟与输出适配器验证扫光帧顺序、品牌色层次和最终稳定帧，避免真实等待导致测试变慢。
- 覆盖非 TTY、CI、`NO_COLOR` 和动画异常时的静态降级。
- 保留并扩展 `--json` 不输出 Banner 的端到端测试。
- 验证 CLI `--help` 描述与 `package.json` 描述使用同一新标语。

## 发布说明与版本

这是从当前 `master` 的 `0.4.0-beta.4` 可见静态 Banner 到品牌化动效 Banner 的用户可见变化。本分支将 `package.json` 与锁文件升级为只高一个预发布版本的 `0.4.0-beta.5`，并在 Changelog 顶部新增 beta.5 条目描述最终用户看到的视觉与文案升级。

普通回归测试和内部模块拆分不单独写入 Changelog。现有未提交的 `website` 子模块指针变化不属于本次工作，保持不动。

## 非目标

- 不在其他命令启动时重复播放动画。
- 不引入终端动画第三方依赖。
- 不修改 favicon、README 图片或 website 主题。
- 不为不同语言维护不同品牌标语。
- 不改变 `comet init` 的安装语义、提示顺序或 JSON 输出协议。
