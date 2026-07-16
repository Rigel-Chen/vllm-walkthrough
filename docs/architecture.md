# KV Cache 调用结构树

本文档采用**流程图即内容**的设计：每张图由可交互的卡片节点和箭头连接线组成。点击总览图中的模块卡片平滑滚动至下方详细流程图；点击详细图中的组件卡片跳转至 API 文档。

---

## 系统架构总览

<div class="arch-overview-subtitle" markdown="1">
点击任意模块卡片 → 平滑滚动至下方对应层的详细流程图
</div>

<div class="fc" markdown="1">

<div class="fc-v" markdown="1">

<!-- Engine -->
<a href="#layer-engine" class="fc-card" data-layer="engine" markdown="1">
<span class="fc-card-name">🧱 引擎入口层</span>
<span class="fc-card-desc">LLMEngine · EngineCoreClient · InputProcessor · OutputProcessor</span>
</a>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1"><code>EngineCore</code> 调用 <code>Scheduler.schedule()</code> 进行调度决策</div>
</div>

<!-- Scheduler -->
<a href="#layer-scheduler" class="fc-card" data-layer="scheduler" markdown="1">
<span class="fc-card-name">⚙️ 调度决策层</span>
<span class="fc-card-desc">Scheduler · 等待/运行队列 · 抢占 · 推测解码 · KVConnector</span>
</a>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">Scheduler 双路分发：缓存路径（调用 KVCacheManager） + 执行路径（调用 ModelRunner）</div>
</div>

<!-- Fork -->
<div class="fc-split" markdown="1">

<div class="fc-split-col" markdown="1">

<!-- Cache chain -->
<a href="#layer-coordinator" class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">🔀 缓存协调层</span>
<span class="fc-card-desc">KVCacheCoordinator · NoPrefixCache · Unitary · Hybrid</span>
</a>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">委托 SingleTypeKVCacheManager</div>
</div>

<a href="#layer-cache" class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">📦 缓存管理层</span>
<span class="fc-card-desc">KVCacheManager · allocate_slots · find_longest_cache_hit</span>
</a>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">操作 BlockPool 分配/释放物理块</div>
</div>

<a href="#layer-pool" class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">💾 物理块池层</span>
<span class="fc-card-desc">BlockPool · FreeQueue · BlockHashToBlockMap · evict_blocks</span>
</a>

</div>

<div class="fc-split-col" markdown="1">

<!-- Model chain -->
<a href="#layer-model" class="fc-card fc-card-sm" data-layer="model" markdown="1">
<span class="fc-card-name">🚀 模型执行层</span>
<span class="fc-card-desc">ModelRunner · Attention Backend</span>
</a>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">Attention Backend 通过 slot_mapping 读写 BlockPool</div>
</div>

</div>
</div>

</div>
</div>

---

## 🧱 引擎入口层 {#layer-engine}

<div class="arch-section-desc" markdown="1">
外部请求入口，封装 OpenAI-compatible API，完成输入预处理后将请求交付给引擎核心。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<a href="../api/llm_engine/" class="fc-card" data-layer="engine" markdown="1">
<span class="fc-card-name">LLMEngine</span>
<span class="fc-card-desc">对外兼容封装，接收用户请求并驱动生成流程</span>
</a>
<span class="fc-arr-r"></span>
<a href="../api/llm_engine/" class="fc-card" data-layer="engine" markdown="1">
<span class="fc-card-name">EngineCoreClient</span>
<span class="fc-card-desc">将请求注册到引擎核心</span>
</a>
<span class="fc-arr-r"></span>
<a href="#layer-scheduler" class="fc-card" data-layer="engine" markdown="1">
<span class="fc-card-name">→ Scheduler.schedule()</span>
<span class="fc-card-desc">交付调度决策层</span>
</a>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">辅助组件</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="engine" markdown="1">
<span class="fc-card-name">InputProcessor</span>
<span class="fc-card-desc">输入预处理：tokenize、prompt 格式化</span>
</div>
<div class="fc-card fc-card-sm" data-layer="engine" markdown="1">
<span class="fc-card-name">OutputProcessor</span>
<span class="fc-card-desc">输出后处理：detokenize、streaming 封装</span>
</div>
</div>

</div>
</div>

---

## ⚙️ 调度决策层 {#layer-scheduler}

<div class="arch-section-desc" markdown="1">
核心调度器，决定每个 step 哪些请求执行、哪些等待或抢占，是缓存路径与执行路径的分叉点。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<a href="../api/scheduler/" class="fc-card" data-layer="scheduler" markdown="1">
<span class="fc-card-name">Scheduler.schedule()</span>
<span class="fc-card-desc">统一 token 预算调度，决定每步执行哪些请求</span>
</a>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">管理请求生命周期</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">waiting</span>
<span class="fc-card-desc">缓存不足时挂起</span>
</div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">running</span>
<span class="fc-card-desc">已分配正在执行</span>
</div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">_preempt_request()</span>
<span class="fc-card-desc">抢占回收低优先级缓存</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">扩展能力</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">推测解码</span>
<span class="fc-card-desc">EAGLE / Draft / DFlash</span>
</div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">KVConnector</span>
<span class="fc-card-desc">分布式 KV 传输</span>
</div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">EncoderCacheMgr</span>
<span class="fc-card-desc">多模态编码器缓存</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1"><b>双路分发</b></div>
</div>

<div class="fc-split" markdown="1">
<div class="fc-split-col" markdown="1">
<a href="#layer-cache" class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">→ 缓存路径</span>
<span class="fc-card-desc">KVCacheManager.allocate_slots()</span>
</a>
</div>
<div class="fc-split-col" markdown="1">
<a href="#layer-model" class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">→ 执行路径</span>
<span class="fc-card-desc">ModelRunner 执行推理</span>
</a>
</div>
</div>

</div>
</div>

---

## 🔀 缓存协调层 {#layer-coordinator}

<div class="arch-section-desc" markdown="1">
抽象多种前缀缓存策略（无缓存 / 单组 / 混合多组），通过工厂模式创建，向下委托各类型缓存管理器。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<a href="../api/kv_cache_coordinator/" class="fc-card" data-layer="coordinator" markdown="1">
<span class="fc-card-name">KVCacheCoordinator (ABC)</span>
<span class="fc-card-desc">抽象基类，定义 find_longest_cache_hit / allocate / free 统一接口</span>
</a>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">工厂函数 <code>get_kv_cache_coordinator()</code> 按模型配置创建具体策略</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">NoPrefixCache</span>
<span class="fc-card-desc">无前缀缓存，每次全量分配</span>
</div>
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">Unitary</span>
<span class="fc-card-desc">单缓存组，一种注意力类型</span>
</div>
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">Hybrid</span>
<span class="fc-card-desc">混合多组，不动点迭代协调</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">Hybrid 策略按 <code>SpecGroup</code> 规格分组，全注意力组前置，逐组校验收敛</div>
</div>

</div>
</div>

---

## 📦 缓存管理层 {#layer-cache}

<div class="arch-section-desc" markdown="1">
统一缓存管理入口，对外暴露 allocate / free 接口，内部协调多类型缓存（全注意力、滑动窗口、Mamba、交叉注意力）。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<a href="../api/kv_cache_manager/" class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">KVCacheManager</span>
<span class="fc-card-desc">统一入口：对外暴露 allocate / free，内部委托给协调器</span>
</a>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">核心操作</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">find_longest_cache_hit()</span>
<span class="fc-card-desc">前缀命中查找，复用已计算 KV 块</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">allocate_slots()</span>
<span class="fc-card-desc">槽位分配：命中块复用 + 新块分配</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">free</span>
<span class="fc-card-desc">块释放（立即/延迟）</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">数据结构 & 辅助</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">KVCacheBlocks</span>
<span class="fc-card-desc">按组组织块列表</span>
</div>
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">SingleTypeKVCacheManager</span>
<span class="fc-card-desc">单类型管理：全注意力 / 滑动窗口 / Mamba / 交叉注意力</span>
</div>
<div class="fc-card fc-card-sm" data-layer="cache" markdown="1">
<span class="fc-card-name">retention_interval</span>
<span class="fc-card-desc">稀疏缓存保留策略</span>
</div>
</div>

</div>
</div>

---

## 💾 物理块池层 {#layer-pool}

<div class="arch-section-desc" markdown="1">
全局物理块池，管理所有 GPU 显存中的 KV 块，提供分配、释放、LRU 驱逐和前缀缓存索引。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<a href="../api/block_pool/" class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">BlockPool</span>
<span class="fc-card-desc">全局物理块池：分配 · 释放 · 驱逐 · 前缀缓存</span>
</a>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">内部数据结构</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">BlockHashToBlockMap</span>
<span class="fc-card-desc">哈希 → 块双向索引</span>
</div>
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">FreeKVCacheBlockQueue</span>
<span class="fc-card-desc">空闲块队列 O(1) 获取</span>
</div>
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">cached_block_hash_to_block</span>
<span class="fc-card-desc">前缀缓存块表 LRU 体系</span>
</div>
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">null_block</span>
<span class="fc-card-desc">空块占位符</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">驱逐 & 可观测</div>
</div>

<div class="fc-row" markdown="1">
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">evict_blocks()</span>
<span class="fc-card-desc">LRU 驱逐：最久未用优先</span>
</div>
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">KVCacheMetricsCollector</span>
<span class="fc-card-desc">命中率 · 使用率 · 驱逐次数</span>
</div>
<div class="fc-card fc-card-sm" data-layer="pool" markdown="1">
<span class="fc-card-name">KV Event Queue</span>
<span class="fc-card-desc">事件驱动可观测</span>
</div>
</div>

</div>
</div>

---

## 🚀 模型执行层 {#layer-model}

<div class="arch-section-desc" markdown="1">
执行模型前向传播，构建 block_table / slot_mapping 张量，通过 Attention Backend 将 KV 值写入物理块。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<div class="fc-card" data-layer="model" markdown="1">
<span class="fc-card-name">ModelRunner</span>
<span class="fc-card-desc">构建输入张量、执行前向传播、采样下一个 token</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card" data-layer="model" markdown="1">
<span class="fc-card-name">Attention Backend</span>
<span class="fc-card-desc">根据 slot_mapping 将 KV 值写入对应物理块位置</span>
</div>
</div>

<div class="fc-arr-group" markdown="1">
<div class="fc-arr-d"></div>
<div class="fc-arr-label" markdown="1">↕ 读写 <code>BlockPool</code> 物理块 · 由 <code>Scheduler</code> 调用</div>
</div>

</div>
</div>

---

## 前缀缓存命中查询流程 {#process-prefix}

<div class="arch-section-desc" markdown="1">
新请求进入调度时，首先执行前缀缓存命中查找，尽可能复用已计算的 KV 块，避免重复计算。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<!-- Start -->
<div class="fc-end" markdown="1">新请求进入调度</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- Step 1 -->
<div class="fc-card" data-layer="scheduler" markdown="1">
<span class="fc-card-name">Scheduler</span>
<span class="fc-card-desc">调用 kv_cache_manager.get_computed_blocks()</span>
</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- Step 2 -->
<div class="fc-card" data-layer="coordinator" markdown="1">
<span class="fc-card-name">KVCacheCoordinator.find_longest_cache_hit()</span>
</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- Decision: Coordinator type? -->
<div class="fc-decision" markdown="1">协调器类型?</div>

<div class="fc-branch" markdown="1">

<div class="fc-branch-col" markdown="1">
<div class="fc-branch-label" markdown="1">无前缀缓存</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">NoPrefixCache</span>
<span class="fc-card-desc">返回空列表, hit_len=0</span>
</div>
</div>

<div class="fc-branch-col" markdown="1">
<div class="fc-branch-label" markdown="1">单缓存组</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">Unitary</span>
<span class="fc-card-desc">直接委托 SingleType 管理器</span>
</div>
</div>

<div class="fc-branch-col" markdown="1">
<div class="fc-branch-label" markdown="1">混合多组</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>
<div class="fc-card fc-card-sm" data-layer="coordinator" markdown="1">
<span class="fc-card-name">Hybrid</span>
<span class="fc-card-desc">不动点迭代算法</span>
</div>
</div>

</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- Iterative convergence (Hybrid path) -->
<div class="fc-card" data-layer="coordinator" markdown="1">
<span class="fc-card-name">按 SpecGroup 规格分组 → 初始 max_hit_len → 逐组校验收敛</span>
<span class="fc-card-desc">长度单调递减，最终收敛到所有组认可的最长公共前缀</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div><div class="fc-arr-label" markdown="1">含 EAGLE 组时：多匹配 1 块后丢弃尾块，保证边界正确</div></div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- BlockPool lookup -->
<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">BlockPool.get_cached_block()</span>
<span class="fc-card-desc">逐哈希块查表 → BlockHashToBlockMap 双向索引 → 命中则 touch() 更新 LRU</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<!-- End -->
<div class="fc-end" markdown="1">返回命中块列表 + 命中 token 数 → 进入 allocate_slots()</div>

</div>
</div>

---

## KV 块分配完整流程 {#process-alloc}

<div class="arch-section-desc" markdown="1">
调度器确认准入后，调用 <code>allocate_slots()</code> 完成块分配：先 touch 命中块防驱逐，再分配新块。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-end" markdown="1">allocate_slots() 入口</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">检查水位线 watermark_blocks</span>
<span class="fc-card-desc">空闲块 ≥ 水位线？不足则返回 None，触发抢占</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">计算各组需要的总块数</span>
<span class="fc-card-desc">get_num_blocks_to_allocate() · full_sequence_must_fit 校验</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div><div class="fc-arr-label" markdown="1"><b>阶段一</b></div></div>

<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">两阶段安全分配</span>
<span class="fc-card-desc">先全量 touch 所有组的命中块，防止前序驱逐后序命中块</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">allocate_new_computed_blocks()</span>
<span class="fc-card-desc">分配已计算的前缀命中块</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div><div class="fc-arr-label" markdown="1"><b>阶段二</b></div></div>

<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">allocate_new_blocks() → BlockPool.get_new_blocks()</span>
<span class="fc-card-desc">从空闲队列取块 · 不足时 _maybe_evict_cached_block() LRU 驱逐</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-end" markdown="1">构建 KVCacheBlocks → 返回块列表 + 新块数</div>

</div>
</div>

---

## 块释放与驱逐流程 {#process-free}

<div class="arch-section-desc" markdown="1">
请求完成/抢占/窗口移出时触发释放。路径分为立即释放与延迟释放（多批次重叠场景），核心机制包括逆序归还、引用计数共享、分级 LRU。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-end" markdown="1">请求结束 / 抢占 / 窗口移出</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-decision" markdown="1">释放模式?</div>

<div class="fc-branch" markdown="1">

<div class="fc-branch-col" markdown="1">
<div class="fc-branch-label" markdown="1">普通单批次</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">_free_blocks()</span>
<span class="fc-card-desc">立即释放</span>
</div>
</div>

<div class="fc-branch-col" markdown="1">
<div class="fc-branch-label" markdown="1">多批次 + KV 连接器</div>
<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>
<div class="fc-card fc-card-sm" data-layer="scheduler" markdown="1">
<span class="fc-card-name">延迟释放队列</span>
<span class="fc-card-desc">deferred_frees 栅栏</span>
</div>
</div>

</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">KVCacheManager.free()</span>
<span class="fc-card-desc">→ KVCacheCoordinator.free() 逐组释放 → SingleTypeKVCacheManager.free()</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">pop_blocks_for_free() 逆序归还</span>
<span class="fc-card-desc">尾块优先进入空闲队列 → 提升前缀缓存连续命中概率</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">BlockPool.free_blocks()</span>
<span class="fc-card-desc">引用计数归零 → 归还空闲队列 → 完整块写入 cached 表纳入 LRU</span>
</div>

<div class="fc-arr-group" markdown="1"><div class="fc-arr-d"></div></div>

<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">主动驱逐：evict_blocks()</span>
<span class="fc-card-desc">分配时空间不足 → LRU 排序 → 最久未用优先 → 从 cached 表移除 → 归还队列</span>
</div>

</div>
</div>

<details class="fc-details" markdown="1">
<summary>📖 关键设计细节</summary>
<div class="fc-details-body" markdown="1">

1. **逆序归还**：尾部块先归还，下次分配时优先拿到尾部块
2. **引用计数共享**：同一块可被多个请求共享引用，归零才真正释放
3. **延迟释放栅栏**：按 `processed_step_seq` 安全释放，防止异步写入冲突
4. **分级 LRU**：空闲块队列 + 缓存块表两级 LRU，可二次利用

</div>
</details>

---

## 推测解码（EAGLE）KV 特殊处理 {#process-eagle}

<div class="arch-section-desc" markdown="1">
EAGLE 推测解码在 KV 缓存层有贯穿全链路的特殊适配：命中查找多匹配 1 块 → 分配额外 lookahead 槽位 → 缓存写入对齐 → 释放时特殊丢弃。
</div>

<div class="fc" markdown="1">
<div class="fc-v" markdown="1">

<div class="fc-row" markdown="1">
<div class="fc-card" data-layer="scheduler" markdown="1">
<span class="fc-card-name">命中查找</span>
<span class="fc-card-desc">多匹配 1 个 lookahead 块<br>然后丢弃尾部块</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card" data-layer="cache" markdown="1">
<span class="fc-card-name">块分配</span>
<span class="fc-card-desc">额外分配 num_lookahead_tokens 槽位<br>存放草稿 token 的 KV</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card" data-layer="pool" markdown="1">
<span class="fc-card-name">缓存写入</span>
<span class="fc-card-desc">多缓存 1 个 lookahead 块<br>与命中逻辑对齐</span>
</div>
<span class="fc-arr-r"></span>
<div class="fc-card" data-layer="model" markdown="1">
<span class="fc-card-name">块释放</span>
<span class="fc-card-desc">eagle_group_ids 标记<br>尾块特殊丢弃逻辑</span>
</div>
</div>

</div>
</div>
