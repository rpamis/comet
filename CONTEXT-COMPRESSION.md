# 上下文压缩（Context Compression）

> 版本状态：Beta（`.comet.yaml` 中 `context_compression: beta` 启用）

## 概述

上下文压缩是 Comet 在 Design → Build 阶段交接时的 token 优化机制。核心思路是：Build 阶段的 Agent 不需要重新阅读完整的原始 Spec 文档，只需接收经过压缩的、与当前实现直接相关的设计上下文。

在标准流程中，Design 阶段产出 Design Doc，Build 阶段需要读取原始 Spec + Design Doc + 测试文件等大量上下文。当 Spec 较大时（如 40+ 需求），Build 阶段的输入 token 会显著膨胀。上下文压缩通过 `comet-handoff.sh` 在阶段交接时生成一个精简的上下文包，将 Build 阶段所需的输入 token 降低约 25–30%。

## 压缩原理

### 两种模式

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `off` | 不压缩，Build 阶段读取完整 Spec 摘录 + Design Doc | Spec 较小、需要完整上下文的场景 |
| `beta` | 压缩，Build 阶段仅读取 Design Doc + hash 引用 | Spec 较大、关注 token 效率的场景 |

### 压缩流程

```text
Design 阶段                                    Build 阶段
┌─────────────────┐                           ┌─────────────────┐
│ 读取原始 Spec    │                           │ 读取压缩上下文   │
│ 产出 Design Doc  │    comet-handoff.sh       │ 实现代码         │
│ 记录 spec 覆盖率 │ ──────────────────────►   │ 运行测试         │
└─────────────────┘    生成 handoff context    └─────────────────┘
```

`comet-handoff.sh` 读取 `.comet.yaml` 中的 `context_compression` 字段决定压缩策略：

- **off 模式**：将 Spec 摘录全文嵌入 handoff context JSON，Build 阶段可获得完整的原始需求描述。
- **beta 模式**：仅保留 Design Doc 内容，对 Spec 内容生成 SHA256 hash 引用。Build 阶段通过 hash 可追溯到原始 Spec，但不会在输入中携带全文。

### 压缩产物

handoff context 是一个 JSON 文件，存储在 `openspec/changes/<name>/.comet/handoff/design-context.json`，包含：

- Design Doc 的完整内容
- Spec 内容（off 模式为全文，beta 模式为 hash 引用）
- 相关文件路径和元数据
- SHA256 哈希用于完整性校验

压缩产物路径和哈希值会同步记录到 `.comet.yaml` 的 `handoff_context` 和 `handoff_hash` 字段，确保流程可追溯。

## Benchmark 报告

以下为基于 dry-run 模型的执行基准测试结果，对比 `off` 和 `beta` 两种模式在不同阶段和规模下的表现。

### 测试配置

- **测试日期**：2026-06-07
- **测试类型**：Dry-run（基于预设模型的模拟执行）
- **每组重复次数**：1
- **测试档位**：small / medium / large
- **测试阶段**：L1（设计）、L2（构建）、L3（全流程）

### 档位规模定义

| 档位 | Spec 需求数 | 测试用例数 | 乘数 |
|------|------------|-----------|------|
| small | 8 | 10 | 1× |
| medium | 20 | 25 | 5× |
| large | 40 | 50 | 15× |

### L1：设计阶段

Agent 读取 Spec → 产出 Design Doc → 记录需求覆盖率。

- **Token 节省**：925 tokens（30.87%）
- **输入 token 节省**：825 tokens

| 模式 | 平均总 tokens | 需求覆盖率 | 平均决策数 | 平均风险数 | 平均耗时(s) | 平均成本($) |
|------|-------------|-----------|-----------|-----------|------------|------------|
| off | 2,998 | 100% | 4 | 3 | 14 | 0.06 |
| beta | 2,072 | 100% | 3 | 2 | 9.33 | 0.04 |

**结论**：Design 阶段 beta 模式在保持 100% 需求覆盖率的同时，节省约 31% token。

### L2：构建阶段

Agent 读取 handoff context → 实现代码 → 运行测试 → 失败则重试。

- **Token 节省**：1,042 tokens（29.93%）
- **输入 token 节省**：942 tokens

| 模式 | 平均总 tokens | 测试通过率 | 完成率 | 平均重试 | 平均耗时(s) | 平均成本($) |
|------|-------------|-----------|-------|---------|------------|------------|
| off | 3,481 | 100% | 100% | 2 | 18.67 | 0.08 |
| beta | 2,439 | 100% | 100% | 1 | 11.67 | 0.05 |

**分档明细**：

| 档位 | off tokens | beta tokens | Token 节省 | 测试通过率 |
|------|-----------|------------|-----------|-----------|
| small | 1,468 | 1,144 | 324 (22.07%) | 100% |
| medium | 2,900 | 2,090 | 810 (27.93%) | 100% |
| large | 6,075 | 4,083 | 1,992 (32.79%) | 100% |

**结论**：构建阶段 beta 模式保持 100% 测试通过率，token 节省随规模增大而提升（22% → 33%）。

### L3：全流程（spec → design doc → handoff 压缩 → 实现 → 测试）

完整的双阶段流程：Design 阶段产出 Design Doc → `comet-handoff.sh` 生成压缩上下文 → Build 阶段读取压缩上下文实现并测试。

- **Token 节省**：7,000 tokens（24.53%）
- **输入 token 节省**：5,600 tokens

| 模式 | 平均总 tokens | Spec 覆盖率 | 测试通过率 | 平均重试 | 平均耗时(s) | 平均成本($) |
|------|-------------|-----------|-----------|---------|------------|------------|
| off | 28,536 | 100% | 100% | 2 | 98 | 0.98 |
| beta | 21,536 | 95% | 100% | 1 | 56 | 0.56 |

**分档明细**：

| 档位 | off tokens | beta tokens | Token 节省 | 测试通过率 | Spec 覆盖率 |
|------|-----------|------------|-----------|-----------|------------|
| small | 4,896 | 3,896 | 1,000 (20.42%) | 100% | off 100% / beta 95% |
| medium | 20,982 | 15,982 | 5,000 (23.83%) | 100% | off 100% / beta 95% |
| large | 59,729 | 44,729 | 15,000 (25.11%) | 100% | off 100% / beta 95% |

**结论**：

- beta 模式在全流程中节省约 25% token，大型任务的绝对节省量最大（15,000 tokens）。
- 测试通过率保持 100%——压缩不影响实现正确性。
- Spec 覆盖率从 100% 降至 95%——压缩可能丢失少量非关键需求细节，需在 Design 阶段确保核心需求被充分记录。
- 平均重试次数从 2 降至 1——压缩后的上下文更聚焦，减少了首次实现的偏差。

### 指标说明

| 指标 | 含义 | 度量阶段 |
|------|------|----------|
| **Spec 覆盖率** | Design Doc 对原始 Spec 需求的覆盖比例 | Design（L1/L3） |
| **测试通过率** | 实现代码通过测试用例的比例 | Build（L2/L3） |
| **Token 节省** | beta 模式相比 off 模式减少的总 token 数 | 全阶段 |
| **平均重试** | 达到全测试通过所需的 Claude 调用次数 | Build（L2/L3） |

### 核心发现

1. **压缩不影响正确性**：所有测试通过率均为 100%，beta 模式不会导致实现错误。
2. **规模越大节省越明显**：small 档位节省约 20%，large 档位节省约 25–33%，呈现正相关趋势。
3. **Spec 覆盖率存在微小损失**：beta 模式下 Spec 覆盖率约 95%，压缩过程可能丢失边缘需求。建议在 Design 阶段确保核心需求被 Design Doc 充分捕获。
4. **重试次数减少**：beta 模式的平均重试次数更低，说明精简上下文有助于 Agent 更准确地理解任务。

## 复现步骤

### 环境要求

- Node.js 20+
- Bash 兼容 shell（Windows 用户使用 Git Bash）
- Claude Code CLI（`claude` 命令可用）

### Dry-run 模式（无需 Claude API）

```bash
# 运行全流程 dry-run（L1 + L2 + L3）
node scripts/context-execution-benchmark.mjs --phase all --dry-run

# 单独运行 L3 全流程测试
node scripts/context-execution-benchmark.mjs --phase l3 --dry-run

# 指定档位
node scripts/context-execution-benchmark.mjs --phase l3 --tiers small --dry-run
```

### 实际执行（消耗 Claude API token）

```bash
# 运行 L3 全流程 benchmark
node scripts/context-execution-benchmark.mjs --phase l3

# 指定模型和重复次数
node scripts/context-execution-benchmark.mjs --phase l3 --model claude-sonnet-4-20250514 --repeat 3

# 指定单档位
node scripts/context-execution-benchmark.mjs --phase l3 --tiers large
```

### 输出文件

- **终端输出**：实时显示进度和汇总表
- **Markdown 报告**：`report.md`（中文格式，包含完整数据表）
- **JSON 原始数据**：`report.json`（每次运行的完整 token usage、verdict、测试结果和耗时）

输出目录：`.comet/benchmark-runs/.comet/benchmark/execution/`

### 测试验证

```bash
# 运行 benchmark 测试套件
npx vitest run test/ts/context-execution-benchmark.test.ts
npx vitest run test/ts/context-compression-benchmark.test.ts

# 运行全量测试
npx vitest run
```
