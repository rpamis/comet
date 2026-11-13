# Windows broker不是dead模块

应保留，不提供删除patch。早先responsibility报告第48行只查app/domains/platform/scripts，漏了发布bin入口；第109行据此称可删也需更正。

真实生产链：package.json:59-60的comet指向bin/comet.js，package files包括bin；bin/comet.js在shouldTryCometDaemon为真时加载router。bin/comet-daemon-route.js的COMET_DAEMON默认非off，Native status/show/root和Classic state current/next（无COMET_TASK/--summary）可走daemon路由；显式daemon命令也进入router。bin/comet-daemon-router.js:44在Windows动态import生成后的broker，startDaemon:175附近实际调用launchWindowsProcessWithBroker，为Comet自身后台daemon完成隐藏PowerShell/WMI启动。不能因不在app/domains/platform静态import集合就删除。

该能力不是Native/Classic普通检查Runner：此处只启动自有daemon server。删除将损坏Windows daemon启动/复用并改变CLI回退和显式daemon行为。没有运行真实broker或PowerShell/WMI；这是当前发布入口源码的可达性证明。

broker单元文件7声明均为该仍存活模块的启动/时限/worker缓存行为，不能因纯机制就退休；app daemon文件24声明含真实混合启动预算、回退、重入、冷却、锁替换/错误边界，其broker mock确实被Win分支使用。完整原文/标题/位置在reviewed-source-and-tests.json。registry当前有效末端和历史链关联均0/0（见registry-links.json），没有登记要迁，不代表无生产消费者。

没有扩展到Eval真实process identity、owned command或项目配置事务PID；没有源码、测试或registry写入，没有新执行验证。应仅更正错误调查结论并继续保留模块与测试。
