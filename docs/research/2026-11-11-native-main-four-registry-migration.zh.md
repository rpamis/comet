# Archive-ready 一次性检查业务登记追加

授权来源：report:2026-11-10-agent-platform-execution。用户要求普通工作流撤下受管检查、进程监管和专用快照，保留批准、任务验收及归档业务。

仅迁移 manual-recovery-native-archive-check-history 的当前有效测试名；原ID、来源、behavior、reproduction、expected、forbidden、rootCause及原tests不变，已有迁移链只追加supersededBy。当前读取基线该ID尚无testMigration，故添加第一段。

旧 managed Runtime check 自动复用机制退休；新case真实运行Node one-shot一次并保留log，先完整验收和批准进入Archive-ready，再编辑代码，错误修订hash拒绝，原批准显式revise回Build，Agent判断原报告仍适用形成新candidate，仍要求完整新Verifier及新批准才归档；一次性命令不重放、旧报告/log/批准保持。不是恢复自动fingerprint或check receipt机制。

逐原文及断言见 docs/research/2026-11-11-platform-execution-retirement/main-four-business/four-declaration-business-map.json；四项普通Temp原型4GREEN/0失败，30.16秒。当前正式根验证另记，不把未执行层级写成通过。未运行Eval、模型、真实平台Hook或新发布安装包。

附四证据文件 registry/tests/mapping/tests.patch，均保留完整旧登记与旧测试文件正文。此追加仅由父Agent按beforeCase深比较CAS应用，不覆盖其他case。
