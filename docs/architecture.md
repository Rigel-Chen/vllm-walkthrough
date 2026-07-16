# KV Cache 调用结构树

本文档从多个维度展示 KV Cache 系统的完整调用链路，帮助深入理解从请求进入到缓存分配、命中查询、块释放的全流程。

---

<div class="arch-section" markdown="1">

## 一、核心调用链路简图

<div class="arch-section-desc" markdown="1">
精简展示 KV Cache 从请求进入到物理缓存的主干调用路径，快速把握六层架构。
</div>

<div class="arch-diagram" markdown="1">
<div class="arch-diagram-header">📐 六层主干链路 · 从上到下依次为引擎入口 → 调度决策 → 缓存协调 → 缓存管理 → 物理块池 → 模型执行</div>
<div class="arch-diagram-body" markdown="1">

```mermaid
flowchart TD
    A["LLMEngine<br><small>引擎入口</small>"] --> B["EngineCore<br><small>核心引擎</small>"]
    B --> C["Scheduler.schedule()<br><small>调度决策 + 准入控制</small>"]

    C --> D["KVCacheManager<br><small>统一缓存管理入口</small>"]
    D --> E["KVCacheCoordinator<br><small>多缓存组协调</small>"]
    E --> F["SingleTypeKVCacheManager × N<br><small>各类型缓存独立管理</small>"]
    F --> G["BlockPool<br><small>全局物理块池<br>分配 / 释放 / 驱逐 / 前缀缓存</small>"]

    C --> H["ModelRunner<br><small>模型执行</small>"]
    G -.->|"物理块读写"| I["Attention Backend<br><small>写入 KV 缓存</small>"]
    H --> I

    classDef l1 fill:#e1f5fe,stroke:#0288d1,color:#01579b
    classDef l2 fill:#fff3e0,stroke:#f57c00,color:#e65100
    classDef l3 fill:#e0f2f1,stroke:#00897b,color:#004d40
    classDef l4 fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
    classDef l5 fill:#fbe9e7,stroke:#e64a19,color:#bf360c
    classDef l6 fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c

    class A,B l1
    class C l2
    class D,E l3
    class F l4
    class G l5
    class H,I l6
```

</div>
</div>

</div>

---

<div class="arch-section" markdown="1">

## 二、分层组件架构浏览器

<div class="arch-section-desc" markdown="1">
点击每层卡片展开查看该层的全部组件、职责说明以及上下游调用关系。支持逐层展开或一键全部展开/收起。
</div>

<!-- ═══════════════ Architecture Explorer ═══════════════ -->
<div class="arch-explorer" markdown="1">

<div class="arch-controls" markdown="1">
<button class="arch-btn-expand-all" markdown="1">📂 全部展开</button>
<button class="arch-btn-collapse-all" markdown="1">📁 全部收起</button>
</div>

<!-- ─── Layer 1: Engine ─── -->
<div class="arch-layer" data-layer="engine" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">🧱</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">引擎入口层</span>
<span class="arch-layer-subtitle" markdown="1">LLMEngine · EngineCoreClient · InputProcessor · OutputProcessor</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a href="../api/llm_engine/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">LLMEngine</span>
<span class="arch-comp-desc" markdown="1">对外兼容封装，接收用户请求并驱动整个生成流程</span>
</a>

<a href="../api/llm_engine/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">EngineCoreClient</span>
<span class="arch-comp-desc" markdown="1">核心引擎客户端，将请求注册到引擎核心</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">InputProcessor</span>
<span class="arch-comp-desc" markdown="1">输入预处理：tokenize、prompt 格式化</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">OutputProcessor</span>
<span class="arch-comp-desc" markdown="1">输出后处理：detokenize、streaming 封装</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 下游调用</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↓</span>
<span class="arch-conn-label" markdown="1">将请求交付 <code>Scheduler.schedule()</code> 进行调度决策</span>
</div>
</div>
</div>

</div>
</div>
</div>

<!-- ─── Layer 2: Scheduler ─── -->
<div class="arch-layer" data-layer="scheduler" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">⚙️</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">调度决策层</span>
<span class="arch-layer-subtitle" markdown="1">Scheduler · 等待/运行队列 · 抢占 · 推测解码 · KVConnector</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a href="../api/scheduler/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">Scheduler.schedule()</span>
<span class="arch-comp-desc" markdown="1">统一 token 预算调度，决定每步执行哪些请求</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">waiting / skipped_waiting</span>
<span class="arch-comp-desc" markdown="1">等待队列：缓存不足时挂起请求</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">running</span>
<span class="arch-comp-desc" markdown="1">运行队列：已分配缓存、正在执行的请求</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">_preempt_request()</span>
<span class="arch-comp-desc" markdown="1">抢占机制：回收低优先级请求的缓存</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">推测解码支持</span>
<span class="arch-comp-desc" markdown="1">EAGLE / Draft / DFlash 多模式</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KVConnector</span>
<span class="arch-comp-desc" markdown="1">分布式 KV 传输，跨节点缓存同步</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">EncoderCacheManager</span>
<span class="arch-comp-desc" markdown="1">多模态编码器缓存管理</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 上下游</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-up" markdown="1">
<span class="arch-conn-arrow" markdown="1">↑</span>
<span class="arch-conn-label" markdown="1">由 <code>EngineCore</code> 调用</span>
</div>
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↓</span>
<span class="arch-conn-label" markdown="1">调用 <code>KVCacheManager</code> 分配缓存；调用 <code>ModelRunner</code> 执行推理</span>
</div>
</div>
</div>

</div>
</div>
</div>

<!-- ─── Layer 3: Coordinator ─── -->
<div class="arch-layer" data-layer="coordinator" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">🔀</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">缓存协调层</span>
<span class="arch-layer-subtitle" markdown="1">KVCacheCoordinator (ABC) · NoPrefixCache · Unitary · Hybrid · SpecGroup</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a href="../api/kv_cache_coordinator/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KVCacheCoordinator (ABC)</span>
<span class="arch-comp-desc" markdown="1">协调器抽象基类，定义统一接口</span>
</a>

<a href="../api/kv_cache_coordinator/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">NoPrefixCache</span>
<span class="arch-comp-desc" markdown="1">无前缀缓存模式，每次全量分配</span>
</a>

<a href="../api/kv_cache_coordinator/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">Unitary</span>
<span class="arch-comp-desc" markdown="1">单缓存组，一种注意力类型</span>
</a>

<a href="../api/kv_cache_coordinator/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">Hybrid</span>
<span class="arch-comp-desc" markdown="1">混合多缓存组，不动点迭代协调</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">get_kv_cache_coordinator()</span>
<span class="arch-comp-desc" markdown="1">工厂函数，按模型配置创建协调器</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">SpecGroup</span>
<span class="arch-comp-desc" markdown="1">规格分组单元，按块大小分组管理</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 上下游</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-up" markdown="1">
<span class="arch-conn-arrow" markdown="1">↑</span>
<span class="arch-conn-label" markdown="1">由 <code>KVCacheManager</code> 调用，通过工厂函数创建</span>
</div>
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↓</span>
<span class="arch-conn-label" markdown="1">委托 <code>SingleTypeKVCacheManager × N</code> 执行各类型缓存操作</span>
</div>
</div>
</div>

</div>
</div>
</div>

<!-- ─── Layer 4: Cache Manager ─── -->
<div class="arch-layer" data-layer="cache" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">📦</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">缓存管理层</span>
<span class="arch-layer-subtitle" markdown="1">KVCacheManager · KVCacheBlocks · SingleTypeKVCacheManager · allocate_slots</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a href="../api/kv_cache_manager/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KVCacheManager</span>
<span class="arch-comp-desc" markdown="1">统一缓存管理器入口，对外暴露 allocate / free</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KVCacheBlocks</span>
<span class="arch-comp-desc" markdown="1">缓存块数据结构，按组组织块列表</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">SingleTypeKVCacheManager</span>
<span class="arch-comp-desc" markdown="1">单类型缓存管理：全注意力 / 滑动窗口 / Mamba / 交叉注意力</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">find_longest_cache_hit()</span>
<span class="arch-comp-desc" markdown="1">前缀命中查找，复用已计算 KV 块</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">allocate_slots()</span>
<span class="arch-comp-desc" markdown="1">槽位分配核心：命中块复用 + 新块分配</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">free / pop_blocks_for_free</span>
<span class="arch-comp-desc" markdown="1">块释放接口，支持立即释放与延迟释放</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">retention_interval</span>
<span class="arch-comp-desc" markdown="1">稀疏缓存保留策略</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 上下游</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-up" markdown="1">
<span class="arch-conn-arrow" markdown="1">↑</span>
<span class="arch-conn-label" markdown="1">由 <code>Scheduler</code> 调用，入口为 <code>allocate_slots()</code></span>
</div>
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↓</span>
<span class="arch-conn-label" markdown="1">向下委托 <code>KVCacheCoordinator</code> 协调多类型；最终操作 <code>BlockPool</code></span>
</div>
</div>
</div>

</div>
</div>
</div>

<!-- ─── Layer 5: Block Pool ─── -->
<div class="arch-layer" data-layer="pool" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">💾</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">物理块池层</span>
<span class="arch-layer-subtitle" markdown="1">BlockPool · BlockHashToBlockMap · FreeQueue · evict_blocks · 指标收集</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a href="../api/block_pool/" class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">BlockPool</span>
<span class="arch-comp-desc" markdown="1">全局物理块池：分配、释放、驱逐、前缀缓存</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">BlockHashToBlockMap</span>
<span class="arch-comp-desc" markdown="1">哈希 → 块 双向索引，加速前缀命中查找</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">FreeKVCacheBlockQueue</span>
<span class="arch-comp-desc" markdown="1">空闲块队列，O(1) 获取与归还</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">cached_block_hash_to_block</span>
<span class="arch-comp-desc" markdown="1">前缀缓存块表，LRU 体系核心</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">evict_blocks()</span>
<span class="arch-comp-desc" markdown="1">LRU 驱逐策略：最久未用优先回收</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">null_block</span>
<span class="arch-comp-desc" markdown="1">空块占位符，填充无效槽位</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KV Event Queue</span>
<span class="arch-comp-desc" markdown="1">事件驱动可观测，追踪分配/释放事件</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">KVCacheMetricsCollector</span>
<span class="arch-comp-desc" markdown="1">指标收集器：命中率、使用率、驱逐次数</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 上下游</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-up" markdown="1">
<span class="arch-conn-arrow" markdown="1">↑</span>
<span class="arch-conn-label" markdown="1">由 <code>SingleTypeKVCacheManager</code> 直接操作</span>
</div>
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↓</span>
<span class="arch-conn-label" markdown="1">物理块被 <code>Attention Backend</code> 读写，写入 KV 值</span>
</div>
</div>
</div>

</div>
</div>
</div>

<!-- ─── Layer 6: Model ─── -->
<div class="arch-layer" data-layer="model" data-open="false" markdown="1">
<button class="arch-layer-header" aria-expanded="false" markdown="1">
<span class="arch-layer-icon" markdown="1">🚀</span>
<span class="arch-layer-info" markdown="1">
<span class="arch-layer-title" markdown="1">模型执行层</span>
<span class="arch-layer-subtitle" markdown="1">ModelRunner · Attention Backend</span>
</span>
<span class="arch-layer-chevron" markdown="1">▸</span>
</button>
<div class="arch-layer-body" hidden markdown="1">
<div class="arch-layer-body-inner" markdown="1">

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔧 组件</div>
<div class="arch-components" markdown="1">

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">ModelRunner</span>
<span class="arch-comp-desc" markdown="1">模型执行器：构建输入张量、执行前向传播、采样</span>
</a>

<a class="arch-component" markdown="1">
<span class="arch-comp-name" markdown="1">Attention Backend</span>
<span class="arch-comp-desc" markdown="1">根据 slot_mapping 将 KV 值写入对应物理块位置</span>
</a>

</div>
</div>

<div class="arch-subsection" markdown="1">
<div class="arch-subsection-label" markdown="1">🔗 上下游</div>
<div class="arch-connections" markdown="1">
<div class="arch-conn-up" markdown="1">
<span class="arch-conn-arrow" markdown="1">↑</span>
<span class="arch-conn-label" markdown="1">由 <code>Scheduler</code> 调用 <code>ModelRunner</code> 执行推理</span>
</div>
<div class="arch-conn-down" markdown="1">
<span class="arch-conn-arrow" markdown="1">↕</span>
<span class="arch-conn-label" markdown="1"><code>Attention Backend</code> 读写 <code>BlockPool</code> 中的物理块</span>
</div>
</div>
</div>

</div>
</div>
</div>

</div>
<!-- ═══════════════ End Architecture Explorer ═══════════════ -->

</div>

---

<div class="arch-section" markdown="1">

## 三、前缀缓存命中查询流程

<div class="arch-section-desc" markdown="1">
新请求进入调度时，首先执行前缀缓存命中查找，尽可能复用已计算的 KV 块，避免重复计算。
</div>

<div class="arch-diagram" markdown="1">
<div class="arch-diagram-header" markdown="1">🔍 命中查找路径 · 从 Scheduler → KVCacheCoordinator → BlockPool</div>
<div class="arch-diagram-body" markdown="1">

```mermaid
flowchart TD
    Start(["新请求进入调度"]) --> GetBlocks["Scheduler 调用<br>kv_cache_manager.get_computed_blocks()"]
    GetBlocks --> Coord["KVCacheCoordinator.find_longest_cache_hit()"]

    Coord --> CheckType{"协调器类型?"}

    CheckType -->|"无前缀缓存"| NoCache["返回空列表, hit_len=0"]
    CheckType -->|"单缓存组"| Unitary["UnitaryKVCacheCoordinator<br>直接委托 SingleType 管理器"]
    CheckType -->|"混合多组"| Hybrid["HybridKVCacheCoordinator<br>不动点迭代算法"]

    Unitary --> SingleMgr["SingleTypeKVCacheManager<br>.find_longest_cache_hit()"]
    Hybrid --> Split["按 SpecGroup 规格分组<br>全注意力组前置"]
    Split --> Iter["初始 max_hit_len = 最大值<br>逐组校验并收敛"]
    Iter --> Converge{"长度是否收敛?"}
    Converge -->|"否"| Iter
    Converge -->|"是"| EagleCheck{"含 EAGLE 组?"}
    EagleCheck -->|"是"| EagleDrop["多匹配 1 块后丢弃尾块<br>保证边界正确"]
    EagleCheck -->|"否"| HitResult

    SingleMgr --> BlockPoolLookup["BlockPool.get_cached_block()<br>逐哈希块查表"]
    BlockPoolLookup --> HashLookup["BlockHashToBlockMap<br>哈希 → 块 双向索引"]
    HashLookup --> Touch["命中则 touch() 更新 LRU 时间"]

    NoCache --> HitResult(["返回命中块列表 + 命中 token 数"])
    EagleDrop --> HitResult
    Touch --> HitResult

    HitResult --> Alloc["进入 allocate_slots()<br>分配剩余新块"]

    classDef startend fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20,stroke-width:2px
    classDef process fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#fff9c4,stroke:#f9a825,color:#f57f17

    class Start,HitResult startend
    class GetBlocks,Coord,Unitary,Hybrid,Split,Iter,EagleDrop,SingleMgr,BlockPoolLookup,HashLookup,Touch,Alloc,NoCache process
    class CheckType,Converge,EagleCheck decision
```

</div>
</div>

<details class="arch-details" markdown="1">
<summary markdown="1">📖 混合组不动点迭代说明</summary>
<div class="arch-details-body" markdown="1">
对于多层混合注意力模型（部分全注意力 + 部分滑动窗口），不同组的块大小、缓存策略不同，**不动点迭代算法**保证所有组最终认可同一个命中长度：

1. 初始命中长度设为最大值
2. 依次让每个规格组校验该长度，不满足则缩短
3. 长度单调递减，最终收敛到所有组都认可的最长公共前缀
</div>
</details>

</div>

---

<div class="arch-section" markdown="1">

## 四、KV 块分配完整流程

<div class="arch-section-desc" markdown="1">
调度器确认准入后，调用 <code>allocate_slots()</code> 完成块分配，包含前缀命中块复用 + 新块分配两阶段。
</div>

<div class="arch-diagram" markdown="1">
<div class="arch-diagram-header" markdown="1">📦 分配流程 · 两阶段安全分配：先 touch 命中块 → 再分配新块</div>
<div class="arch-diagram-body" markdown="1">

```mermaid
flowchart TD
    Start(["allocate_slots() 入口"]) --> CheckWatermark["检查水位线<br>watermark_blocks 保护"]
    CheckWatermark --> WatermarkOK{"空闲块 ≥ 水位线?"}
    WatermarkOK -->|"否"| FailNone(["返回 None<br>分配失败,触发抢占"])

    WatermarkOK -->|"是"| CalcNeed["计算各组需要的总块数<br>get_num_blocks_to_allocate()"]
    CalcNeed --> CheckFullFit{"full_sequence_must_fit?<br>完整序列准入校验"}

    CheckFullFit -->|"是"| FullFitCheck{"完整序列能放入?"}
    FullFitCheck -->|"否"| FailNone

    FullFitCheck -->|"是"| Phase1
    CheckFullFit -->|"否"| Phase1

    subgraph Phase1["阶段一：前缀命中块分配"]
        TouchAll["两阶段安全分配<br>先全量 touch 所有组的命中块<br>防止前序驱逐后序命中块"]
        TouchAll --> AllocComputed["allocate_new_computed_blocks()<br>分配已计算的命中块"]
    end

    Phase1 --> Phase2

    subgraph Phase2["阶段二：新块分配"]
        AllocNew["allocate_new_blocks()<br>为剩余 token 分配新物理块"]
        AllocNew --> BlockPoolGet["BlockPool.get_new_blocks()<br>从空闲队列取块"]
        BlockPoolGet --> EvictCheck{"空闲块不足?"}
        EvictCheck -->|"是"| Evict["_maybe_evict_cached_block()<br>LRU 驱逐前缀缓存块"]
        Evict --> BlockPoolGet
    end

    Phase2 --> BuildBlocks["构建 KVCacheBlocks 结构<br>按组组织块列表"]
    BuildBlocks --> ReturnBlocks(["返回 KVCacheBlocks + 新块数"])

    classDef startend fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20,stroke-width:2px
    classDef process fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#fff9c4,stroke:#f9a825,color:#f57f17
    classDef phase fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c,stroke-dasharray: 5 5

    class Start,FailNone,ReturnBlocks startend
    class CheckWatermark,CalcNeed,TouchAll,AllocComputed,AllocNew,BlockPoolGet,Evict,BuildBlocks process
    class WatermarkOK,CheckFullFit,FullFitCheck,EvictCheck decision
    class Phase1,Phase2 phase
```

</div>
</div>

<details class="arch-details" markdown="1">
<summary markdown="1">📖 两阶段安全分配的意义</summary>
<div class="arch-details-body" markdown="1">
跨多个缓存组时，如果一组一组地分配，前一组分配新块时可能驱逐掉后一组尚未引用的前缀命中块。**先全量 touch 所有命中块，再分配新块**，彻底避免该竞态问题。
</div>
</details>

</div>

---

<div class="arch-section" markdown="1">

## 五、块释放与驱逐流程

<div class="arch-section-desc" markdown="1">
请求完成、被抢占或滑动窗口移出时，触发块释放。释放路径分为「立即释放」与「延迟释放」两种。
</div>

<div class="arch-diagram" markdown="1">
<div class="arch-diagram-header" markdown="1">🗑️ 释放驱逐路径 · 逆序归还 · 引用计数共享 · 延迟释放栅栏 · 分级 LRU</div>
<div class="arch-diagram-body" markdown="1">

```mermaid
flowchart TD
    Start(["请求结束 / 抢占 / 窗口移出"]) --> WhichFree{"释放模式?"}

    WhichFree -->|"普通单批次"| Immediate["Scheduler._free_blocks()<br>立即释放"]
    WhichFree -->|"多批次重叠 + KV连接器"| Deferred["Scheduler._free_request_blocks()<br>取出块加入延迟队列"]

    Immediate --> MgrFree["KVCacheManager.free(request_id)"]
    Deferred --> DeferQueue["deferred_frees 队列<br>按步骤序号栅栏"]
    DeferQueue --> Drain["_drain_deferred_frees()<br>processed_step ≥ fence_seq 时释放"]
    Drain --> PoolFree

    MgrFree --> CoordFree["KVCacheCoordinator.free()<br>逐组释放"]
    CoordFree --> SingleFree["SingleTypeKVCacheManager.free()"]
    SingleFree --> PopBlocks["pop_blocks_for_free()<br>按分配顺序取出块"]
    PopBlocks --> ReverseFree["逆序归还 BlockPool<br>尾块优先进入空闲队列<br>提升前缀缓存复用率"]

    ReverseFree --> PoolFree["BlockPool.free_blocks()"]

    PoolFree --> RefCheck{"引用计数 == 0?"}
    RefCheck -->|"前缀缓存块仍被引用"| DecRef["仅 decref<br>块继续保留在缓存中"]
    RefCheck -->|"无引用"| BackToQueue["归还到空闲块队列尾部"]

    BackToQueue --> EvictCheck{"缓存开启且块完整?"}
    EvictCheck -->|"是"| CacheInsert["写入 cached_block_hash_to_block<br>纳入前缀缓存 LRU 体系"]
    EvictCheck -->|"否"| Done(["释放完成"])

    DecRef --> Done
    CacheInsert --> Done

    EvictTrigger(["分配时空间不足<br>触发主动驱逐"]) --> EvictBlocks["BlockPool.evict_blocks()"]
    EvictBlocks --> LRUSort["按 LRU 时间排序<br>最久未用优先驱逐"]
    LRUSort --> RemoveCache["从 cached 表中移除"]
    RemoveCache --> BackToQueue

    classDef startend fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20,stroke-width:2px
    classDef process fill:#e3f2fd,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#fff9c4,stroke:#f9a825,color:#f57f17

    class Start,Done,EvictTrigger startend
    class Immediate,Deferred,MgrFree,CoordFree,SingleFree,PopBlocks,ReverseFree,PoolFree,DecRef,BackToQueue,CacheInsert,DeferQueue,Drain,EvictBlocks,LRUSort,RemoveCache process
    class WhichFree,RefCheck,EvictCheck decision
```

</div>
</div>

<details class="arch-details" markdown="1">
<summary markdown="1">📖 关键设计细节</summary>
<div class="arch-details-body" markdown="1">

1. **逆序归还**：尾部块先归还，下次分配时优先拿到尾部块，提升前缀缓存连续命中概率
2. **引用计数共享**：同一块可被多个请求的前缀缓存共享引用，只有引用归零才真正释放
3. **延迟释放栅栏**：多批次重叠场景下，按 `processed_step_seq` 栅栏安全释放，防止异步写入时块被重新分配
4. **分级 LRU**：空闲块队列 + 缓存块表形成两级 LRU，缓存块被驱逐后进入空闲队列，可二次利用

</div>
</details>

</div>

---

<div class="arch-section" markdown="1">

## 六、推测解码（EAGLE）KV 特殊处理

<div class="arch-section-desc" markdown="1">
EAGLE 推测解码在 KV 缓存层有特殊适配，贯穿命中查找、块分配、缓存写入全链路。
</div>

<div class="arch-diagram" markdown="1">
<div class="arch-diagram-header" markdown="1">🦅 EAGLE 全链路适配 · 四阶段特殊处理</div>
<div class="arch-diagram-body" markdown="1">

```mermaid
flowchart LR
    subgraph Hit["命中查找阶段"]
        A["多匹配 1 个 lookahead 块<br>然后丢弃尾部块"]
    end

    subgraph Alloc["块分配阶段"]
        B["额外分配 num_lookahead_tokens 槽位<br>存放草稿 token 的 KV"]
    end

    subgraph Cache["缓存写入阶段"]
        C["多缓存 1 个 lookahead 块<br>与命中逻辑对齐"]
    end

    subgraph Free["块释放阶段"]
        D["EAGLE 组标记为 eagle_group_ids<br>尾块特殊丢弃逻辑"]
    end

    Hit --> Alloc --> Cache --> Free

    classDef phase fill:#e8f5e9,stroke:#388e3c,color:#1b5e20
    class Hit,Alloc,Cache,Free phase
```

</div>
</div>

</div>
