# MarkerArray 残留和坐标系警告修复

## 竖排重复的雷达文字（bug4.png）

截图时间 `1793864196.212093547` 的 `/sensor/radar_maker` 中，有 51 个内容为
`"0 ,"`、位置相同且样式相同的 TEXT_VIEW_FACING Marker。
这些对象的 ID 不同、lifetime 为 0.1 秒；文字渲染器对同位置标签逐行向下错开，
导致屏幕上出现很长的竖排零。它不是文字的原始 Z 坐标下降，也不是无限生命周期残留。

现在默认在每个 topic/namespace 内折叠同位置、同文字、同样式的重复标签，只显示一个。
原始 Marker 仍完整保留并处理更新、删除和过期；不同文字、位置、样式和 namespace
保持独立，且筛选不会跨 topic 合并。
折叠后的标签只能选中其中一个 Marker；要逐个检查重复对象，在 topic 设置中开启
**Duplicate text labels → Stack identical text labels**，恢复原有堆叠行为。

真实数据经过生产适配器和 SceneBuilder 验证：原始 118 个文字对象折叠为 58 个标签，
其中 51 个重复 `"0 ,"` 显示为 1 个；开启堆叠选项后恢复 118 个。
报告为 `.cache/bug-analysis/bug4-validation.json`。浏览器截图验证尚未完成。

## 使用方式

### bug51 → bug52 → bug53 的连续播放修复

这两个已确认的分层规划 topic 现在使用项目内置显示预设：
`/planning/virtual_map_polygon3d`、`/planning/virtual_path_polygon3d` 默认是最新快照、第 0 层。
缺少这些字段的旧布局也应用预设，界面和场景使用同一套有效设置。
这只是本项目对这两个具体 topic 的显示约定，不是通用 ROS MarkerArray 的语义。
其他 topic 仍默认增量更新、显示全部层。显式选择的设置优先于预设。

清空 Z 输入框会保存 `markerZLayer: null` 表示全部层；字段缺失表示使用默认值。
因此导出/重载布局后，明确选择的“全部层”也不会被默认第 0 层覆盖。

快照模式下，左侧 namespace 列表随当前数组和所选层更新，不再列出历史和隐藏层的
几千个 `3dMap_marker...`。被手动取消选择的 namespace 仍保留在列表中，可以重新启用。

### 播放性能

完整快照启用单层过滤时，3D 场景只构建当前可见层的线条；切换层时会重新读取已缓存的
完整快照。删除操作、同一 namespace/ID 的覆盖和增量模式仍按原有方式处理。数组中的
namespace 也改为批量去重，避免每加入一个就扫描和复制整个列表。

对本机真实录包中的 14 帧进行离线对照：一个代表性数组包含 2,348 个 Marker，默认第 0 层
显示 18 个。场景处理时间中位数从约 24.9 ms/帧降至 7.9 ms/帧；选择全部层时从约
135.7 ms/帧降至 28.1 ms/帧。四种切层状态共 56 次对照的可见 Marker、坐标、namespace
和场景最小 Z 均一致。这些是本机 JavaScript 场景构建测量，不包含文件读取、解码或 GPU 绘制。

用真实录制的消息经生产适配器和 SceneBuilder 验证：

| 截图/时间 | 最新红色数组大小 | 默认显示框数 | 左侧 namespace 数 |
| --- | ---: | ---: | ---: |
| bug51 / 1793864219.880705394 | 0 | 0 | 0 |
| bug52 / 1793864225.546377971 | 0 | 0 | 0 |
| bug53 / 1793864226.442375717 | 2419 | 19 | 19 |
| bug3 / 1793864227.304396270 | 2762 | 27 | 27 |

还验证了后退、逐帧重放 12 条消息，以及暂停时切换全部层和恢复预设。
报告为 `.cache/bug-analysis/bug5-validation.json`。这验证场景输出和 namespace 数据，
用户正在运行的浏览器实例仍需刷新复测。

在 3D 面板展开 Topics，打开 `/planning/virtual_map_polygon3d` 的 topic 设置，
将 **Message handling** 改成 **Complete snapshot**。已累积的旧图形会立即清理，
后续每条 MarkerArray 替换该 topic 的全部对象，空数组也会清空。
两个 3D 面板的配置独立，需要分别设置。布局导出和导入会保留此选项。

如果仍看到竖墙或阶梯，在同一个弹窗内将 **Z layer (line markers)** 设为 `0`。
该选项仅显示所有点的原始 Z 值均等于指定层（容差 0.0001）的完整线条/矩形；
Z 在 marker pose 和 TF 变换前判断，不会修改原始坐标。非平面线条不会出现在单层视图中。
清空输入框恢复所有层；支持 `-1`、`0.5` 等值。其他类型的 Marker 不受影响。
隐藏层仍正常处理更新、删除和过期，暂停时切换层也能立即显示最新状态。

对 `bug3.png` 对应消息，红色地图的 `0` 层为 27 个框，`-1` 层为 14 个，所有层为 2,762 个。
紫色 `/planning/virtual_path_polygon3d` 也应单独选择 `0` 层。
这只是按原始坐标筛选；Z 是否表示规划时间，需要发布端确认。

可直接导入 [地面层示例布局](layouts/ros2-ground-layer.json)：只启用上述两个 topic 的
快照/第 0 层和原始点云，以便单独检查对齐。导入布局会替换当前布局，建议先导出保存。
它不启用 `/map/guidance_marker` 的大方形点集，也不启用跨多个 Z 层的黄色调试线。
操作入口：页面顶部 **Config → Import/export layout**，将示例 JSON 内容粘贴到文本框中应用。
若界面没有新选项，请重启 `npm run webviz-dev` 并使用 `Ctrl+Shift+R` 强制刷新。

对应配置为：

```json
{
  "settingsByKey": {
    "t:/planning/virtual_map_polygon3d": {
      "markerArrayMode": "snapshot",
      "markerZLayer": 0
    }
  }
}
```

以上是面板配置片段；修改已有配置时应保留其他设置。

普通 topic 默认仍使用 **Incremental updates**，遵循原有 namespace/ID、删除和 lifetime 语义。
增量发布的 MarkerArray 不应启用完整快照模式。更彻底的发布端修复是发送 DELETEALL，
或使用稳定 namespace/ID 并删除消失的对象。

## 问题原因

截图时刻为 `1793864227.174286909`，在录制开始后 56.484 秒，距离结束约 1.323 秒。
红色 `/planning/virtual_map_polygon3d` 在约 55.433 秒开始发布；截图前 11 条消息的
namespace/ID 组合不断变化，全部为 ADD、无限 lifetime，且无删除消息。
最新数组只有 2,225 个对象，按增量语义逐条处理却会留下 24,904 个对象。

紫色 `/planning/virtual_path_polygon3d` 的键稳定，保持为 15 个；其 Z 值本来就为
0 至 9，黄色路径末端 Z 为 15。此次保留原始坐标，不对这些高度做自动压平。

`has bad frame` 的另一原因是 SceneBuilder 原来直接比较坐标系名称，而变换层会去掉
前导斜杠。修复让警告判断复用同一规范化函数；`base_link` 和 `/base_link` 不再误报。
真正不同坐标系的变换限制和缺失变换仍会提示。

## 验证

回归测试覆盖完整数组替换、ID 变化、数组缩小、空数组、同批多消息、暂停时切换模式、
后退和重新播放、清理和更换数据源，以及前导斜杠别名。原有增量更新、生命周期、
TF 链和断开坐标系测试继续运行。

使用本地录制数据，通过生产 ROS 2 适配器和 SceneBuilder 验证：

- 连续处理这 11 条消息时，快照模式始终等于最新数组大小，最后为 2,225。
- 同时对照的增量模式最后为 24,904。
- 一次跳到截图时间为 2,225，后退到第三帧为 2,411，再前进为 2,225。
- 使用 `/base_link` 消息和 `base_link` 根坐标系，不产生警告。

本地报告存放于 `.cache/bug-analysis/fix-validation.json`，不随源码提交。
这些结果验证了解码和场景输出，浏览器截图验证另行进行。
