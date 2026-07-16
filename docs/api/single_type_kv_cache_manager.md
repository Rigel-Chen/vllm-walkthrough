# SingleTypeKVCacheManager 单类型缓存管理器

`SingleTypeKVCacheManager` 是 KV 缓存管理体系中的关键中间层——承上接收 `KVCacheCoordinator` 的调度指令，启下直接操作 `BlockPool` 完成物理块的分配、释放和前缀命中查找。每种注意力类型（全注意力、滑动窗口、Mamba、交叉注意力等）对应一个独立的 `SingleTypeKVCacheManager` 子类实例。

该类采用抽象基类 + 多态实现的设计，`KVCacheCoordinator` 通过统一接口管理多个不同类型的管理器实例，屏蔽底层注意力机制的差异。

---

## 一、`SingleTypeKVCacheManager` 抽象基类

### 初始化

```python
class SingleTypeKVCacheManager(ABC):
    supports_fine_grained_hash_lookup: ClassVar[bool] = False

    def __init__(
        self,
        kv_cache_spec: KVCacheSpec,
        block_pool: BlockPool,
        enable_caching: bool,
        kv_cache_group_id: int,
        scheduler_block_size: int,
        dcp_world_size: int = 1,
        pcp_world_size: int = 1,
        needs_kv_cache_zeroing: bool = False,
        max_admission_blocks_per_request: int | None = None,
    ) -> None:
```

### 核心属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `kv_cache_spec` | `KVCacheSpec` | 该管理器的注意力类型规格（如 `FullAttentionSpec`） |
| `block_pool` | `BlockPool` | 全局物理块池引用 |
| `block_size` | `int` | 该管理器实际使用的块大小（token 数/块） |
| `kv_cache_group_id` | `int` | 缓存组 ID |
| `enable_caching` | `bool` | 是否启用前缀缓存 |
| `req_to_blocks` | `dict[str, list[KVCacheBlock]]` | 请求 ID → 已分配块列表的映射 |
| `scheduler_block_size` | `int` | 调度粒度（所有组 block_size 的 LCM） |

---

## 二、`FullAttentionManager` 全注意力管理器

全注意力是最常用的注意力类型，支持完整的前缀缓存命中查找。

```python
class FullAttentionManager(SingleTypeKVCacheManager):
    supports_fine_grained_hash_lookup: ClassVar[bool] = True
```

### `get_num_blocks_to_allocate()`

计算请求需要的总块数（包含新块与未完成的尾块）。

```python
def get_num_blocks_to_allocate(
    self,
    request_id: str,
    num_tokens: int,
    new_computed_blocks: int,
    num_lookahead_tokens: int = 0,
) -> int:
```

- `num_tokens`：请求总 token 数
- `new_computed_blocks`：已计算的前缀命中块数
- `num_lookahead_tokens`：EAGLE 推测解码的额外 lookahead token 数
- 返回：需要分配的总块数

### `allocate_new_blocks()`

从 `BlockPool` 获取新物理块并关联到指定请求。

```python
def allocate_new_blocks(
    self,
    request_id: str,
    num_new_blocks: int,
) -> list[KVCacheBlock]:
```

内部调用 `block_pool.get_new_blocks()`，块不足时返回空列表使上层触发抢占。

### `find_longest_cache_hit()`

前缀缓存命中查找的底层实现——逐块查询 `BlockPool` 中是否已有匹配的块哈希。

```python
@classmethod
def find_longest_cache_hit(
    cls,
    block_hashes: BlockHashList,
    max_length: int,
    kv_cache_group_ids: list[int],
    block_pool: BlockPool,
    kv_cache_spec: KVCacheSpec,
    drop_eagle_block: bool,
    alignment_tokens: int,
    dcp_world_size: int = 1,
    pcp_world_size: int = 1,
) -> tuple[tuple[list[KVCacheBlock], ...], int]:
```

支持精细粒度哈希查找（`alignment_tokens < block_size`），可在块内更细粒度地匹配前缀，最大化缓存复用率。

### `free()`

释放请求的所有块，逆序归还以优化前缀缓存连续性。

```python
def free(self, request_id: str) -> None:
```

### `touch()`

更新命中块的 LRU 访问时间，将其移到驱逐队列尾部。

```python
def touch(self, blocks: list[KVCacheBlock]) -> None:
```

---

## 三、其他注意力类型管理器

### `SlidingWindowManager`

滑动窗口注意力管理器，块不再使用时自动释放窗口外的旧块。

关键差异：覆盖 `get_num_skipped_tokens()` 计算窗口外应跳过的 token 数，在 `_remove_skipped_blocks()` 中释放窗口外的物理块。

### `CrossAttentionManager`

交叉注意力管理器，用于编码器-解码器模型。

### `MambaManager`

Mamba (SSM) 状态空间模型管理器，管理隐藏状态而非传统 KV 缓存。

### `MLAAttentionManager`

MLA（Multi-head Latent Attention）管理器，支持 KV 缓存的低秩压缩。

### `ChunkedLocalAttentionManager`

分块局部注意力管理器，按 `<chunk_size>` 粒度回收块。

---

## 四、管理器工厂注册

各管理器通过 `KVCacheSpecRegistry` 注册：

```python
KVCacheSpecRegistry.register(FullAttentionSpec, FullAttentionManager)
KVCacheSpecRegistry.register(SlidingWindowSpec, SlidingWindowManager)
KVCacheSpecRegistry.register(CrossAttentionSpec, CrossAttentionManager)
KVCacheSpecRegistry.register(MambaSpec, MambaManager)
# ...
```

`KVCacheCoordinator` 在初始化时根据模型配置的 `KVCacheSpec` 列表，通过注册表创建对应的管理器实例。

---

## 核心设计要点

1. **类型隔离**：每种注意力类型有独立的管理器，`KVCacheCoordinator` 通过统一接口调度，屏蔽类型差异
2. **精细粒度哈希**：`FullAttentionManager` 支持 `alignment_tokens < block_size` 的细粒度前缀匹配，在块内边界也能命中缓存
3. **滑动窗口自动回收**：`SlidingWindowManager` 主动释放窗口外块，不等请求结束
4. **逆序归还**：所有 `free()` 实现均逆序遍历块列表，尾部块先归还，提升下次分配时的前缀缓存连续性
