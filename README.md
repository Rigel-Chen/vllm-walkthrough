# 🔬 KV Cache 源码深度分析

[![文档](https://img.shields.io/badge/📖-在线文档-1976d2?style=for-the-badge&logo=materialformkdocs)](https://rigel-chen.github.io/vllm-walkthrough/)
[![vLLM](https://img.shields.io/badge/vLLM-v1-ff6f00?style=for-the-badge&logo=v)](https://github.com/vllm-project/vllm)
[![MkDocs](https://img.shields.io/badge/MkDocs-Material-526cfe?style=for-the-badge&logo=materialformkdocs)](https://squidfunk.github.io/mkdocs-material/)

> vLLM KV Cache 调度中枢的完整走读文档——从引擎入口到物理块池的六层架构全景。

---

## 🎯 关于本项目

vLLM 的高并发推理能力依赖于 **KV Cache 的自动调度与复用**，但源码涉及引擎入口、调度决策、缓存协调、物理块池等多个抽象层——首次阅读时常会迷失方向。

本项目提供了一套**交互式流程图 + 源码级 API 文档**，将分散的源码串联成清晰的执行路径：

- 🗺️ **11 张交互式流程图** — 纯 HTML/CSS 绘制，点击节点直达详情
- 📚 **7 个 API 文档页面** — 每方法附完整参数签名与实现逻辑
- 🎨 **零外部流程图依赖** — 无 Mermaid/Graphviz，加载即渲染

👉 **[立即浏览在线文档](https://rigel-chen.github.io/vllm-walkthrough/)**

---

## 🏗️ 六层架构

```
🧱 引擎入口层  →  ⚙️ 调度决策层  →  🔀 缓存协调层
                                    ↘  🚀 模型执行层
                                        ↓
                    📦 缓存管理层  →  💾 物理块池层
```

| 层级 | 核心组件 | API 文档 |
|------|---------|----------|
| 🧱 引擎入口 | `LLMEngine` · `EngineCoreClient` · `InputProcessor` · `OutputProcessor` | [`llm_engine`](https://rigel-chen.github.io/vllm-walkthrough/api/llm_engine/) |
| ⚙️ 调度决策 | `Scheduler` · 等待/运行队列 · 抢占 · `KVConnector` · 推测解码 | [`scheduler`](https://rigel-chen.github.io/vllm-walkthrough/api/scheduler/) |
| 🔀 缓存协调 | `KVCacheCoordinator` · `NoPrefixCache` · `Unitary` · `Hybrid` | [`kv_cache_coordinator`](https://rigel-chen.github.io/vllm-walkthrough/api/kv_cache_coordinator/) |
| 📦 缓存管理 | `KVCacheManager` · `SingleTypeKVCacheManager` · `KVCacheBlocks` | [`kv_cache_manager`](https://rigel-chen.github.io/vllm-walkthrough/api/kv_cache_manager/) |
| 💾 物理块池 | `BlockPool` · `FreeQueue` · `BlockHashToBlockMap` · `evict_blocks` | [`block_pool`](https://rigel-chen.github.io/vllm-walkthrough/api/block_pool/) |
| 🚀 模型执行 | `GPUModelRunner` · `AttentionBackend` · `slot_mapping` | [`model_runner`](https://rigel-chen.github.io/vllm-walkthrough/api/model_runner/) |

---

## 📂 项目结构

```
kv-cache-analysis/
├── docs/
│   ├── index.md                              # 首页
│   ├── architecture.md                       # 调用结构树（11 张交互式流程图）
│   ├── api/
│   │   ├── block_pool.md                     # BlockPool + BlockHashToBlockMap
│   │   ├── kv_cache_manager.md               # KVCacheManager + KVCacheBlocks
│   │   ├── kv_cache_coordinator.md           # KVCacheCoordinator 体系
│   │   ├── single_type_kv_cache_manager.md   # SingleTypeKVCacheManager
│   │   ├── scheduler.md                      # Scheduler
│   │   ├── llm_engine.md                     # LLMEngine
│   │   └── model_runner.md                   # GPUModelRunner + AttentionBackend
│   ├── stylesheets/extra.css                 # 流程图设计系统（CSS 变量 + SVG 箭头 + 六色主题）
│   └── javascripts/extra.js                  # 平滑滚动 + IntersectionObserver scroll spy
├── src/kv_cache/                             # 分析参考用的 Python 源码
├── mkdocs.yml
└── README.md
```

---

## 🚀 本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/Rigel-Chen/vllm-walkthrough.git
cd vllm-walkthrough

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动本地文档服务器
mkdocs serve

# 4. 浏览器打开 http://127.0.0.1:8000
```

构建静态站点：

```bash
mkdocs build
# 输出到 site/ 目录
```

---

## 🤝 贡献

本项目专注于 vLLM v1 架构中 KV Cache 调度与管理机制的深度分析。欢迎通过以下方式贡献：

- 🐛 **报告问题**：[提交 Issue](https://github.com/Rigel-Chen/vllm-walkthrough/issues)
- 📝 **补充分析**：对某个函数或流程有更深入的理解？提交 PR 补充到对应的 API 文档
- 🔗 **修正链接**：流程图中的组件卡片链接到错误的章节？帮助修正


---

*最后更新：2026 年 7 月*
