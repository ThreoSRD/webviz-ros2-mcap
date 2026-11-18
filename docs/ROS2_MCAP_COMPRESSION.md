# ROS 2 MCAP 压缩读取验证

更新日期：2026-11-12。状态：本地原型已支持带索引、`ros2msg` / `cdr` 的未压缩、lz4、zstd，以及同一文件中的混合压缩块。

## 实现与修复

- 先读取索引及 schema，再按文件实际使用的格式加载 WASM 解码器。解压在数据 worker 内完成，原始 CDR 继续走已有 worker RPC 和面板适配路径；未压缩 MCAP 不请求新增的 MCAP 解码器 WASM 资源。
- SDK 解压接口同步执行，因此先等待 WASM 初始化完成，再将 provider 暴露给播放器。初始化过程中关闭来源，不会重新打开旧来源。异步加载失败会清除该 worker 内的失败 promise，错误消息指出具体解码器。
- 检查解压输出长度，保留 SDK 默认的解压后 chunk CRC 校验。未知压缩格式在初始化时拒绝；压缩 chunk 的声明解压长度上限为 **256 MiB/块**，不是整个文件的大小上限。超过限制需重新分块。
- 为异步 worker chunk 设置 `globalObject: "self"`，解决旧 webpack 在 worker 中生成 `window` 引用的问题。
- 修复缓存层读取异常只通知、不结束待完成读取的问题。前台读取拒绝会传递给播放器；后台预读失败会停止继续预读并报告错误，后续读取也会收到原错误。关闭来源后到达的旧连接错误不会影响新来源。
- 修复播放器跳转回填读取未捕获错误的问题。损坏数据会进入明确的失败状态，停止初始化/播放 spinner；再次打开正常文件可恢复。

生产解码器使用 `@foxglove/wasm-lz4` 1.0.2 和 `@foxglove/wasm-zstd` 1.0.1，均为 MIT 许可证；资源由本项目构建输出提供。独立测试编码器使用 `lz4js` 0.2.0（ISC）及 Node 原生 `zstdCompressSync`，避免只用同一库完成编码/解码自测。Jest 的动态 import 转换使用固定版本的 Babel 插件，仅在 test 环境启用。依赖、锁文件、下载缓存和浏览器 profile 均在本项目内。

接口依据：[MCAP 解压接口及官方实现](https://github.com/foxglove/mcap/blob/main/typescript/support/src/decompressHandlers.ts)、[WASM zstd](https://github.com/foxglove/wasm-zstd)、[WASM lz4](https://github.com/foxglove/wasm-lz4)。ROS 1 的旧 LZ4 实现保持原有路径。

## 验证证据

| 边界 | 结果与证据 |
| --- | --- |
| 索引 → 解压 → CDR | 单元测试覆盖未压缩/lz4/zstd/混合文件、话题过滤、端点纳秒精度、嵌套定义和精确 uint64 |
| 损坏及完整性 | 损坏压缩帧、解压长度不符、CRC 不符、块大小边界、未知格式、解码器初始化中关闭均有回归 |
| worker → Raw Messages / Plot | 4 种模式的浏览器 smoke 均通过，包含播放、跳转与 uint64 显示 |
| worker → TF / Marker | 混合压缩场景的 9 项像素/错误提示检查通过 |
| 故障 → 错误界面 → 恢复 | 两种损坏压缩文件均退出 active player 状态；随后正常文件显示正确计数 |
| WASM 资源加载 | 未压缩来源没有下载新增 MCAP codec WASM；模拟 zstd WASM 404 后显示具体解码器错误，恢复资源后再次打开成功 |
| 构建与静态检查 | 生产构建、完整 lint、Flow（0 errors）通过 |
| 共享组件回归 | 18 个 suite、184 项通过，包含全部 data provider、播放器和 bobject RPC |

WASM 404 是通过本机临时 HTTP 代理注入的真实失败响应。该阶段记录到预期的 WASM worker abort；其余故障/恢复阶段没有未捕获浏览器异常。界面中的非根 TF 和元数据频繁变化诊断警告仍会记录，没有被隐藏。

LZ4 库在损坏帧后保留原生解码状态，因此错误来源应结束其 worker。本项目来源关闭/失败会终止 worker；浏览器已验证打开下一份正常录制会创建可用的解码上下文。终止性损坏测试在共享 Jest VM 的最后执行，不能把它等同于长期复用同一个损坏解码器的支持保证。

## 真实录制窗口

对既有约 1 GiB 未压缩录制只读提取起始 **3 秒窗口**，在 `.cache/compression/` 生成两份压缩测试副本；没有修改原文件，也没有把录制加入源码。

| 格式 | 测试副本字节数 | 消息数 | chunk 数 |
| --- | ---: | ---: | ---: |
| lz4 | 15,269,399 | 8,863 | 57 |
| zstd | 11,197,702 | 8,863 | 57 |

两份副本解压后，对每条消息的话题、log/publish 时间、sequence 和原始 payload 计算的 SHA-256，均与原窗口一致：`a5d1167ed9faafb9d8b3a9ba575c81e46d1917c2e8f71f9ccb045cf4fda5d0e5`。这些输出文件大小只描述该短窗口，不能用来推算整个原文件的压缩率。

两种格式分别通过 Image、Raw Messages、PointCloud2、Plot 四面板验证：6 次压力跳转，加播放前定位；4 轮播放中来源替换；6 轮初始化中替换；播放及暂停。lz4 播放从窗口起点后 0.5 秒至结尾，zstd 在窗口中播放 2 秒后暂停。没有据此宣称已验证完整长录制的压缩播放或性能。

关闭真实来源后，主线程 `backingStorageSize` 约为 10.4 MiB，与合成数据基线相同；可见 3D 面板的布局 worker 从 1 个变为 0，页面 worker 总数从 5 个变为 2。该指标包含 ArrayBuffer/外部字符串，不等于整个浏览器内存。暂停采样允许正在绘制的一帧完成后再检查时钟稳定。

## 复现命令

使用已验证的 Node 22.22.3；生成 zstd 测试数据需要 Node >=22.15 的 `zstdCompressSync`。浏览器应用本身不调用 Node 压缩 API，也不需要 ROS 安装。

```sh
npm run bootstrap
NODE_ENV=production npm run build
npm run serve-local
```

另开终端：

```sh
npm run test:mcap
BROWSER_PATH=/usr/bin/google-chrome npm run smoke:mcap:compression
```

完整浏览器命令依次运行 4 种 Raw/Plot smoke、混合压缩 TF/Marker 场景，以及 7 项资源/故障/恢复检查。也可单独执行：

```sh
MCAP_COMPRESSION=zstd npm run smoke:mcap
MCAP_COMPRESSION=mixed npm run smoke:mcap:scene
```

`WEBVIZ_SMOKE_URL` 可覆盖默认地址。基础检查输出到 `.cache/mcap-smoke/<codec>/`，场景检查输出到 `.cache/mcap-scene/mixed/`，故障检查输出到 `.cache/mcap-compression/report.json`。默认未压缩检查保留原路径。

本次日志位于 `.cache/compression/`：`tests.log`、`cache-tests.log`、`player-tests.log`、`regression.log`、`build-final.log`、`lint.log`、`flow.log`、`browser-final.log`、`browser-failures.log`、`real-clips.json`、`real-browser-lz4.log`、`real-browser-zstd.log`。完整正常流程及故障检查因修复分阶段执行，最后的故障报告为 passed；真实窗口的报告与截图分别在 `.cache/mcap-stress/lz4/`、`.cache/mcap-stress/zstd/`。

## 仍有限制

- 只支持 MCAP chunk 层的 lz4/zstd；不支持将整个文件外包为 `.mcap.zstd` / `.mcap.lz4` 的另一层压缩。
- 不支持其他压缩名、外部字典、`ros2idl`、无索引恢复、`.db3`、分包、HTTP 录制来源或实时 ROS 2 连接。
- 新目录干净安装与完整压缩回归已通过，见[安装验证](ROS2_MCAP_INSTALLATION.md)。独立 ROS 解码器比对、长时间压缩录制与多浏览器回归仍待进行。现有 TF 时间选择和 Marker 历史恢复限制见场景报告。
