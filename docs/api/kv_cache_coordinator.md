# KVCacheCoordinator 缓存协调器体系

`KVCacheCoordinator` 是 KV 缓存管理层的核心协调抽象层，承上启下对接 `KVCacheManager` 入口，向下统一管理多个 `SingleTypeKVCacheManager` 实例。它屏蔽了全注意力、滑动窗口、Mamba、交叉注意力等不同缓存类型的实现差异，对外提供一致的块分配、命中查找、缓存写入、块释放接口，同时负责跨缓存组的前缀匹配一致性、分布式场景适配与推测解码兼容。

体系采用抽象基类 + 多态实现的设计，根据缓存开关与缓存组数量自动选择最优实现：无前缀缓存、单缓存组、混合多缓存组分别对应三套子类，在保证通用性的同时最大化路径性能。

---

## 一、辅助工具与数据结构

### 1. 配置校验函数

```python
def _validate_prefix_cache_retention_interval(
    retention_interval: int | None,
    scheduler_block_size: int,
    kv_cache_config: KVCacheConfig,
) -> None:
```

校验前缀缓存保留间隔的合法性，核心规则：
- 仅对包含 `SlidingWindowSpec` 或 `MambaSpec` 的模型生效，全注意力组天然稠密缓存不受影响
- 取值必须非负，且为 `scheduler_block_size` 的整数倍，确保落在真实缓存命中边界上
- 配置无效时抛出明确的 `ValueError` 提示

### 2. `SpecGroup` 命名元组

```python
class SpecGroup(NamedTuple):
    spec: KVCacheSpec
    group_ids: list[int]
    manager_cls: type[SingleTypeKVCacheManager]
    use_eagle: bool
```

将**缓存规格完全相同**的多个 KV 缓存组合并为一个查找单元，批量执行前缀命中查询以降低开销。

| 字段 | 类型 | 说明 |
|------|------|------|
| `spec` | `KVCacheSpec` | 共享的缓存规格定义 |
| `group_ids` | `list[int]` | 归属于该规格的缓存组索引列表 |
| `manager_cls` | `type[SingleTypeKVCacheManager]` | 对应的单类型管理器类 |
| `use_eagle` | `bool` | 组内是否存在 EAGLE 推测解码组，存在则整体应用尾块丢弃逻辑 |

---

## 二、`KVCacheCoordinator` 抽象基类

所有协调器的公共父类，定义统一接口与通用逻辑，持有全局块池与所有单类型管理器实例。

### 核心代码片段

```python
class KVCacheCoordinator(ABC):
    def __init__(
        self,
        kv_cache_config: KVCacheConfig,
        max_model_len: int,
        max_num_batched_tokens: int,
        use_eagle: bool,
        enable_caching: bool,
        enable_kv_cache_events: bool,
        dcp_world_size: int,
        pcp_world_size: int,
        scheduler_block_size: int,
        hash_block_size: int,
        metrics_collector: KVCacheMetricsCollector | None = None,
    ):
        self.block_pool = BlockPool(...)
        self.single_type_managers = tuple(
            get_manager_for_kv_cache_spec(...)
            for i, kv_cache_group in enumerate(self.kv_cache_config.kv_cache_groups)
        )
        self.retention_interval = envs.VLLM_PREFIX_CACHE_RETENTION_INTERVAL

    @abstractmethod
    def find_longest_cache_hit(...) -> tuple[tuple[list[KVCacheBlock], ...], int]:
        pass
```

### 类属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| `kv_cache_config` | `KVCacheConfig` | 全局 KV 缓存配置，包含所有缓存组定义 |
| `max_model_len` | `int` | 模型支持的最大序列长度 |
| `enable_caching` | `bool` | 全局前缀缓存开关 |
| `scheduler_block_size` | `int` | 调度粒度，为所有组块大小的最小公倍数，必须是 `hash_block_size` 的整数倍 |
| `block_pool` | `BlockPool` | 全局物理块池实例，所有组共享同一块内存池 |
| `eagle_group_ids` | `set[int]` | 标记 EAGLE 推测解码对应的缓存组索引，需特殊处理尾块丢弃 |
| `single_type_managers` | `tuple[SingleTypeKVCacheManager, ...]` | 单类型管理器元组，与缓存组一一对应，执行各组的具体缓存逻辑 |
| `retention_interval` | `int \| None` | 前缀缓存保留间隔，稀疏化滑动窗口/Mamba 的缓存检查点，降低内存开销 |

### 通用方法功能说明

| 方法名 | 功能 | 返回值 / 备注 |
|--------|------|---------------|
| `get_num_blocks_to_allocate(...)` | 计算请求总共需要分配的块数，遍历所有组累加 | `int`；交叉注意力组按编码器 token 独立计算 |
| `allocate_new_computed_blocks(...)` | 两阶段分配前缀命中块：先全量 touch 所有组的本地命中块，再分配外部缓存块 | 无返回值；两阶段设计避免前序组分配时驱逐后序组尚未引用的命中块 |
| `allocate_new_blocks(...)` | 为请求分配新物理块，使其容纳指定数量的 token | `tuple[list[KVCacheBlock], ...]`，按组索引返回新分配块 |
| `cache_blocks(request, num_computed_tokens)` | 遍历所有组，将请求已计算块写入前缀缓存 | 无返回值；透传 `retention_interval` 给各组执行稀疏化策略 |
| `free(request_id)` | 释放请求占用的所有缓存块 | 无返回值；逐组调用释放逻辑 |
| `pop_blocks_for_free(request_id)` | 取出请求的所有块但不立即归还块池，由调用方统一按逆序释放 | `list[KVCacheBlock]`，按分配顺序返回，用于尾块优先驱逐 |
| `get_num_common_prefix_blocks(running_request_id)` | 统计每个缓存组的公共前缀块数 | `list[int]`，索引与缓存组一一对应 |
| `remove_skipped_blocks(...)` | 移除滑动窗口外等不再需要的块，替换为 null_block | 无返回值；R-SWA 场景会额外利用 prompt 长度清理间隙块 |
| `get_blocks(request_id)` | 获取请求在所有组中的缓存块列表 | `tuple[list[KVCacheBlock], ...]` |
| `find_longest_cache_hit(...)` | 抽象方法：查找最长前缀缓存命中 | 由各子类实现对应算法 |
| `new_step_starts()` | 每步推理开始时的钩子，执行各组的步进初始化 | 无返回值 |

---

## 三、具体实现子类

### 1. `KVCacheCoordinatorNoPrefixCache` 无前缀缓存协调器 {#no-prefix-cache}

适用于前缀缓存禁用或不支持的场景，兼容任意数量的缓存组（包括 0 组），所有缓存相关操作均为空实现或返回默认值。

#### 核心方法说明

| 方法名 | 行为 |
|--------|------|
| `find_longest_cache_hit(...)` | 直接返回空块列表与命中长度 0，不做任何哈希查找 |
| `get_num_common_prefix_blocks(...)` | 全量返回 0 列表，无公共前缀可言 |

### 2. `UnitaryKVCacheCoordinator` 单缓存组协调器 {#unitary}

适用于模型只有一种 KV 缓存类型的场景（如纯全注意力、纯滑动窗口），是最常见、性能最优的路径，直接委托给唯一的单类型管理器执行。

#### 核心特性
- 强制校验 `hash_block_size == block_size`，简化哈希对齐逻辑
- 支持 DCP/PCP 分布式场景下的块大小倍数扩展
- 直接透传命中查找请求，无额外跨组合并开销

#### 核心方法说明

| 方法名 | 功能 |
|--------|------|
| `find_longest_cache_hit(...)` | 直接调用单组管理器的命中查找逻辑，返回命中块与总命中 token 数 |

### 3. `HybridKVCacheCoordinator` 混合缓存组协调器 {#hybrid}

适用于多层混合注意力模型（如部分层全注意力 + 部分层滑动窗口），核心挑战是保证不同块大小、不同缓存策略的组之间前缀命中长度一致。

#### 核心代码片段

```python
class HybridKVCacheCoordinator(KVCacheCoordinator):
    def verify_and_split_kv_cache_groups(self) -> None:
        """按 spec 分组，全注意力组前置以优化迭代效率"""
        self.attention_groups: list[SpecGroup] = []

    def find_longest_cache_hit(
        self,
        block_hashes: list[BlockHash],
        max_cache_hit_length: int,
    ) -> tuple[tuple[list[KVCacheBlock], ...], int]:
        """不动点迭代算法：逐组收敛最长公共命中长度"""
```

#### 核心方法与机制说明

| 方法 / 机制 | 功能说明 |
|--------|------|
| `verify_and_split_kv_cache_groups()` | 初始化时按缓存规格分组，全注意力组排最前，利用其稠密特性先给出紧上界，减少后续组迭代次数 |
| **不动点迭代命中算法** | 初始命中长度设为最大值，依次让每个规格组校验并缩短命中长度；长度单调递减，最终收敛到所有组都认可的最长公共前缀 |
| **简单混合优化** | 仅「全注意力 + 另一种类型」的双组场景只需一轮迭代即可收敛，跳过循环直接返回 |
| **EAGLE 尾块丢弃** | 对 EAGLE 组多匹配一个块再丢弃尾部，保证推测解码的边界正确性；长度缩短时清空已验证标记，避免逻辑漏洞 |
| **未缓存公共前缀检测** | 记录各组独立能命中的最长长度与最终收敛长度的差值，用于识别跨请求共享但未被缓存的公共前缀段 |
| `find_longest_cache_hit_per_group(...)` | 独立评估每个组的命中长度，不做公共收敛，用于调试与精细统计 |
| `cache_blocks(...)` | 先对齐到调度粒度边界再缓存；EAGLE 组额外多缓存一个 lookahead 块，匹配其命中逻辑 |

---

## 四、工厂函数 {#factory}

```python
def get_kv_cache_coordinator(
    kv_cache_config: KVCacheConfig,
    max_model_len: int,
    max_num_batched_tokens: int,
    use_eagle: bool,
    enable_caching: bool,
    enable_kv_cache_events: bool,
    dcp_world_size: int,
    pcp_world_size: int,
    scheduler_block_size: int,
    hash_block_size: int,
    metrics_collector: KVCacheMetricsCollector | None = None,
) -> KVCacheCoordinator:
```

根据配置自动选择最优协调器实现，选择逻辑：
1. 未启用前缀缓存 → `KVCacheCoordinatorNoPrefixCache`
2. 仅 1 个缓存组 → `UnitaryKVCacheCoordinator`
3. 多个缓存组 → `HybridKVCacheCoordinator`

---

## 核心设计要点

1. **分层多态架构**：通过抽象基类统一接口，三类子类分别适配不同场景，既保证通用性又避免通用路径的性能损耗
2. **两阶段安全分配**：前缀命中块先全量 touch 再分配新块，彻底解决跨组分配时命中块被意外驱逐的竞态问题
3. **规格分组优化**：混合场景下按缓存规格合并查找，减少重复哈希匹配；全注意力前置进一步收敛迭代次数
4. **不动点收敛算法**：多组不同块大小、不同缓存策略下，通过单调递减的长度迭代保证最终一致性，算法可证明收敛
5. **推测解码原生兼容**：全链路内置 EAGLE 尾块丢弃逻辑，从命中查找、缓存写入到组标记形成完整闭环
6. **稀疏缓存保留机制**：通过 `retention_interval` 对滑动窗口、Mamba 等场景做缓存稀疏化，在命中率损失可控的前提下大幅降低缓存元数据开销
7. **分布式扩展性**：原生支持 DCP/PCP 并行下的块大小换算，单组场景已完整适配，混合场景预留扩展接口
8. **内存释放可控**：支持统一取出块再批量逆序释放，保证尾部块优先进入驱逐队列，提升前缀缓存复用率
