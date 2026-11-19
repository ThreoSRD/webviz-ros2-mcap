# ROS 2 MCAP 稳定性验证

基线记录日期：2026-11-10。仍为本地原型，未发布。

## 2026-11-19：3D MarkerArray 传输

ROS 2 的 MarkerArray 已在读取阶段解码为 JavaScript 对象。3D 面板现在仅在向布局 worker 发送数据时，使用已有的二进制 bobject 格式重新编码受支持的数组，减少跨线程复制大型对象树的开销。原始缓存消息不变，Marker 的增量更新、删除和生命周期仍由场景构建器处理；其他面板继续使用原始表示。

此优化只处理由 ROS 2 适配器直接解码的 `visualization_msgs/MarkerArray`。包含 64 位整数、部分数值型数组或不支持字段的 schema、非 ROS 2 消息以及编码失败的消息都保留原有传输方式，避免改变数值或消息语义。单条 Marker、PointCloud2 和主线程 CDR 解码暂未优化。

在加入时间字段的边界检查之前，本机一份真实录包的 2 秒窗口中，214 条雷达及规划 MarkerArray 的传输准备模拟耗时约从 752 ms 降至 119 ms，转换前后字段一致。最终版本使用合成数据进行相同类型的模拟：102 条消息约从 298 ms 降至 57 ms，字段一致。

早期版本另用 90 Hz 雷达 Marker、10 Hz 规划 Marker 的合成录包做了单次无头浏览器对照：8 秒窗口内主线程任务时间约从 3.13 秒降至 2.01 秒；帧间隔 p95 均约 167 ms。最终版本的生产页面同场景主线程任务约 1.86 秒，帧间隔 p95 约 167 ms；没有生产版本的优化前对照。浏览器使用 SwiftShader 软件渲染，这些数值不是硬件 GPU 帧率或通用性能承诺。

## 本轮修复

- 播放器在初始化尚未完成时被替换，初始化成功后会关闭底层来源；被放弃来源的初始化错误不会影响新来源。
- worker 初始化失败或关闭 RPC 失败时仍会终止 worker；主线程解析 ROS 2 schema 失败时也会关闭已启动的来源。
- ROS 2 读取完成前关闭来源时，丢弃晚到的数据或错误，避免使用已清空的 schema 解码。
- 3D 面板卸载时终止布局 worker，取消排队帧并释放播放等待。
- Plot 卸载时销毁 Hammer 手势管理器，解除 window 监听器；否则旧画布会保留面板、播放器和点云缓存。
- 关闭播放器时清空缓存进度和待发消息，忽略晚到的进度/读取结果；内存缓存关闭时清空数据块并结束待完成的读取。即使旧 UI 回调短暂保留已关闭播放器，也不会继续保留整份缓存。

- 消息管线在每次提交后处理帧等待，避免将包含缓存的整份播放状态保存在 effect 依赖中；覆盖原有的多帧等待和来源切换行为。

这些改动涉及 ROS 1 与 ROS 2 共用的播放器、缓存和图表，因此回归检查也覆盖原有来源。

## 复现方式

先在一个终端启动生产版本：

```sh
NODE_ENV=production npm run build
npm run serve-local
```

在另一个终端执行：

```sh
BROWSER_PATH=/usr/bin/google-chrome npm run stress:mcap -- /absolute/path/to/recording.mcap
```

原始本轮验证使用未压缩 MCAP；11 月 12 日后也支持带索引的 lz4/zstd MCAP，详见[压缩验证](ROS2_MCAP_COMPRESSION.md)。压力场景需包含相应 ROS 2 传感器话题：`sensor_msgs/Imu`、`sensor_msgs/CompressedImage`、`sensor_msgs/PointCloud2`。脚本选择每种类型的第一个话题。点云坐标系默认 `base_link`，可用 `MCAP_FRAME` 指定；测试地址可用 `WEBVIZ_SMOKE_URL` 指定。无需 ROS 安装或新增全局依赖。

默认检查流程：

1. 合成来源建立初始内存基线。
2. 真实录制同时打开 Raw Messages、Plot、Image、3D，进行 18 次跨时间窗口跳转，检查时间及 IMU 数据确实更新。
3. 播放中执行 4 轮真实 → 合成 → 真实文件切换，并重建面板。
4. 执行 6 轮初始化中切换来源；仅这一阶段人为延迟 worker 文件读取 150 ms，用于复现取消初始化，不参与性能计时。
5. 切回微型合成文件，检查 worker 数量和缓冲区释放。
6. 从真实录制起点后 0.5 秒播放至结尾或最多 60 秒，检查暂停，再切回合成来源复查释放。

报告、截图、合成数据和浏览器 profile 全部保存在本项目 `.cache/mcap-stress/`，不会复制真实录制或将其加入源码。可共享的基础浏览器测试仍是 `npm run smoke:mcap`，不需要私有数据。

## 本机结果

默认完整流程通过。真实文件大小 1,074,975,733 字节，84 话题，时间跨度 57.8066 秒。

- 18 次跨时间窗口跳转、4 轮播放中来源替换、6 轮初始化中来源替换通过。
- 连续播放 57.3066 秒数据，到达实际结尾；耗时约 57.58 秒（含暂停检查），暂停后时钟保持不动。
- 界面 error 级通知、未捕获异常及脚本监测的来源错误均为零；记录到 8 条话题/类型变更诊断警告，见文末。
- 18 次跳转的页面时间与 IMU 更新时延中位数 61 ms、p95 512 ms。这包含模拟键盘操作，只表示本次采样；没有检查每次跳转所有图形面板的最终绘制完成时间，也不是性能承诺。

| 阶段 | 主线程 JS heap | backing storage | 页面 worker 数 |
| --- | ---: | ---: | ---: |
| 初始合成数据 | 14.4 MiB | 10.4 MiB | 3（含预热） |
| 三轮跳转后 | 28.8 MiB | 130.4 MiB | 5 |
| 初始化中反复切换后，合成数据 | 21.9 MiB | 10.4 MiB | 2 |
| 连续回放结束 | 31.6 MiB | 130.4 MiB | 5 |
| 再次关闭真实来源 | 22.9 MiB | 10.4 MiB | 2 |

4 轮真实来源替换的 backing storage 为 49.2、54.0、54.6、52.3 MiB，没有逐轮累加；关闭后均无布局 worker。上述数值不等于浏览器总内存：采样中的 renderer RSS 从初始约 528 MiB 到最高约 863 MiB，最后约 595 MiB，GPU/浏览器主进程还另有开销。

## 回归检查

- 生产构建、完整 lint、Flow（0 errors）通过。
- 播放器、所有 data provider、RPC、bobject、图表和 3D 帧发送器：30 个 suite、329 项测试、3 个 snapshot 通过。
- 消息管线：23 项测试通过，覆盖多帧等待及替换播放器时的帧隔离。
- MCAP 基础 helper：6 项通过；独立合成浏览器 smoke 通过，包括精确 uint64、播放和跳转。

本地证据位于 `.cache/build-stability.log`、`lint.log`、`flow.log`、`stability-regression.log`、`pipeline-tests.log`、`helpers-final.log`、`smoke-final.log`、`stress-final.log` 和 `mcap-stress/report.json`。单元测试运行仍有旧工具链的监听器数提示，构建有可选 Blueprint 提示；没有为消除提示扩大依赖升级范围。

## 测量范围

- 测试环境为 Linux、Node 22.22.3、npm 10.9.8、Chrome 156；浏览器使用 SwiftShader，不能代表硬件 GPU 性能。
- 内存采样先主动 GC；`Runtime.getHeapUsage().backingStorageSize` 包含 ArrayBuffer 和外部字符串，不等于整个浏览器内存，也不是自然播放峰值。脚本另外记录按进程类型汇总的 RSS。
- 切回合成数据后，主线程 backing storage 应不超过初始基线加 32 MiB。这是本场景的回归阈值，不是所有录制的通用内存预算。首次加载图集、代码及浏览器分配器可能留下固定开销。
- worker 数量会包含预热 worker 和共享 worker。检查重点是来源/面板反复替换后不累加，且没有 3D 面板时布局 worker 为零。
- 堆分析最初受调试 DOM 句柄保留影响；脚本已释放上传句柄，使用页面内操作与布尔等待，并通过 React 树外的临时控件触发 document drop，减少自动化控件对旧 UI 的保留。最终结果以完整流程为准，不把调试器造成的保留算成应用修复效果。
- 这里只覆盖一个约 1 GiB、57.8 秒、84 话题的真实文件及四个代表性面板，不覆盖所有话题、长时间录制或多浏览器。真实文件没有 TF；未验证跨坐标系变换。

频繁切换来源仍可能触发旧版 Webviz 的 `Provider topics should not change often` / `Provider datatypes should not change often` 诊断警告。脚本记录这些界面通知，并将 error 级通知作为失败；没有屏蔽警告。后续可将元数据变化频率诊断按来源隔离。
