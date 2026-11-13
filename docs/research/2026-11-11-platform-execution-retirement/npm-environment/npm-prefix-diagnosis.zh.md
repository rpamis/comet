# Codex 插件 CLI npm prefix 真实诊断

结论：这是ensureCodexPluginCli在Windows对显式env覆盖处理的真实缺陷，触发边界是npm exec/npx注入的大写环境变量。不是resolveNpmCommand丢失options.env，也不是只清测试env中的大小写变体便能解决。父Agent已在现有函数内最薄修复环境合并，无新框架/helper。当前source与HEAD除env合并段外逐字一致。

## 只读诊断

未先执行任何安装。npm-prefix-readonly.test.ts实际调用同一个 resolveNpmCommand 和实际npm JS入口，只读取 root --global、config get prefix，并用Node子进程查看仅prefix相关环境键。只保存allowlist的npm路径/命令信息，不转储完整env或凭据。

三种启动边界：direct Node无npm prefix注入；pnpm exec有user_agent/command但本机没有prefix注入，均落Temp。npm exec --offline --no（真实npx边界）注入NPM_CONFIG_PREFIX=D:\nodejs、GLOBAL_PREFIX、USERCONFIG等。

真实npx的四模式结果（readonly-npm-exec.json）：

|模式|实际npm root --global|实际子进程prefix|
|---|---|---|
|只用已清case的options.env|Temp prefix/node_modules|lowercase npm_config_prefix=Temp|
|旧ensure再次spread process.env和options.env|D:\nodejs\node_modules|uppercase NPM_CONFIG_PREFIX=D:\nodejs|
|最终merged去case重复|Temp prefix/node_modules|lowercase npm_config_prefix=Temp|
|模拟继承uppercase其他Temp后spread|其他Temp/node_modules|uppercase继承值|

options.env中删除uppercase不够，因为函数又从process.env把uppercase带回。Windows实际child只保留了该uppercase别名，lowercase显式覆盖未进入子进程。resolveNpmCommand实际启动 D:\nodejs\node.exe + D:\nodejs\node_modules\npm\bin\npm-cli.js +原参数，launch没有另置env；installer本来正确传launch.env??env。不同启动边界不可混用推断。

## 安全 RED→GREEN

HEAD原文件完整保存 source-before-head.ts.txt，可执行Temp副本仅把相对import指到当前原依赖。真实当前source保存 source-after-current.ts.txt，GREEN直接import仓库真实模块。

三原it正文与所有断言逐字相同。Temp额外beforeEach只隔离APPDATA/LOCALAPPDATA、npm userconfig/globalconfig/cache，并建立空npmrc；诊断observer调用真实npm root，必须等于该fixture精确Temp prefix/node_modules，才返回真实resolveNpmCommand launch给产品调用。observer不改命令、不返回假结果；任何逃逸目标在真正命令（尤其install）返回前拒绝。

- HEAD：0 passed/3 failed（1.26秒），均发现真实全局root后在第一只读保护拒绝。npm install调用0，不读取/执行真实全局Comet entry，也没有真实global安装。
- 当前source：3 passed/0 failed（3.30秒），实际npm install仅1次，所有调用的root都精确等于各fixture Temp。两个并发启动结果installed+ready，postinstall计数一次且后续复用；摘要不匹配拒绝且sentinel/counter保护不变；Temp已装9.0.0保持ready不降级，均为原业务断言。

结果与逐次root观测：guarded-install-head-red-results.json/log、guarded-install-current-green-results.json/log、npm-install-observations-red-head.json、npm-install-observations-green-current.json。npm-prefix-red-green-summary.json包含原3body完全相同、source仅env段差异、install次数和所有Temp路径确认。

最初复制source时父修复已先落地，误名guarded-install-red-results.json实际是fixed3GREEN；已明确另存guarded-install-initial-fixed-green-*，不将其冒充RED。独立HEAD真RED见上述带head-red文件。

## 最薄修复与回归建议

父实现为继承process.env后逐options.env项覆盖；Windows先删除已有case等价键再赋当前键；最后设置COMET_NO_HINTS。调用者显式覆盖因而保留优先级。无需改npm参数、恢复shell或新增环境框架。

原3source测试通过原npx/npm exec边界运行，已能覆盖这次实际问题；不弱化、不skip。原测试中仅清case的5行猜测应撤下。由于npx还注入显式USERCONFIG/GLOBALCONFIG，HOME临时化不能改变这些路径；建议fixture额外把npm_config_userconfig/globalconfig/cache指Temp（前两为空文件），APPDATA/LOCALAPPDATA也Temp，避免读真实npmrc或写真实缓存。repository-ready/test/platform/codex-plugin-cli.test.ts仅包含该beforeEach隔离补充，三个it正文不变。诊断guard/mock只留Temp，不建议把整套observer变成产品框架。

## 边界

安装的是本地无依赖的假@rpamis/comet tarball，只在已核对的Temp npm prefix下；没有安装真实发布包、没有写真实global、没有构建/安装平台Hook、没有Eval/模型。外层npm exec --offline --no仅使用已存在vitest，不授权下载缺失工具。内层安装是原产品函数的真实npm local-tar命令，不能将此证明扩大成发布包或真实Codex插件启动验证。

本Agent未改仓库源码/测试。父根两批637/4与25/3原失败报告供定位；本报告3GREEN是带安全前置观察的同原测试body在当前真实source边界，不声称平台/scripts全部通过。安装环境缺陷不改变本轮业务工作流批准、任务、Archive合同。
