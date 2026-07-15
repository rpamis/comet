# Native 命令参考

优先使用已安装的 `comet native`。若宿主环境只提供 Skill 文件，使用本 Skill 的自带 runtime：

```text
node <comet-native-skill-root>/scripts/comet-native-runtime.mjs <command> [options]
```

两种入口的参数、stdout、stderr 和退出码相同。普通发现从当前目录向上寻找 `comet.config.yaml` 或仓库根；生成式 launcher 可附加隐藏参数 `--project-root <path>`。

## 项目与根目录

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>
```

`artifact-root` 必须是项目内相对路径。`.` 生成 `<project>/comet/`，`docs` 生成 `<project>/docs/comet/`。已有配置拒绝冲突的 `--root`；改变根目录必须使用 `root move`，不能直接改配置。

## Change 管理

```text
comet native new <change-name> [--language en|zh-CN]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
comet native list
comet native show <change-name>
comet native status [<change-name>]
comet native select <change-name>
```

`new` 在配置缺失时创建默认配置和 `<project>/comet/`。完整目标规格写入 `specs/<capability>/spec.md`；`next` 自动推断 create/replace 并冻结 canonical hash。删除 capability 使用 `spec remove`，不要手工编辑 `spec_changes`。canonical 并发变化导致冲突时，先重读并改写完整目标规格，再用 `spec rebase` 刷新 operation/hash、回到 Build 并清除旧验证结论。`show` 返回状态、brief 和拟议完整规格；`status` 返回当前阶段、验证结果、下一条 Native 命令和归档就绪度。`select` 只写 Native 自有 selection。

## 阶段推进

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--result pass|fail] \
  [--report <change-relative-path>]

comet native archive <change-name>
```

- Shape：brief 和拟议规格通过后推进；只有本轮包含用户刚确认的高影响决定时才传 `--confirmed`。
- Build：重新检查 brief 和拟议规格；至少给出一个真实项目产物，或使用 `--no-code-reason`。若本轮包含实现中用户刚确认的高影响决定，也传 `--confirmed`。
- Verify：必须提供 `--result` 和完整 `--report`；fail 回到 Build，pass 进入 Archive。
- Archive：只能由 `archive` 命令完成，不能用 `next` 代替。

## 诊断与恢复

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair --strategy continue|rollback
```

只读 doctor 不改文件。`--repair` 只处理可证明安全的 selection、陈旧锁、普通阶段 transition 和确定性事务恢复；用户编写的 YAML、Markdown 与规格不会被自动重写。普通 transition 只支持 `continue`，不支持 `rollback`。

## 输出与退出码

所有命令支持 `--json`。JSON 模式只输出一个对象，包含 `command`、`exitCode`、`data`，失败时还包含结构化 `error`。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或产物无效 |
| `73` | 锁、事务、并发 hash 或根目录冲突 |
| `70` | 未预期的内部失败 |
