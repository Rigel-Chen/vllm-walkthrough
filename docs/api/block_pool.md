# BlockPool 物理块池管理器

`BlockPool` 是 KV 缓存的底层内存管理器，掌管所有 GPU 物理块的生命周期，负责块分配、释放、前缀缓存索引维护、驱逐策略执行。`KVCacheManager` 与 `KVCacheCoordinator` 的所有块操作最终都会下沉到该类。

其内部依赖 `BlockHashToBlockMap` 作为前缀缓存的核心索引结构，维护「块哈希+缓存组ID」到物理 `KVCacheBlock` 的映射关系。

---

# `BlockHashToBlockMap` 哈希映射表

`BlockHashToBlockMap` 是前缀缓存的核心索引结构，维护「块哈希+缓存组ID」到物理 `KVCacheBlock` 的映射关系。针对绝大多数「单哈希对应单块」的场景做了存储优化，避免嵌套字典带来的 GC 开销。该结构不做重复块去重，保证已分配块ID始终不变，使请求块表保持仅追加特性。

## 一、初始化与核心属性

```python
class BlockHashToBlockMap:
    def __init__(self):
        self._cache: dict[
            BlockHashWithGroupId, KVCacheBlock | dict[int, KVCacheBlock]
        ] = {}
```

### 类属性说明
| 属性 | 类型 | 说明 |
|------|------|------|
| `_cache` | `dict[BlockHashWithGroupId, KVCacheBlock \| dict[int, KVCacheBlock]]` | 核心存储字典。大部分场景值为单个 `KVCacheBlock` 对象；存在重复哈希块时自动升级为块ID到块对象的字典 |

---

## 二、核心查询与操作方法

```python
    def get_one_block(self, key: BlockHashWithGroupId) -> KVCacheBlock | None:
        """Gets any block with the given block hash key."""
        blocks = self._cache.get(key)
        if blocks is not None:
            if isinstance(blocks, KVCacheBlock):
                return blocks
            if isinstance(blocks, dict):
                return next(iter(blocks.values()))
        return None

    def contain(self, key: BlockHashWithGroupId, block_id: int) -> bool:
        """Checks whether the key maps to the given block ID."""

    def insert(self, key: BlockHashWithGroupId, block: KVCacheBlock) -> None:
        """Inserts the KVCacheBlock to the cache"""

    def pop(self, key: BlockHashWithGroupId, block_id: int) -> KVCacheBlock | None:
        """Checks if block_hash exists and pop block_id from the cache"""

    def __len__(self) -> int:
        return len(self._cache)
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `__init__()` | 初始化空的哈希缓存字典 | 内部存储采用「单块对象 + 块ID字典」的联合类型，优化常见场景性能 |
| `get_one_block(key)` | 根据哈希键获取任意一个匹配的缓存块 | 返回 `KVCacheBlock` 实例；无匹配时返回 `None`，用于前缀缓存命中查询 |
| `contain(key, block_id)` | 校验指定块ID是否存在于对应哈希键的映射中 | 返回 `bool`，用于去重和存在性校验 |
| `insert(key, block)` | 将块插入哈希缓存；若键已存在则自动升级为字典存储 | 无返回值，单键多块场景会从 `KVCacheBlock` 自动转为 `dict[int, KVCacheBlock]` |
| `pop(key, block_id)` | 从缓存中移除指定ID的块；移除后若只剩单块则降级回单对象存储 | 返回被移除的 `KVCacheBlock`；键不存在或ID不匹配时返回 `None` |
| `__len__()` | 返回缓存中不同哈希键的总数 | `int`，用于统计缓存条目规模 |

---

# `BlockPool` 物理块池管理器

## 一、初始化与核心属性

```python
class BlockPool:
    def __init__(
        self,
        num_gpu_blocks: int,
        enable_caching: bool,
        hash_block_size: int,
        enable_kv_cache_events: bool = False,
        metrics_collector: KVCacheMetricsCollector | None = None,
    ):
        self.num_gpu_blocks = num_gpu_blocks
        self.enable_caching = enable_caching
        self.hash_block_size = hash_block_size

        self.blocks: list[KVCacheBlock] = [
            KVCacheBlock(idx) for idx in range(num_gpu_blocks)
        ]
        self.free_block_queue = FreeKVCacheBlockQueue(self.blocks)
        self.cached_block_hash_to_block: BlockHashToBlockMap = BlockHashToBlockMap()
        self.cached_block_hashes_by_block: dict[int, set[BlockHashWithGroupId]] = {}

        self.null_block = self.free_block_queue.popleft()
        self.null_block.is_null = True

        self.enable_kv_cache_events = enable_kv_cache_events
        self.kv_event_queue: list[KVCacheEvent] = []
        self.metrics_collector = metrics_collector
```

### 类属性说明
| 属性 | 类型 | 说明 |
|------|------|------|
| `num_gpu_blocks` | `int` | GPU 上 KV 缓存的总物理块数量 |
| `enable_caching` | `bool` | 是否启用前缀缓存功能 |
| `hash_block_size` | `int` | 计算块哈希的基础 token 粒度，实际缓存块大小可以是它的整数倍 |
| `blocks` | `list[KVCacheBlock]` | 所有物理块的数组，下标与 `block_id` 一一对应，全局唯一索引 |
| `free_block_queue` | `FreeKVCacheBlockQueue` | 空闲块双向链表队列，实现 LRU 驱逐顺序管理 |
| `cached_block_hash_to_block` | `BlockHashToBlockMap` | 前缀缓存哈希索引，支持按哈希快速查找命中块 |
| `cached_block_hashes_by_block` | `dict[int, set[BlockHashWithGroupId]]` | 反向索引：按块ID存储其关联的所有哈希键，支持块驱逐时批量清理索引 |
| `null_block` | `KVCacheBlock` | 占位空块（ID=0），用于填充无效槽位，引用计数不维护、永不释放 |
| `enable_kv_cache_events` | `bool` | 是否开启 KV 缓存事件上报 |
| `kv_event_queue` | `list[KVCacheEvent]` | 待消费的事件队列，存储块存储、移除、清空等事件 |
| `metrics_collector` | `KVCacheMetricsCollector` \| `None` | 指标收集器，用于块分配、驱逐、访问的埋点统计 |

---

## 二、前缀缓存块查找

```python
    def get_cached_block(
        self, block_hash: BlockHash, kv_cache_group_ids: list[int]
    ) -> list[KVCacheBlock] | None:
        """Get the cached block by the block hash for each group in
        `kv_cache_group_ids`, or None if cache miss for any group.
        """
        cached_blocks = []
        for group_id in kv_cache_group_ids:
            block_hash_with_group_id = make_block_hash_with_group_id(
                block_hash, group_id
            )
            block = self.cached_block_hash_to_block.get_one_block(
                block_hash_with_group_id
            )
            if not block:
                return None
            cached_blocks.append(block)
        return cached_blocks
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `get_cached_block(block_hash, kv_cache_group_ids)` | 按块哈希批量查询多个缓存组的命中块 | 全部组命中时返回对应块列表；任意一组未命中返回 `None`，保证前缀匹配的完整性 |

---

## 三、块缓存写入：完整块与部分块

### 核心代码片段
```python
    def cache_full_blocks(
        self,
        request: Request,
        blocks: list[KVCacheBlock],
        num_cached_blocks: int,
        num_full_blocks: int,
        block_size: int,
        kv_cache_group_id: int,
        block_mask: list[bool] | None = None,
    ) -> None:
        """Cache a list of full blocks for prefix caching."""

    def cache_partial_block(
        self,
        request: Request,
        block: KVCacheBlock,
        num_tokens: int,
        kv_cache_group_id: int,
        block_size: int,
    ) -> BlockHashWithGroupId | None:
        """Register a partial prefix-cache entry for an existing block."""
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `cache_full_blocks(...)` | 将请求的完整满块批量加入前缀缓存，支持滑动窗口掩码过滤 | 无返回值；自动处理哈希元数据更新、旧哈希清理、`BlockStored` 事件上报 |
| `cache_partial_block(...)` | 为已有物理块注册细粒度的部分前缀索引，无需分配新块 | 返回注册的哈希键；空块返回 `None`，用于大缓存块场景下的亚块级前缀命中 |

### 方法参数说明（cache_full_blocks）
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `request` | `Request` | 待缓存的请求对象，提供 block_hashes 与 token_ids |
| `blocks` | `list[KVCacheBlock]` | 请求的所有缓存块列表 |
| `num_cached_blocks` | `int` | 已缓存的块数量，作为增量更新起点 |
| `num_full_blocks` | `int` | 本次更新后完整满块的总数 |
| `block_size` | `int` | 每个缓存块包含的 token 数 |
| `kv_cache_group_id` | `int` | 当前操作所属的 KV 缓存组索引 |
| `block_mask` | `list[bool]` \| `None` | 可选掩码，标记哪些块需要跳过（如滑动窗口尾部块），为 False 的块不进入前缀缓存 |

### 方法参数说明（cache_partial_block）
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `request` | `Request` | 提供前缀哈希链的请求对象 |
| `block` | `KVCacheBlock` | 已存在的物理块，为其注册部分前缀入口 |
| `num_tokens` | `int` | 部分前缀对应的 token 长度，必须是 hash_block_size 的整数倍 |
| `kv_cache_group_id` | `int` | 所属缓存组索引 |
| `block_size` | `int` | 该组的完整块大小，用于校验部分块确实未满 |

### 内部辅助方法
| 方法名 | 功能 |
|--------|------|
| `_insert_block_hash(...)` | 底层哈希插入逻辑，处理主哈希与额外哈希键的存储 |
| `_remove_cached_block_hashes(block)` | 清理块关联的所有哈希索引，返回被移除的哈希键列表 |
| `_emit_block_removed_events(block_hashes)` | 批量发送块移除事件 |
| `_get_partial_block_hash(...)` | 计算部分块对应的前缀哈希 |
| `_get_partial_block_parent_hash_and_start(...)` | 获取部分块的父哈希与起始 token 位置 |

---

## 四、块分配与引用管理

### 核心代码片段
```python
    def get_new_blocks(self, num_blocks: int) -> list[KVCacheBlock]:
        """Get new blocks from the free block pool."""
        ret: list[KVCacheBlock] = self.free_block_queue.popleft_n(num_blocks)
        if self.enable_caching:
            for block in ret:
                self._maybe_evict_cached_block(block)
        for block in ret:
            block.ref_cnt += 1
        return ret

    def touch(self, blocks: Sequence[KVCacheBlock]) -> None:
        """Touch a block increases its reference count by 1, and may remove
        the block from the free queue.
        """
        for block in blocks:
            if block.ref_cnt == 0 and not block.is_null:
                self.free_block_queue.remove(block)
            block.ref_cnt += 1
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `get_new_blocks(num_blocks)` | 从空闲队列分配指定数量的新块 | 返回分配的块列表；空间不足抛出异常；分配时自动驱逐块上的缓存元数据 |
| `_maybe_evict_cached_block(block)` | 块被复用时清理其缓存哈希与指标 | 返回 `bool` 表示是否执行了驱逐 |
| `touch(blocks)` | 前缀命中时调用，增加块引用计数并将其移出空闲队列 | 无返回值；是共享前缀块生命周期管理的核心 |

---

## 五、块释放与驱逐策略

### 核心代码片段
```python
    def free_blocks(self, ordered_blocks: Iterable[KVCacheBlock]) -> None:
        """Free a list of blocks. The blocks should be ordered by their
        eviction priority, where the first block will be evicted first.
        """
        blocks_with_hash = []
        blocks_without_hash = []
        for block in ordered_blocks:
            block.ref_cnt -= 1
            if block.ref_cnt == 0 and not block.is_null:
                if block.block_hash is None:
                    blocks_without_hash.append(block)
                else:
                    blocks_with_hash.append(block)
        self.free_block_queue.prepend_n(blocks_without_hash)
        self.free_block_queue.append_n(blocks_with_hash)

    def evict_blocks(self, block_ids: set[int]) -> None:
        """evict blocks from the prefix cache by their block IDs."""
```

### 方法功能说明
| 方法名 | 功能 | 备注 |
|--------|------|------|
| `free_blocks(ordered_blocks)` | 批量释放块，递减引用计数；引用归零后放回空闲队列 | 无哈希块放队首（优先被分配），有哈希块放队尾（LRU 保护热点缓存） |
| `evict_blocks(block_ids)` | 按块ID强制驱逐前缀缓存，仅清理哈希索引 | 不释放物理块，仅使其无法被前缀命中；用于分布式缓存同步场景 |

---

## 六、前缀缓存全局维护

```python
    def reset_prefix_cache(self) -> bool:
        """Reset prefix cache."""
        num_used_blocks = self.num_gpu_blocks - self.get_num_free_blocks()
        if num_used_blocks != 1:  # null block
            return False
        self.cached_block_hash_to_block = BlockHashToBlockMap()
        self.cached_block_hashes_by_block.clear()
        for block in self.blocks:
            block.reset_hash()
        return True
```

### 方法功能说明
| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `reset_prefix_cache()` | 全局重置前缀缓存，清空所有哈希索引与块元数据 | 仅当所有业务块都已释放时返回 `True`；有块仍在使用时返回 `False`，避免内存错误 |

---

## 七、状态查询与事件机制

### 核心代码片段
```python
    def get_num_free_blocks(self) -> int:
        """Get the number of free blocks in the pool."""
        return self.free_block_queue.num_free_blocks

    def get_usage(self) -> float:
        """Get the KV cache usage."""
        total_gpu_blocks = self.num_gpu_blocks - 1
        return 1.0 - (self.get_num_free_blocks() / total_gpu_blocks)

    def take_events(self) -> list[KVCacheEvent]:
        """Atomically takes all events and clears the queue."""
```

### 方法功能说明
| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `get_num_free_blocks()` | 获取当前空闲块总数 | `int`，用于准入控制与容量判断 |
| `get_usage()` | 获取 KV 缓存整体使用率 | `float`，范围 0.0~1.0，已扣除 null_block 占位 |
| `take_events()` | 原子性取出所有缓存事件并清空队列 | `list[KVCacheEvent]`，包含块存储、移除、全量清空三类事件 |

---

## 核心设计要点

1. **自适应存储优化**：哈希映射默认存单块对象，仅出现重复哈希时升级为字典，在保证正确性的同时大幅降低 Python 对象与 GC 开销
2. **分级 LRU 驱逐**：空闲队列分为无哈希块与有哈希块两段，无哈希块优先被分配复用，有哈希块按 LRU 顺序保护热点前缀缓存
3. **部分块缓存机制**：支持亚块粒度的前缀索引，在大缓存块配置下仍能实现细粒度命中，无需额外复制物理内存
4. **双向索引设计**：正向哈希查块、反向块查哈希，支持块驱逐时快速清理所有关联索引，避免内存泄漏
5. **引用计数共享**：多请求可通过 `touch` 共享同一块前缀缓存，引用计数归零后才进入空闲队列，实现安全的多租户前缀复用
6. **null_block 特殊语义**：固定 ID=0 的占位块永不释放，用于稀疏注意力、滑动窗口等场景的无效槽位填充
7. **事件驱动可观测**：内置完整事件体系，支持外部系统监听缓存变更，实现分布式缓存同步与可观测性建设
8. **指标埋点全覆盖**：分配、驱逐、访问全链路埋点，对接外部指标收集器实现精细化监控
