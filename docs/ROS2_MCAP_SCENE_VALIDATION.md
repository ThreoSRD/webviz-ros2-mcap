# ROS 2 TF / Marker 验证

原始验证日期：2026-11-10；压缩扩展更新：2026-11-12。状态：合成录制的解码、TF 选择、场景处理和浏览器渲染回归通过；仍为本地原型。

## 本轮改动

1. 修复标准 Marker / MarkerArray 的寿命计算。3D 面板会在播放时钟或相机变化时重新消费保留的消息；此前每次重绘都会按当前显示时钟重新计时，旧 Marker 因而可能一直不消失。现在传递录制消息的 `receiveTime`：旧消息重绘保持原到期时间，收到同一个 id 的新消息才重新计时。未传时间的自定义渲染入口保留原来的时钟默认值。
2. 修复缺少变换的错误提示。错误集合原先在填入 frame id 之前就发布，导致提示中的坐标系名称为空；变换恢复后也可能残留旧提示。现在每帧消费结束后刷新最终错误，提示包含具体 frame，并能随恢复清除。
3. 新增共享合成录制生成器、6 项 ROS 2 场景集成测试及独立浏览器场景检查。没有新增依赖，没有复制私有录制；生成数据和浏览器 profile 都在项目 `.cache/` 内。

## 合成数据和检查路径

`scripts/fixtures/ros2-scene.js` 默认生成带索引、未压缩的 MCAP；可通过 `MCAP_COMPRESSION` 生成 lz4/zstd/混合版本，混合压缩的 9 项浏览器检查也已通过，见[压缩验证](ROS2_MCAP_COMPRESSION.md)。CDR 用独立的小型编码器按字段手工写入，不使用被测 ROS 2 解码库的 serializer；小 chunk 将多个事件分开，避免只验证一次整块读取。

包含 `/tf`、`/tf_static`、`/markers`、`/marker_array`、`/unconnected`、`/scene_tick` 六个话题，跨度 6 秒。另一个版本不写入静态 TF 消息，用于验证切换来源后不会沿用旧变换。

坐标关系：`map → odom → base_link → sensor`。两条静态变换仅在起始时刻记录一次，header stamp 为零；动态变换沿 X 轴平移。静态 sensor 链同时包含平移及 90° 旋转。集成测试检查 sensor 中的点 `(1, 0, 0)` 在三个动态采样时刻映射到 map 中的 `(2, 2, 0)`、`(6, 2, 0)`、`(10, 2, 0)`，再反向跳回检查。

测试消息定义依据 [ROS 2 TFMessage](https://github.com/ros2/geometry2/blob/humble/tf2_msgs/msg/TFMessage.msg)、[Header](https://github.com/ros2/common_interfaces/blob/4.2.0/std_msgs/msg/Header.msg) 和 [common_interfaces 4.2.0 Marker](https://github.com/ros2/common_interfaces/blob/4.2.0/visualization_msgs/msg/Marker.msg)。Marker 定义包含纹理、UV、内嵌 mesh 字段，使用空值检查解码兼容性；这不表示已实现资源渲染。

单元/集成路径：MCAP 索引读取 → ROS 2 CDR 解码 → bobject → 实际 TF hook / SceneBuilder / MessageCollector。覆盖 Time、Duration 的 `nsec` 适配、数组、常量、UTF-8、多级变换、更新和删除、寿命边界、旧消息重绘不续期、新消息更新续期，以及缺少变换和恢复。

浏览器路径使用生产版本、真实数据 worker 和布局 worker。检查合成数据渲染出的红色方块、绿色球体和黄色线段，读取浏览器合成截图的像素，避开视口边缘的控件和错误标记。9 项检查：

| 检查 | 验证结果 |
| --- | --- |
| 初始静态/动态 TF 链 | 红色方块、绿色球体、黄色线段可见 |
| 播放时寿命到期 | 绿色球体消失，零寿命红色方块保留 |
| 动态 TF 更新 | 红色方块的像素中心移动 |
| DELETE | 红色方块消失 |
| 删除后 ADD | 红色方块重新出现，仍能使用起始时刻的静态 TF |
| DELETEALL + MarkerArray ADD | 先清除，再显示新球体 |
| 新球体寿命到期 | 绿色球体消失 |
| 回跳到起始 ADD 消息 | 恢复图形及初始像素位置 |
| 切换到缺少静态 TF 的来源 | sensor 中方块不可见，map 中球体可见；话题树明确提示缺少 sensor 变换 |

未捕获浏览器异常及 error 级界面通知均为零。原有非根坐标系时序警告和频繁切换元数据的诊断警告仍会显示，并写入报告，没有被隐藏。

## 复现

```sh
NODE_ENV=production npm run build
npm run serve-local
```

另开终端：

```sh
npm run test:mcap
BROWSER_PATH=/usr/bin/google-chrome npm run smoke:mcap:scene
```

服务器地址默认 http://127.0.0.1:18080/app/ ，可用 `WEBVIZ_SMOKE_URL` 覆盖。脚本使用已有 Chrome，不安装全局浏览器，也无需 ROS。

结果位于 `.cache/mcap-scene/report.json`，9 个对应截图和两个合成 `.mcap` 文件也在同目录。相关日志为 `.cache/scene-tests.log`、`scene-regression.log`、`scene-browser.log`、`build-scene.log`、`lint-scene.log`、`flow-scene.log` 和 `smoke-scene-regression.log`。

本轮检查：21 个 suite、159 项相关回归测试通过；生产构建、完整 lint、Flow（0 errors）通过；新的场景浏览器检查及原有 Raw Messages/Plot/uint64 smoke 均通过。

## 范围与限制

- 已有真实传感器录制不含 TF。本轮证据来自合成标准消息，尚未用真实 ROS 2 TF/Marker 录制及独立 ROS 解码器系统比对。
- TF 继续采用现有的最近 header stamp 采样方式，可能选到显示时间之后的采样。没有实现插值/外推，也没有按每条 Marker 自身的 header stamp 独立选择 TF。非根坐标系的时序警告因此仍有意义。
- 本轮使用 `frame_locked=false`，覆盖 CUBE、SPHERE、LINE_STRIP 和空 namespace 的 DELETEALL。`frame_locked=true`、按 namespace 的 DELETEALL、mesh/纹理资源、其他形状及静态 TF 多次变更的语义仍需专门实现或验证。
- 回跳检查落在 ADD 消息的回填窗口内。当前播放器使用有限的回填窗口，不会重放任意目标时间之前的全部 Marker 历史；不能据此宣称任意跳转都能恢复完整持久 Marker 场景。
- 这是 Linux / Chrome 156 / SwiftShader 上的回归检查，没有测量硬件 GPU 性能，也不构成跨浏览器兼容性保证。`ros2idl`、无索引恢复、`.db3` 和实时连接仍不在本轮范围。
