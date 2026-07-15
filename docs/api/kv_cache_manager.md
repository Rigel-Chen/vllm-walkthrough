# KVCacheManager 缓存管理器

`KVCacheManager` 是 KV 缓存系统对外的统一入口，向上对接调度器（Scheduler），向下协调 `KVCacheCoordinator` 与 `BlockPool` 完成具体的缓存操作。它屏蔽了多缓存组、前缀缓存、推测解码等复杂实现细节，为调度层提供简洁一致的分配、释放、命中查询接口。

其返回值 `KVCacheBlocks` 是调度器与缓存管理器之间的接口数据结构，用于隐藏内部实现细节。

---

# `KVCacheBlocks` 缓存块数据结构

`KVCacheBlocks` 是 `KVCacheManager` 的分配结果对象，作为调度器与缓存管理器之间的接口层，隐藏 `KVCacheManager` 内部数据结构的细节。外层元组对应不同的 KV 缓存组，内层序列对应每组中的物理块。

## 一、核心代码与方法

```python
@dataclass
class KVCacheBlocks:
    blocks: tuple[Sequence[KVCacheBlock], ...]

    def __add__(self, other: "KVCacheBlocks") -> "KVCacheBlocks":
        """Adds two KVCacheBlocks instances."""
        return KVCacheBlocks(
            tuple(
                list(itertools.chain(blk1, blk2))
                for blk1, blk2 in zip(self.blocks, other.blocks)
            )
        )

    @overload
    def get_block_ids(
        self,
        allow_none: Literal[False] = False,
    ) -> tuple[list[int], ...]: ...

    @overload
    def get_block_ids(
        self,
        allow_none: Literal[True] = True,
    ) -> tuple[list[int], ...] | None: ...

    def get_block_ids(
        self,
        allow_none: bool = False,
    ) -> tuple[list[int], ...] | None:
        """
        Converts the KVCacheBlocks instance to block_ids.
        """
        if allow_none and all(len(group) == 0 for group in self.blocks):
            return None
        return tuple([blk.block_id for blk in group] for group in self.blocks)

    def get_unhashed_block_ids(self) -> list[int]:
        """Get block_ids of unhashed blocks from KVCacheBlocks instance."""
        assert len(self.blocks) == 1, "Only one group is supported"
        return [block.block_id for block in self.blocks[0] if block.block_hash is None]

    def get_unhashed_block_ids_all_groups(self) -> list[list[int]]:
        """Get block_ids of unhashed blocks from KVCacheBlocks instance."""
        return [
            [
                block.block_id
                for block in group
                if block.block_hash is None and not block.is_null
            ]
            for group in self.blocks
        ]

    def new_empty(self) -> "KVCacheBlocks":
        """Creates a new KVCacheBlocks instance with no blocks."""
        return KVCacheBlocks(tuple(() for _ in range(len(self.blocks))))
```

### `KVCacheBlocks` 类方法功能说明

| 方法名 | 功能 | 返回值 / 备注 |
|--------|----------|----------------|
| `__add__(other)` | 将两个 `KVCacheBlocks` 实例的 block 列表按组拼接，返回新的 `KVCacheBlocks` 对象。 | 新实例，其 `blocks` 为每组对应拼接后的结果。 |
| `get_block_ids(allow_none=False)` | 将 `KVCacheBlocks` 转换为 block_id 元组。外元组对应 KV cache 组，内列表包含该组所有 block 的 ID。若 `allow_none=True` 且所有组均为空，则返回 `None`。 | `tuple[list[int], ...]` 或 `None`。 |
| `get_unhashed_block_ids()` | 获取**未哈希**的 block 的 ID 列表（仅支持单个 KV cache 组）。 | `list[int]`，其中每个 ID 对应的 block 的 `block_hash` 为 `None`。 |
| `get_unhashed_block_ids_all_groups()` | 获取所有组中未哈希的 block 的 ID 列表（二维列表，跳过 padding 空块）。 | `list[list[int]]`，外层按组索引，内层为未哈希且非空块的 ID。 |
| `new_empty()` | 创建一个不含任何 block 的空 `KVCacheBlocks` 实例（每组都为空元组）。 | `KVCacheBlocks`，结构与原实例组数相同，但每组均为空。 |

---

### 类属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| `blocks` | `tuple[Sequence[KVCacheBlock], ...]` | 核心数据结构。`blocks[i][j]` 表示第 `i` 个 KV cache 组中的第 `j` 个 token block。每个元素为 `KVCacheBlock` 对象（或空元组）。 |

---

# `KVCacheManager` 类功能说明

## 一、初始化与核心属性

```python
class KVCacheManager:
    def __init__(
        self,
        kv_cache_config: KVCacheConfig,
        max_model_len: int,
        scheduler_block_size: int,
        hash_block_size: int,
        max_in_flight_tokens: int | None = None,
        enable_caching: bool = True,
        use_eagle: bool = False,
        log_stats: bool = False,
        enable_kv_cache_events: bool = False,
        dcp_world_size: int = 1,
        pcp_world_size: int = 1,
        metrics_collector: KVCacheMetricsCollector | None = None,
        watermark: float = 0.0,
    ) -> None:
        self.max_model_len = max_model_len
        self.enable_caching = enable_caching
        self.use_eagle = use_eagle
        self.log_stats = log_stats
        self.metrics_collector = metrics_collector
        self.prefix_cache_stats = PrefixCacheStats() if log_stats else None

        self.coordinator = get_kv_cache_coordinator(...)
        self.num_kv_cache_groups = len(kv_cache_config.kv_cache_groups)
        self.block_pool = self.coordinator.block_pool
        self.kv_cache_config = kv_cache_config
        self.watermark_blocks = int(watermark * kv_cache_config.num_blocks)
        self.kv_cache_event_metadata = tuple(...)

        self.empty_kv_cache_blocks = KVCacheBlocks(
            tuple(() for _ in range(self.num_kv_cache_groups))
        )
```

### 类属性说明
| 属性 | 类型 | 说明 |
|------|------|------|
| `max_model_len` | `int` | 模型支持的最大序列长度 |
| `enable_caching` | `bool` | 全局前缀缓存开关 |
| `use_eagle` | `bool` | 是否启用 Eagle 推测解码 |
| `log_stats` | `bool` | 是否记录前缀缓存统计指标 |
| `metrics_collector` | `KVCacheMetricsCollector` \| `None` | 外部指标收集器，用于监控系统集成 |
| `prefix_cache_stats` | `PrefixCacheStats` \| `None` | 前缀缓存运行时统计，仅 `log_stats=True` 时有效 |
| `coordinator` | `KVCacheCoordinator` | 核心协调器，所有缓存操作的实际执行者 |
| `num_kv_cache_groups` | `int` | KV 缓存组数量，对应模型不同层的缓存配置 |
| `block_pool` | `BlockPool` | 物理块池，管理所有 GPU 内存中的 KV 块 |
| `kv_cache_config` | `KVCacheConfig` | 完整的 KV 缓存配置对象 |
| `watermark_blocks` | `int` | 水位线预留块数，避免等待/抢占请求频繁触发抢占 |
| `kv_cache_event_metadata` | `tuple[tuple[str, int], ...]` | 每个缓存组的元数据（类型+滑动窗口大小），用于事件注解 |
| `empty_kv_cache_blocks` | `KVCacheBlocks` | 预构造的空缓存实例，全局复用避免 GC 开销 |

---

## 二、缓存状态查询与统计

```python
    @property
    def usage(self) -> float:
        return self.block_pool.get_usage()

    def make_prefix_cache_stats(self) -> PrefixCacheStats | None:
        if not self.log_stats:
            return None
        stats = self.prefix_cache_stats
        self.prefix_cache_stats = PrefixCacheStats()
        return stats

    def get_computed_blocks(self, request: Request) -> tuple[KVCacheBlocks, int]:
        if not self.enable_caching or request.skip_reading_prefix_cache:
            return self.empty_kv_cache_blocks, 0

        max_cache_hit_length = request.num_tokens - 1
        computed_blocks, num_hits = self.coordinator.find_longest_cache_hit(
            request.block_hashes, max_cache_hit_length
        )

        if self.log_stats:
            self.prefix_cache_stats.record(...)

        return self.create_kv_cache_blocks(computed_blocks), num_hits
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `usage` (property) | 获取当前 KV 缓存整体使用率 | `float`，范围 0.0（完全空闲）~ 1.0（完全占满） |
| `make_prefix_cache_stats()` | 获取并重置前缀缓存统计信息 | `PrefixCacheStats` 包含命中数、命中率等；日志关闭时返回 `None` |
| `get_computed_blocks(request)` | 查找请求的最长前缀缓存命中 | 返回 `(缓存块实例, 命中token数)`；无命中时返回 `(空实例, 0)` |

---

## 三、核心：缓存槽位分配

```python
    def allocate_slots(
        self,
        request: Request,
        num_new_tokens: int,
        num_new_computed_tokens: int = 0,
        new_computed_blocks: KVCacheBlocks | None = None,
        num_lookahead_tokens: int = 0,
        num_external_computed_tokens: int = 0,
        delay_cache_blocks: bool = False,
        num_encoder_tokens: int = 0,
        full_sequence_must_fit: bool = False,
        reserved_blocks: int = 0,
        has_scheduled_reqs: bool = True,
    ) -> KVCacheBlocks | None:
        # 校验参数
        # 计算总已计算 token 数
        # 应用水位线（仅等待/抢占请求）
        # 准入控制（full_sequence_must_fit 时预检查完整序列）
        # 回收滑动窗口外的块
        # 计算所需块数并检查可用空间
        # 分配前缀命中块
        # 分配新物理块
        # 写入前缀缓存（如启用）
        # 返回新分配块
```

### 方法参数与返回值说明
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `request` | `Request` | 待分配缓存的请求对象 |
| `num_new_tokens` | `int` | 需要计算的新 token 数量 |
| `num_new_computed_tokens` | `int` | 本次前缀缓存命中的 token 数量 |
| `new_computed_blocks` | `KVCacheBlocks` \| `None` | 本次命中的缓存块实例 |
| `num_lookahead_tokens` | `int` | 推测解码需要预分配的 token 数量 |
| `num_external_computed_tokens` | `int` | 外部连接器缓存的 token 数量 |
| `delay_cache_blocks` | `bool` | 是否延迟缓存（用于分布式 KV 传输场景） |
| `num_encoder_tokens` | `int` | 编码器-解码器模型中编码器的 token 数量 |
| `full_sequence_must_fit` | `bool` | 准入控制开关：仅当完整序列能放入缓存时才分配 |
| `reserved_blocks` | `int` | 为其他在途请求预留的空闲块数，用于异步 KV 连接器负载控制 |
| `has_scheduled_reqs` | `bool` | 当前步骤是否已有调度请求，控制水位线是否生效 |

| 返回值 | 说明 |
|--------|------|
| `KVCacheBlocks` | 新分配的缓存块实例 |
| `None` | 缓存空间不足，分配失败 |

### 内存布局示意
```
----------------------------------------------------------------------
| < comp > | < new_comp > | < ext_comp >  | < new >  | < lookahead > |
----------------------------------------------------------------------
                                          |   < to be computed >     |
----------------------------------------------------------------------
                          |            < to be allocated >           |
----------------------------------------------------------------------
```
- **comp**: 请求已计算的 token 数
- **new_comp**: 本次前缀缓存命中的 token 数
- **ext_comp**: 外部连接器缓存的 token 数
- **new**: 需要新计算的 token 数
- **lookahead**: 推测解码预分配的 token 数

---

## 四、块获取与创建

```python
    def get_blocks(self, request_id: str) -> KVCacheBlocks:
        return self.create_kv_cache_blocks(self.coordinator.get_blocks(request_id))

    def get_block_ids(self, request_id: str) -> tuple[list[int], ...]:
        return self.get_blocks(request_id).get_block_ids()

    def get_block_ids_for_computed_tokens(
        self,
        request_id: str,
        num_computed_tokens: int,
    ) -> tuple[list[int], ...]:
        """Get block ids covering the request's computed tokens."""

    def create_kv_cache_blocks(
        self, blocks: tuple[list[KVCacheBlock], ...]
    ) -> KVCacheBlocks:
        return KVCacheBlocks(blocks) if any(blocks) else self.empty_kv_cache_blocks
```

### 方法功能说明
| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `get_blocks(request_id)` | 获取指定请求的完整 KV 缓存块 | `KVCacheBlocks` 实例 |
| `get_block_ids(request_id)` | 获取指定请求的缓存块 ID 元组 | 格式同 `KVCacheBlocks.get_block_ids()` |
| `get_block_ids_for_computed_tokens(request_id, num_computed_tokens)` | 获取覆盖已计算 token 的块 ID（按各组块大小裁剪） | `tuple[list[int], ...]`，注意力组会截断到有效块数 |
| `create_kv_cache_blocks(blocks)` | 安全创建 KVCacheBlocks 实例 | 空输入返回全局复用的 `empty_kv_cache_blocks` |

---

## 五、块释放与维护

```python
    def free(self, request: Request) -> None:
        self.coordinator.free(request.request_id)

    def pop_blocks_for_free(self, request: Request) -> list[KVCacheBlock]:
        return self.coordinator.pop_blocks_for_free(request.request_id)

    def remove_skipped_blocks(
        self, request_id: str, processed_computed_tokens: int,
        num_prompt_tokens: int | None = None
    ) -> None:
        self.coordinator.remove_skipped_blocks(...)

    def evict_blocks(self, block_ids: set[int]) -> None:
        self.block_pool.evict_blocks(block_ids)

    def new_step_starts(self) -> None:
        self.coordinator.new_step_starts()
```

### 方法功能说明
| 方法名 | 功能 | 备注 |
|--------|------|------|
| `free(request)` | 释放请求占用的所有缓存块 | 按逆序释放，优先回收尾部块 |
| `pop_blocks_for_free(request)` | 取出请求的块但不归还给块池，由调用方统一逆序释放 | 返回分配顺序的块列表，用于尾块优先驱逐 |
| `remove_skipped_blocks(...)` | 移除不再需要的块（如滑动窗口外的块） | 分配前调用可增加可用空间 |
| `evict_blocks(block_ids)` | 强制驱逐前缀缓存中的指定块 | 用于手动管理缓存内容 |
| `new_step_starts()` | 新推理步骤开始时的钩子函数 | 执行协调器的步骤初始化逻辑 |

---

## 六、前缀缓存管理

```python
    def reset_prefix_cache(self) -> bool:
        if not self.block_pool.reset_prefix_cache():
            return False
        if self.log_stats:
            self.prefix_cache_stats.reset = True
        return True

    def get_num_common_prefix_blocks(self, running_request_id: str) -> list[int]:
        return self.coordinator.get_num_common_prefix_blocks(running_request_id)

    def cache_blocks(self, request: Request, num_computed_tokens: int) -> None:
        if self.enable_caching:
            self.coordinator.cache_blocks(request, num_computed_tokens)
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `reset_prefix_cache()` | 完全清空前缀缓存 | `bool`：是否重置成功；用于权重更新后或基准测试 |
| `get_num_common_prefix_blocks(running_request_id)` | 计算所有运行中请求共享的公共前缀块数 | `list[int]`，每个元素对应一个缓存组的公共块数 |
| `cache_blocks(request, num_computed_tokens)` | 将请求的已计算块加入前缀缓存 | 仅在 `enable_caching=True` 时生效 |

---

## 七、事件与工具方法

```python
    def take_events(self) -> list[KVCacheEvent]:
        events = self.block_pool.take_events()
        for event in events:
            if isinstance(event, BlockStored) and event.group_idx is not None:
                kind, sw = self.kv_cache_event_metadata[event.group_idx]
                event.kv_cache_spec_kind = kind
                event.kv_cache_spec_sliding_window = sw
        return events

    def take_new_block_ids(self) -> list[int]:
        ids: list[int] = []
        for mgr in self.coordinator.single_type_managers:
            ids.extend(mgr.take_new_block_ids())
        return ids
```

### 方法功能说明
| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `take_events()` | 获取并清空块池中的所有 KV 缓存事件 | `list[KVCacheEvent]`，事件已添加缓存组元数据 |
| `take_new_block_ids()` | 获取并清空需要清零的新分配块 ID 列表 | `list[int]`，用于 GPU 内存初始化 |

---

## 核心设计要点

1. **分层架构**：对外提供简洁接口，核心逻辑委托给 `KVCacheCoordinator` 和 `BlockPool`
2. **性能优先**：全局复用空缓存实例，避免频繁对象创建的 GC 开销
3. **内存高效**：自动回收滑动窗口外的块，支持强制驱逐和完整重置
4. **可观测性**：内置统计指标和事件系统，便于监控和调试
5. **扩展性**：支持多缓存组、推测解码、分布式 KV 传输等高级特性
6. **水位线保护**：通过 `watermark_blocks` 预留空闲块，避免等待请求频繁触发抢占
7. **准入控制**：`full_sequence_must_fit` 参数支持分块预填充场景下的完整序列准入校验
8. **异步安全**：`reserved_blocks` 参数为异步 KV 连接器预留空间，防止在途请求饿死
