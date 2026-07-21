# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-134dd14adf0d73e111e3ea7d1a5df878acad997c2af708b90ff86af6547fc9a7",
    "evidence_refs": [
      "domains/comet-classic/classic-project-config.ts",
      "test/domains/comet-classic/classic-project-config.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-4b09059f600af2a45aa9f72fdec6291e6926eb4d43a2a31af1ccd3da91d71a43",
    "evidence_refs": [
      "app/commands/init.ts",
      "test/app/init-e2e.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-52c0ff472c399de3fd8ceb2e63dae6d3b7edcac2d655a7d6fb64b4a855e1a10f",
    "evidence_refs": [
      "domains/comet-entry/init-workflow.ts",
      "test/app/resume-probe.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-97ae3932ec2afce91d07e866335cb07fd1e9623dfd11e30385c63aa2025f1503",
    "evidence_refs": [
      "domains/comet-native/native-cli.ts",
      "test/domains/comet-native/native-cli.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-99ce6f42e9562a3a9106d77aff12b7145ef9cfb98d752d9f5321dc5714d4b231",
    "evidence_refs": [
      "domains/comet-entry/init-workflow.ts",
      "test/domains/comet-entry/init-workflow.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-acf5cb881b9f3cd04f61cc0860e02d7734aece817a86ca0ad0e7575f0cb722c0",
    "evidence_refs": [
      "app/commands/init.ts",
      "test/app/init-e2e.test.ts"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- `pnpm check:generated`：通过，Classic、Native 与 Entry 生成物均为最新。
- `pnpm format:check`：通过，全部受检文件符合 Prettier。
- `pnpm lint`：通过，ESLint 与 architecture lint 均无错误。
- `pnpm build`：通过，TypeScript、三个 runtime 与 Dashboard 均成功构建。
- `npx vitest run test/domains/comet-entry/init-workflow.test.ts test/domains/comet-native/native-config.test.ts test/domains/comet-native/native-cli.test.ts test/app/init-e2e.test.ts test/app/resume-probe.test.ts`：5 个文件、114 项通过。
- `npx vitest run test/repository/native-runtime-assets.test.ts`：1 个文件、4 项通过。
- `npx vitest run test/domains/comet-classic/classic-project-config.test.ts`：1 个文件、4 项通过。
- `pnpm test`：完整执行两次；两次均为 202 个文件中 201 个通过、2543 项中 2517 项通过且 25 项按既有声明跳过。第一次仅 `native-lock-concurrency` 的高负载进程竞态失败，单独重跑 4/4 通过；第二次仅 `native-phase1-matrix` 的事务恢复用例耗时 30.199 秒越过 30 秒上限，单独重跑 5/5 通过。

# Skipped checks

没有跳过本次变更要求的检查。全量套件中的 25 个 skip 为仓库既有测试声明，不是本轮主动省略。

# Spec consistency

实现与 brief/目标规格一致：全新 Native 默认使用 `docs/comet/`，显式或既有自定义根保持权威；初始化摘要按 Native、Classic 或 Both 展示实际工作目录；Classic 缺失 `review_mode` 时继续解析为 `standard`。

# Known limitations and risks

Windows 高负载全量运行仍存在两个既有时序型测试偶发失败：锁进程竞态和事务恢复 30 秒上限。两项均与本次工作区默认值改动无代码交集，且各自隔离重跑通过；未为掩盖该波动而扩大修改范围。

# Conclusion

本次变更的全部验收项、直接回归、生成物、格式、lint、架构检查与构建均通过，可以归档并提交。
