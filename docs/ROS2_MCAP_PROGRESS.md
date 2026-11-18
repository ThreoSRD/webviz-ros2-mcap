# ROS 2 MCAP 实施进度

更新日期：2026-11-12。

**状态：已有可在本地试用的原型。已完成安装、生产构建、lint、Flow，以及合成 MCAP、真实录制代表性验证、单文件稳定性检查、合成 TF/Marker 场景回归和 lz4/zstd 压缩读取验证；尚未发布。**

## 已完成的接入

- 按文件头区分 ROS 1 bag / MCAP；MCAP 使用独立分支，防止 CDR 数据进入 ROS 1 转换器。
- 使用 `@mcap/core` 索引读取器和 Blob 分段读取；通过 chunk 索引确定时间范围。
- 在现有 worker 中读取原始 CDR 数据；仅复制并传输单条 payload，避免转移或长期保留整个 chunk。
- 使用 Foxglove 的 ROS 2 定义解析器和 CDR 解码器，按 schema 名称与内容缓存读取器。
- 统一解析后 AST 中的 `pkg/msg/Type`、`pkg/Type` 与相对类型引用；不改写字符串默认值，保留原始 schema 元数据。真实文件中的混合命名情况已有合成回归用例。
- 将 ROS 2 类型和 Time/Duration 适配为现有面板接口，保留 typed arrays 和 64 位整数精度。
- 包装为 bobject，并向缓存提供包含底层缓冲区的内存估算。
- 支持未压缩、lz4、zstd 和混合压缩块；解码器在 worker 中按需加载，单块声明解压长度上限 256 MiB。拒绝其他压缩、暂不支持的编码、缺失索引及多 MCAP/混合来源，详见[压缩验证](ROS2_MCAP_COMPRESSION.md)。
- 补齐旧 PointCloud2 读取器缺失的 INT8、UINT32、FLOAT64 类型。保留现有小端数值解析方式；大端点云仍需专门验证。
- 已通过合成 ROS 2 TF/Marker 场景回归，修复重绘续期及缺少变换的错误提示，详见[TF/Marker 验证](ROS2_MCAP_SCENE_VALIDATION.md)。

## 安装和构建环境

已验证 Node 22.22.3 / npm 10.9.8 / Linux / Chrome 156。依赖只安装在本项目及其子包内，没有执行全局安装。

`npm run bootstrap` 和 `npm run install-ci` 的安装脚本将 npm、node-gyp、Puppeteer 及遵循 XDG 的缓存留在 `.cache/`。第一次受限环境中的失败日志位于本项目 `.npm-cache/`。Flow 临时文件和浏览器检查的 profile 也留在本项目。

网络中断时，重新执行 `npm run bootstrap` 会复用缓存；`.npmrc` 已降低并发并设置超时和重试。顶层依赖和 5 个子包已成功安装。根目录及全部子包的完整清单均有对应锁文件。安装脚本统一 React 实例，再由 Lerna 链接版本兼容的本地包。11 月 12 日已在项目内独立目录完成干净安装及完整验证；12 份清单和锁文件的安装前后哈希一致，详见[安装验证](ROS2_MCAP_INSTALLATION.md)。安装时跳过 Chromium 下载，浏览器检查使用已有 Chrome。

依赖边界：

- `@mcap/core` 2.3.0
- `@foxglove/rosmsg` 5.0.5
- `@foxglove/rosmsg2-serialization` 3.1.2
- webpack 4.47.0 和 babel-loader 8.4.1：解决 Node 22 下旧哈希实现的 OpenSSL 错误。
- Babel preset-env：仅转译现代 MCAP/CDR 相关依赖，使旧 webpack 可以解析新语法。
- `babel-polyfill`：补齐旧测试配置使用但未直接声明的依赖。

上游可选 Blueprint 依赖仍会产生构建警告，构建可以成功；React lint 配置也保留一个版本提示。这些不等于完成了全部旧依赖的现代化。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 生产构建 | `NODE_ENV=production npm run build` 通过 |
| 完整 lint | `npm run lint` 通过 |
| Flow | 0 errors |
| 无依赖基础检查 | 6 项通过：精度、魔数、分段读取、关闭、类型映射及内存估算 |
| MCAP / ROS 1 / bobject 回归 | 5 个 suite、58 项通过，1 个 snapshot 通过 |
| PointCloud2 回归 | 7 个 suite、53 项通过，覆盖标准 PointField 类型 1–8 |
| 合成数据浏览器检查 | 真实 worker 路径、Raw Messages、Plot、播放、跳转及 uint64 精确显示通过 |
| 稳定性与共享组件回归 | 31 个 suite、352 项及 3 个 snapshot 通过（含缓存、播放器、RPC、图表、消息管线） |
| TF / Marker 场景 | 6 项新集成测试、21 suite/159 项相关回归及 9 项浏览器渲染检查通过；见[范围说明](ROS2_MCAP_SCENE_VALIDATION.md) |
| 压缩读取与错误恢复 | 18 suite/184 项相关回归；4 种 Raw/Plot 模式、混合 TF/Marker、7 项故障/恢复检查及两份真实短窗口通过，见[压缩验证](ROS2_MCAP_COMPRESSION.md) |
| 干净安装与统一验证入口 | `npm run verify:mcap:clean` 通过：34 suite/392 项、3 snapshots、6 项基础检查及完整压缩浏览器检查，见[安装验证](ROS2_MCAP_INSTALLATION.md) |
| 真实录制文件 | 见下文及[稳定性验证](ROS2_MCAP_STABILITY.md)；未验证全部话题 |

相关本地日志和截图保存在 `.cache/`，不会提交：`build.log`、`lint.log`、`flow.log`、`regression-tests.log`、`pointcloud-tests.log`、`mcap-smoke/`、`real-mcap-inspection.json` 和 `real-mcap.png`。真实录制和真实图像留在本机；可共享的 smoke test 只生成合成数据。

## 真实文件验证

使用原项目目录中的约 1 GiB、未压缩、带索引的 ROS 2 MCAP 文件，未复制或修改原文件。

- 成功发现 84 个话题。
- 读取开头一秒，解码 67 个话题的 2,947 条消息；其余话题在该窗口内没有消息，不代表整个录制已验证。
- 该次检查合计读取 26,794,758 字节，最大单次读取 1,932,479 字节，没有一次性载入整个文件。
- 在本机 Node 进程中，初始化约 49 ms，该窗口解码约 1,033 ms。这是一次局部测量，不是浏览器性能保证。
- 浏览器已显示 JPEG 相机图像、PointCloud2、IMU 原始消息及 IMU 曲线，并能开始播放。
- 当前录制未发现 `/tf` 或 `/tf_static`；点云验证选择了其自身的 `base_link` 坐标系，未据此宣称跨坐标系变换可用。

合成测试还验证了开始/结束端点、单点时间窗口、嵌套自定义定义、混合类型命名、Time 转换、大整数常量及错误提示。真实消息值与独立 Python/ROS 参考解码器的系统性比对仍待进行。

11 月 10 日已验证 18 次跳转、4 轮播放中切换、6 轮初始化中切换，以及从起点后 0.5 秒至结尾的连续回放。修复了来源取消、3D worker、Plot 手势监听器和缓存保留问题；完整方法及本机测量见[稳定性验证](ROS2_MCAP_STABILITY.md)。

## 本地试用

```sh
npm run bootstrap
NODE_ENV=production npm run build
npm run serve-local
```

打开 http://127.0.0.1:18080/app/ ，拖入 `.mcap` 文件。添加 Raw Messages、Plot、Image 或 3D 面板后选择相应话题。没有 TF 的录制，应先选择与点云消息相同的坐标系。

开发模式可使用 `npm run webviz-dev`。`npm run verify:mcap` 可依次执行构建、基础及回归测试、lint、Flow 和浏览器检查，并自动管理临时服务；`npm run verify:mcap:clean` 会先在项目内隔离目录安装。单项检查：

```sh
npm run test:mcap:helpers
npm run test:mcap
npm run lint
npm run flow
# 服务器启动后，使用已有 Chrome，无需全局安装：
BROWSER_PATH=/usr/bin/google-chrome npm run smoke:mcap
npm run smoke:mcap:scene
npm run smoke:mcap:compression
# 自有录制需要包含 Imu、CompressedImage、PointCloud2：
npm run stress:mcap -- /absolute/path/to/recording.mcap
```

## 下一阶段

1. 已加入真实文件的重复跳转、持续播放、关闭/切换来源和内存检查，详见[稳定性验证](ROS2_MCAP_STABILITY.md)。后续扩展更长录制、不同文件及浏览器，并根据性能证据评估 CDR 解码移入 worker。
2. TF、`/tf_static` 和基本 Marker 已加入合成回归；继续补充真实 TF/Marker 录制、精确时间变换、完整历史恢复、更多相机和点云格式及独立参考解码器比对。
3. 检查 64 位整数在 Plot、JSON 导出、Diff 和 Node Playground 中的消费规则；当前已验证解码和 Raw Messages 保持精确。
4. 已接入并验证 zstd/lz4；继续扩展长压缩录制和不同编码器输出的验证。`ros2idl`、无索引恢复、HTTP 来源、`.db3`、分包和实时连接仍属后续范围。
5. 干净安装与可用于本地/CI 的统一检查命令已完成；后续接入实际托管 CI，并验证浏览器兼容性、旧服务端点和依赖许可证后，再准备发布。

## 接口依据

- [MCAP TypeScript SDK](https://mcap.dev/docs/typescript/classes/_mcap_core.McapIndexedReader)
- [Foxglove ROS 2 serialization](https://github.com/foxglove/ros-typescript/tree/main/packages/rosmsg2-serialization)
- [Foxglove ROS message definitions](https://github.com/foxglove/ros-typescript/tree/main/packages/rosmsg)
