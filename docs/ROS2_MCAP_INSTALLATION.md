# 本地安装与统一验证

11 月 12 日已在本项目的独立目录中完成干净安装和完整验证。验证环境为 Linux、Node 22.22.3、npm 10.9.8 和已有 Chrome 156。依赖、缓存、构建、日志及浏览器 profile 均保存在本项目内，无需全局安装依赖或安装 ROS。

## 安装

日常安装：

```sh
npm run bootstrap
npm run webviz-dev
```

开发服务器启动前会自动执行 `npm run build:packages`，构建链接后的本地包；首次启动还需要等待 webpack 编译完成。若此前直接启动时遇到 `Can't resolve '@cruise-automation/tooltip'`，重新执行 `npm run webviz-dev` 即可。

严格使用锁文件安装：

```sh
npm run install-ci
```

安装脚本在根目录及 5 个子包中，分别使用完整的 `package.json` 执行 `npm install` 或 `npm ci`，包含开发依赖并使用 `--legacy-peer-deps`。CI 模式检查全部 6 份锁文件的 SHA-256，发现变化即失败。已重新生成子包锁文件，使其与完整清单一致。

旧 Lerna bootstrap 会临时改写子包清单并重新解析依赖，不能保证子包锁文件保持不变。现在安装完成后只运行 Lerna link，链接版本兼容的本地包；版本不同的依赖保留对应的 registry 包。脚本先检查子包的 React/react-dom 与根目录版本一致，再移除重复副本，以满足应用使用同一 React 实例的要求。

npm、node-gyp、Puppeteer 和 XDG 缓存定位到 `.cache/`。安装时跳过 Chromium 下载；浏览器检查通过 `BROWSER_PATH` 使用已有 Chrome。网络中断时可重跑安装以复用缓存。

## 验证命令

已安装依赖后，一条命令运行完整检查：

```sh
BROWSER_PATH=/usr/bin/google-chrome npm run verify:mcap
```

顺序为生产构建、基础 helper 检查、MCAP 与共享组件回归、lint、Flow、压缩浏览器检查。浏览器阶段临时监听本机空闲端口，验证结束或失败时关闭自己的服务。无需预先启动服务器；现有的 18080 服务继续运行。

报告在 `.cache/verify-mcap/report.json`，各阶段日志也保存在该目录。浏览器截图及合成录制保留在 `.cache/mcap-smoke/`、`.cache/mcap-scene/` 和 `.cache/mcap-compression/`。

从源码副本重新安装和构建：

```sh
BROWSER_PATH=/usr/bin/google-chrome npm run verify:mcap:clean
```

该命令在 `.cache/clean-install-XXXXXX/workspace/` 创建隔离副本，不复制已有 `node_modules`、编译输出、缓存或 `.mcap`/`.db3` 录制。它仅共享原项目的 npm 下载缓存，再执行 `install-ci` 和上述完整验证，并检查所有清单和锁文件的安装前后、验证前后哈希一致。运行目录会保留，报告、安装和验证日志分别为 `report.json`、`install.log`、`verify.log`；详细阶段日志位于副本的 `.cache/verify-mcap/`。

两条验证命令均需要 Node >=22.15 的原生 zstd 压缩接口来生成测试数据，默认 Chrome 路径为 `/usr/bin/google-chrome`。没有浏览器时可以显式跳过，但结果不包含浏览器覆盖：

```sh
npm run verify:mcap -- --no-browser
npm run verify:mcap:clean -- --no-browser
```

## 本次结果

实际运行目录为 `.cache/clean-install-3cZMoS/`，安装及检查合计约 7 分钟。该副本从未安装依赖、未编译的源码开始，使用项目内已有 npm 下载缓存。

| 检查 | 结果 |
| --- | --- |
| 根目录及 5 个子包安装 | 通过，6 份锁文件未改变 |
| 源码输入哈希 | 12 份清单和锁文件安装前后、验证前后一致 |
| 生产构建 | 通过 |
| helper 检查 | 6 项通过 |
| 回归 | 34 suites、392 项测试、3 snapshots 通过 |
| lint / Flow | 通过 / 0 errors |
| Raw Messages / Plot 浏览器流程 | 未压缩、lz4、zstd、混合压缩均通过 |
| 混合压缩 TF / Marker 场景 | 9 项通过 |
| 压缩故障和恢复 | 7 项通过 |
| 临时服务清理 | 报告记录关闭，结束后连接被拒绝；原 18080 服务仍返回 HTTP 200 |

## 验证边界

这些命令可供本地或 CI 调用，尚未配置托管 CI 工作流。此次只验证上述 Linux/Node/npm/Chrome 组合。

干净安装复用了下载缓存，并非离线安装。上游部分 Git 依赖的 prepare 阶段仍会自行安装构建依赖，可能访问网络；6 份应用锁文件不等于这些上游准备过程已完全固定。因此本次证明的是独立安装、构建和功能检查通过，以及应用清单和锁文件未漂移，并未证明所有上游安装产物逐字节可复现。依赖许可证审查及旧依赖全面现代化仍是后续工作。

MCAP、TF 和 Marker 的功能边界继续以[实现进度](ROS2_MCAP_PROGRESS.md)、[场景验证](ROS2_MCAP_SCENE_VALIDATION.md)及[压缩验证](ROS2_MCAP_COMPRESSION.md)为准。
