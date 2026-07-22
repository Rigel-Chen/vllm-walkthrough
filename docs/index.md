---
hide:
  - navigation
  - toc
---

<!-- ═══════════════ Hero ═══════════════ -->
<div class="idx-hero" markdown="1">

<p align="center">
  <img src="assets/vllm-logo-text-light.png" width="260" alt="vLLM" onerror="this.src='https://raw.githubusercontent.com/vllm-project/vllm/main/docs/assets/logos/vllm-logo-text-light.png'" />
</p>

<h1 align="center" style="font-weight: 800; margin: 8px 0 0; font-size: 2.2rem; letter-spacing: -0.02em;">
  KV Cache 源码深度分析
</h1>

<p align="center" style="font-size: 1.1rem; color: var(--fc-muted, #64748b); max-width: 540px; margin: 12px auto 20px; line-height: 1.6;">
  vLLM 缓存调度中枢的完整走读 &nbsp;·&nbsp; 从引擎入口到物理块池的六层架构全景
</p>

<p align="center">
  <a href="architecture/" class="md-button md-button--primary" style="padding: 10px 28px; font-size: 0.95rem;">
    开始探索 &nbsp;→
  </a>
  &nbsp;
  <a href="api/block_pool/" class="md-button" style="padding: 10px 28px; font-size: 0.95rem;">
    API 参考
  </a>
</p>

</div>

---

<!-- ═══════════════ 六层架构预览 ═══════════════ -->
## 🏗️ 六层架构一览

<div class="idx-layers" markdown="1">

<div class="idx-layer" data-layer="engine" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">🧱</span>
<span class="idx-layer-name">引擎入口层</span>
</div>
<div class="idx-layer-body" markdown="1">
LLMEngine · EngineCoreClient · InputProcessor · OutputProcessor
</div>
</div>

<div class="idx-layer" data-layer="scheduler" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">⚙️</span>
<span class="idx-layer-name">调度决策层</span>
</div>
<div class="idx-layer-body" markdown="1">
Scheduler · 等待/运行队列 · 抢占 · KVConnector · 推测解码
</div>
</div>

<div class="idx-layer" data-layer="coordinator" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">🔀</span>
<span class="idx-layer-name">缓存协调层</span>
</div>
<div class="idx-layer-body" markdown="1">
KVCacheCoordinator (ABC) · NoPrefixCache · Unitary · Hybrid
</div>
</div>

<div class="idx-layer" data-layer="cache" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">📦</span>
<span class="idx-layer-name">缓存管理层</span>
</div>
<div class="idx-layer-body" markdown="1">
KVCacheManager · SingleTypeKVCacheManager · allocate_slots
</div>
</div>

<div class="idx-layer" data-layer="pool" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">💾</span>
<span class="idx-layer-name">物理块池层</span>
</div>
<div class="idx-layer-body" markdown="1">
BlockPool · FreeQueue · BlockHashToBlockMap · evict_blocks
</div>
</div>

<div class="idx-layer" data-layer="model" markdown="1">
<div class="idx-layer-head" markdown="1">
<span class="idx-layer-icon">🚀</span>
<span class="idx-layer-name">模型执行层</span>
</div>
<div class="idx-layer-body" markdown="1">
GPUModelRunner · Attention Backend · block_table / slot_mapping
</div>
</div>

</div>

---

<!-- ═══════════════ 文档规模 ═══════════════ -->
## 📊 文档覆盖

<div class="idx-stats" markdown="1">

<div class="idx-stat" markdown="1">
<div class="idx-stat-num">11</div>
<div class="idx-stat-label">交互式流程图</div>
</div>

<div class="idx-stat" markdown="1">
<div class="idx-stat-num">7</div>
<div class="idx-stat-label">API 文档页面</div>
</div>

<div class="idx-stat" markdown="1">
<div class="idx-stat-num">30+</div>
<div class="idx-stat-label">可点击组件卡片</div>
</div>

<div class="idx-stat" markdown="1">
<div class="idx-stat-num">6</div>
<div class="idx-stat-label">架构层级</div>
</div>

</div>

---

<!-- ═══════════════ 导航卡片 ═══════════════ -->
## 🧭 开始阅读

<div class="grid cards" markdown>

-   :material-source-branch:{ .lg .middle } &nbsp; __调用结构树__

    ---

    从总览流程图开始，自上而下遍历六层架构。点击任意模块卡片平滑滚动到详细流程图，点击组件卡片跳转到 API 文档。

    [:octicons-arrow-right-24: 查看完整链路](architecture/)

-   :material-bookshelf:{ .lg .middle } &nbsp; __API 文档__

    ---

    涵盖 `BlockPool`、`KVCacheManager`、`KVCacheCoordinator`、`SingleTypeKVCacheManager`、`Scheduler`、`LLMEngine`、`GPUModelRunner` 七大核心模块，每个方法均附源码签名与参数说明。

    [:octicons-arrow-right-24: 查看 API 列表](api/block_pool/)

-   :material-magnify:{ .lg .middle } &nbsp; __前缀缓存命中__

    ---

    深入拆解前缀缓存命中查找的完整链路：从 Scheduler 到 KVCacheCoordinator 的不动点迭代，到 BlockPool 的哈希→块双向索引。

    [:octicons-arrow-right-24: 查看命中流程](architecture/#process-prefix)

-   :material-package-variant-closed:{ .lg .middle } &nbsp; __块分配与释放__

    ---

    两阶段安全分配（先 touch 命中块再分配新块）、逆序归还、引用计数共享、延迟释放栅栏、分级 LRU 驱逐。

    [:octicons-arrow-right-24: 查看分配流程](architecture/#process-alloc)

</div>

---

## 🔍 为什么需要这份文档？

vLLM 的高并发推理能力依赖于 **KV Cache 的自动调度与复用**。但源码涉及引擎入口、调度决策、缓存协调、物理块池等多个抽象层——首次阅读时常会迷失方向。

这份文档的核心价值：

| 特性 | 说明 |
|------|------|
| **总分流程图** | 一张总览图 + 六层详细图 + 四张专项流程图，全部原生 HTML/CSS 绘制，点击节点直接导航 |
| **源码级 API** | 每个关键类与方法均附完整参数签名、类型注解、返回值说明与实现逻辑解析 |
| **零外部依赖** | 流程图无 Mermaid/Graphviz 依赖，纯 CSS + SVG 箭头，加载即渲染，支持深浅主题 |
| **按需跳转** | 从总览到详情到 API 三级跳转，每张卡片都是入口 |

---

## 📁 项目结构

```
kv-cache-analysis/
├── docs/
│   ├── index.md                          # 首页
│   ├── architecture.md                   # 调用结构树（11 张交互式流程图）
│   ├── api/
│   │   ├── block_pool.md                 # BlockPool + BlockHashToBlockMap
│   │   ├── kv_cache_manager.md           # KVCacheManager + KVCacheBlocks
│   │   ├── kv_cache_coordinator.md       # KVCacheCoordinator 体系
│   │   ├── single_type_kv_cache_manager.md # SingleTypeKVCacheManager
│   │   ├── scheduler.md                  # Scheduler
│   │   ├── llm_engine.md                 # LLMEngine
│   │   └── model_runner.md               # GPUModelRunner + AttentionBackend
│   ├── stylesheets/extra.css             # 流程图设计系统
│   └── javascripts/extra.js              # 交互逻辑
├── src/kv_cache/                         # Python 源码（供 mkdocstrings 引用）
├── mkdocs.yml
└── README.md
```

---

## 💡 使用建议

- **首次接触**：从 [调用结构树](architecture/) 的总览图开始，自上而下理解六层架构
- **深入某个模块**：点击流程图中的组件卡片，直达对应 API 文档的精确章节
- **阅读源码时查阅**：使用顶部搜索栏，输入类名/方法名即可定位到文档

---

## 🔗 关于本站

基于 [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) 构建 &nbsp;·&nbsp; 源码托管于 [GitHub](https://github.com/Rigel-Chen/vllm-walkthrough)  
发现错误或想补充分析？欢迎提交 Issue 或 PR。

---

*最后更新：2026 年 7 月*
