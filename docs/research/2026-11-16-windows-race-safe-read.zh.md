# Windows 同一时钟刻度的文件读取竞态

来源：[PR #562 Windows badcase 分片](https://github.com/rpamis/comet/actions/runs/43808488560/job/133105317401)。比较提交：`cd8e8622e2883461bf96e40b2a1114e5a7437779`。

## 实际结果

远端原案例 `rejects same-inode writes with restored mtime during the hash window` 返回结果，未按原断言拒绝。本地原样两项定向测试通过，单次通过不能排除时钟刻度问题。

将当前 `platform/fs/race-safe-read.ts` 用 esbuild 打包到临时目录，通过公开函数在本机 Windows 对 read/hash 各重复 1,500 次。每次在 beforeFinalCheck 中把 five-byte `first` 覆写为同长度 `later`，恢复 2020-01-01 的 mtime。read 有 41 次、hash 有 42 次没有拒绝。首次 read 漏检的 ctimeNs 写前写后均为 1794806856808183700；首次 hash 漏检均为 1794806859924231700。两者 inode 和 mtime 也相同，实际文件内容已变。

当前实现比较 inode/创建身份、大小、模式、mtime 和 ctime。一次系统时钟刻度内等长改写并恢复 mtime，元数据可能完全相同，因此再多一次 stat 也无法发现已经发生的内容变化。这里没有修改测试时序、跳过或降低历史断言。

## 已确认的修复范围

为保留历史“同 inode 改写并恢复 mtime 也要拒绝”的断言，建议 Windows 在同一描述符完成初读后，再流式核对一次实际内容。普通有界读取比较已保留的字节；hash 入口使用原有算法再计算一次摘要。最终仍核对文件身份和元数据，不扩大内存上限或引入新算法。代价为 Windows 正常读取约增加一遍文件 I/O，hash 入口也多一遍原有摘要计算。

根 AGENTS.md 要求对此类边界处理及 hash 使用先取得用户确认。用户已明确选择“允许修复并保留完整断言”，授权上述 Windows 复读及已有摘要算法复算。

## 验证边界

现有历史 case `platform-same-inode-content-read-race` 的来源、两个选择器和 real-model-eval pending 记录保留。现有独立读取代码及 CI 原失败是确定性/运行时证据，不替代模型 Eval。未启动真实模型 Eval。

## 修复与执行证据

普通读取复用原有块缓冲，按显式文件位置比较第一次保存的字节，核对长度和 EOF；hash 入口通过同一描述符以原算法进行两次流式读取。复读后仍执行原有的路径、文件身份与元数据检查，非 Windows 保留单次内容读取。未新增项目配置、大小限制、临时文件或公开接口。

新增两个确定性案例只把 lstat/fstat 报告的 ctime 固定为同一时钟刻度，磁盘内容仍实际等长覆写并恢复 mtime；旧实现两项均失败，新实现两项均通过。原历史测试名称、选择器与断言不变，并增加空文件、跨 64 KiB 分块和已有摘要算法选项的合法读取反例。完整测试文件在 Windows 为 15 passed / 4 原有平台 skips。

原来各 1,500 次的实际 Windows 读/hash 复现，在重新构建修复模块后均为 0 次漏检。没有把单次原测试通过当作排除时钟刻度问题的证据。Node FileHandle.read 的显式 position 语义见 [Node 官方文档](https://nodejs.org/api/fs.html#filehandlereadbuffer-offset-length-position)。

复用原 case，追加本次 CI 来源和两个精确选择器；real-model-eval pending 原样保留。本轮完成的是文件原语的确定性修复，不能宣称历史模型边界已验收。对应公开 Runtime bundle 和完整 CI 结果继续在 PR #562 核对。

本轮补充验证：相关五个文件 49 passed / 9 原有平台 skips；公开 Native v4 CLI、读取预算与 Entry 生成资产三份测试 84 passed / 4 原有平台 skips；登记原案例执行 4 项断言全部通过。完整构建、lint/架构、TypeScript、生成资产检查、受影响文件 Prettier 和 Mintlify build/validation 通过。本地未运行全量测试；最新候选仍须等待远端完整 CI。
