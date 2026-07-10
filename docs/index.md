---
hide:
  - navigation # 可隐藏左侧导航栏，让首页更干净。如果不想隐藏可删除。
  - toc        # 可隐藏右侧目录，让首页更干净。
---

# 
<p align="center">
  <img src="https://raw.githubusercontent.com/vllm-project/vllm/main/docs/assets/logos/vllm-logo-text-light.png" width="300" /> <!-- 可换成你自己的图 -->
</p>

<h1 align="center" style="font-weight: 600; margin-top: 0;">
  KV Cache 源码深度分析
</h1>

<p align="center" style="font-size: 1.2rem; color: var(--md-default-fg-color--light);">
  vLLM 的缓存调度中枢 · 从调度器到物理块的完整链路
</p>

<p align="center">
  <a href="architecture/" title="调用结构树" class="md-button md-button--primary">
    开始探索
  </a>
  <a href="api/block_pool/" title="API 文档" class="md-button">
    API 参考
  </a>
</p>

---

##  为什么需要这份文档？

vLLM 之所以能在高并发下高效推理，**KV Cache 的自动调度与复用**是关键。但它的内部实现涉及多个抽象层：EngineCore、Scheduler、KVCacheManager、BlockPool…… 首次阅读源码时常会迷失方向。

这份文档的核心目的就是**把分散的源码，串联成一条清晰的执行路径**：

- **调用结构树**：一张可交互的流程图，点击任意函数即可跳转到详细解释。
- **源码级注释**：每个关键函数都附带参数说明、返回值、实现逻辑与源码直链。
- **按需查阅**：你可以从调度器开始向下挖，也可以直接搜索某个类名查看 API。

---

##  快速导览

<div class="grid cards" markdown>

-   __调用结构树__

    ---

    从 `LLMEngine.generate` 开始，一步步跟踪 KV Cache 的分配、抢占与回收流程。

    [:octicons-arrow-right-24: 查看完整链路](architecture/)

-   __API 文档__

    ---

    自动从源码 docstring 生成，包含 `BlockPool`、`KVCacheBlocks`、`Scheduler` 等核心组件。

    [:octicons-arrow-right-24: 查看 API 列表](api/block_pool/)



</div>

---

##  核心模块速览

| 模块 | 一句话职责 |
|------|------------|
| `Scheduler` | 决定哪个请求可以分配 KV Cache，负责抢占与优先级 |
| `KVCacheManager` | 协调不同数据类型（如普通与跨层 KV）的统一分配 |
| `SingleTypeKVCacheManager` | 针对单一数据类型的物理块管理 |
| `BlockPool` | 物理块的池化，提供 `get_new_blocks` 与 `free_blocks` |
| `BlockTable` | 维护逻辑块到物理块的映射表 |

---

##  使用建议

- **如果你是第一次接触**：建议从 [调用结构树](architecture/) 开始，点击流程图中橙色高亮的节点了解核心路径。
- **如果你在阅读源码时遇到某个类/方法**：使用顶部的搜索栏，直接输入类名即可跳转到 API 文档。

---

##  关于本站

本站基于 [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) 构建，源码与 vLLM 注释一同托管于 [GitHub 仓库](https://github.com/Rigel-Chen/vllm-walkthrough)。  
如果你发现任何错误或想补充分析，欢迎提交 Issue 或 PR。

---

*最后更新：2026年7月*
