# Scheduler 调度器

`Scheduler` 是 vLLM v1 引擎的核心调度中枢，承上对接引擎入口，向下管理所有请求的生命周期与 KV 缓存资源分配。它采用统一的 token 预算调度模型，不再区分「预填充阶段」与「解码阶段」，每个请求仅维护 `num_computed_tokens` 与 `num_tokens_with_spec` 两个计数器，调度器逐轮分配 token 预算让计算进度追赶目标长度。该架构天然支持分块预填充、前缀缓存命中、推测解码等高级特性。

调度器深度整合 `KVCacheManager` 完成缓存分配、命中查询、块释放等操作，是 KV 缓存系统的主要调用方与资源决策者。

---

## 一、初始化与核心属性

```python
class Scheduler(SchedulerInterface):
    def __init__(
        self,
        vllm_config: VllmConfig,
        kv_cache_config: KVCacheConfig,
        structured_output_manager: StructuredOutputManager,
        block_size: int,
        hash_block_size: int | None = None,
        mm_registry: MultiModalRegistry = MULTIMODAL_REGISTRY,
        include_finished_set: bool = False,
        log_stats: bool = False,
    ) -> None:
        # 配置与管理器
        self.kv_cache_manager = KVCacheManager(...)
        self.encoder_cache_manager = EncoderCacheManager(...)
        self.connector = None  # KV 连接器
        self.ec_connector = None  # EC 连接器

        # 请求队列
        self.waiting = create_request_queue(self.policy)
        self.skipped_waiting = create_request_queue(self.policy)
        self.running: list[Request] = []
        self.requests: dict[str, Request] = {}

        # 调度约束
        self.max_num_running_reqs = self.scheduler_config.max_num_seqs
        self.max_num_scheduled_tokens = ...
        self.max_model_len = ...
```

### 类属性说明（核心部分）

| 属性 | 类型 | 说明 |
|------|------|------|
| `vllm_config` | `VllmConfig` | 全局 vLLM 配置对象 |
| `kv_cache_manager` | `KVCacheManager` | KV 缓存管理器，调度器所有缓存操作的实际执行者 |
| `encoder_cache_manager` | `EncoderCacheManager` | 编码器缓存管理器，用于多模态与编码器-解码器模型 |
| `connector` | `KVConnectorBase_V1` \| `None` | KV 连接器，支持分布式 KV 传输与卸载 |
| `requests` | `dict[str, Request]` | 全局请求表，按 request_id 索引所有活跃请求 |
| `waiting` | `RequestQueue` | 等待调度的请求队列，按调度策略排序 |
| `skipped_waiting` | `RequestQueue` | 因异步依赖或约束被跳过的等待请求 |
| `running` | `list[Request]` | 当前运行中的请求列表 |
| `finished_req_ids` | `set[str]` | 上一步到当前步之间完成的请求 ID，用于通知 worker 清理状态 |
| `max_num_running_reqs` | `int` | 最大并发运行请求数 |
| `max_num_scheduled_tokens` | `int` | 单步最大调度 token 数（token 预算上限） |
| `max_model_len` | `int` | 模型支持的最大序列长度 |
| `policy` | `SchedulingPolicy` | 调度策略枚举，如 FCFS、优先级等 |
| `use_eagle` | `bool` | 是否启用 EAGLE 推测解码 |
| `num_lookahead_tokens` | `int` | 推测解码需要预分配的 lookahead token 数 |
| `defer_block_free` | `bool` | 是否延迟释放块，用于多批次重叠场景下的 KV 连接器安全 |
| `deferred_frees` | `deque[tuple[int, list[KVCacheBlock]]]` | 延迟释放队列，按步骤序号栅栏式安全释放 |
| `_inflight_prefills` | `set[Request]` | 在途预填充请求集合，用于异步 KV 加载的预留块控制 |

---

## 二、核心调度方法：`schedule()` {#schedule}

```python
def schedule(self, throttle_prefills: bool = False) -> SchedulerOutput:
    self.current_step += 1
    # 初始化调度结果容器
    scheduled_new_reqs: list[Request] = []
    scheduled_resumed_reqs: list[Request] = []
    scheduled_running_reqs: list[Request] = []
    preempted_reqs: list[Request] = []
    req_to_new_blocks: dict[str, KVCacheBlocks] = {}
    token_budget = self.max_num_scheduled_tokens

    self.kv_cache_manager.new_step_starts()

    # 第一阶段：调度 RUNNING 请求
    while req_index < len(self.running) and token_budget > 0:
        # 计算该请求本轮可分配的新 token 数
        # 尝试分配 KV 缓存槽位
        # 成功则加入调度列表，扣减 token 预算

    # 第二阶段：调度 WAITING 请求
    while token_budget > 0 and waiting queue not empty:
        # 取出队首请求
        # 前缀缓存命中查询
        # 准入控制：完整序列是否能放入缓存
        # 分配 KV 缓存槽位
        # 成功则加入运行队列与调度列表

    # 第三阶段：处理抢占
    # 若空间不足，按策略抢占部分运行请求
    # 释放被抢占请求的缓存块

    # 构建并返回 SchedulerOutput
```

### 调度算法核心思想

调度器不再区分预填充与解码阶段，统一以「计算进度追赶目标长度」为模型：
- 每个请求维护 `num_computed_tokens`（已计算 token 数）和 `num_tokens_with_spec`（目标 token 数，含推测解码 token）
- 每轮调度给请求分配一定数量的新 token 预算，使其计算进度向前推进
- 该模型天然兼容分块预填充、前缀缓存命中、推测解码、跳转解码等特性

### 调度三阶段流程

| 阶段 | 处理对象 | 核心操作 |
|------|----------|----------|
| **运行请求调度** | `running` 队列中的请求 | 为每个解码/续算请求分配本轮 token 预算与对应 KV 块，扣减全局预算 |
| **等待请求调度** | `waiting` 队列中的请求 | 先查前缀缓存命中，再做完整序列准入校验，通过后分配缓存并移入运行队列 |
| **抢占处理** | 空间不足时的运行请求 | 按调度策略选择牺牲者，释放其 KV 块并降级回等待队列，标记为抢占状态 |

### 方法参数与返回值

| 参数 | 类型 | 说明 |
|------|------|------|
| `throttle_prefills` | `bool` | 是否节流预填充，用于 DP 负载均衡场景，非对齐节拍步延迟预填充计算 |

| 返回值 | 说明 |
|--------|------|
| `SchedulerOutput` | 调度结果，包含本轮调度的新请求、恢复请求、运行请求、被抢占请求、各请求的新块映射、token 分配数等完整信息 |

---

## 三、KV 缓存相关核心方法

### 1. 块分配与命中查询

调度器在调度等待请求时，会依次执行以下 KV 缓存操作：

```python
# 1. 查询前缀缓存命中
computed_blocks, num_computed_tokens = self.kv_cache_manager.get_computed_blocks(request)

# 2. 准入控制（完整序列是否能放入）
new_blocks = self.kv_cache_manager.allocate_slots(
    request,
    num_new_tokens=num_new_tokens,
    num_new_computed_tokens=num_computed_tokens,
    new_computed_blocks=computed_blocks,
    full_sequence_must_fit=True,
    reserved_blocks=reserved_blocks,
    has_scheduled_reqs=has_scheduled_reqs,
)

# 3. 分配失败则触发抢占
if new_blocks is None:
    self._preempt_request(request, timestamp)
```

### 2. 抢占机制 {#preemption}

```python
def _preempt_request(self, request: Request, timestamp: float) -> None:
    # 将请求从运行队列移回等待队列头部
    # 重置请求的计算状态
    # 释放请求占用的 KV 缓存块
    # 记录抢占统计
```

| 方法名 | 功能 |
|--------|------|
| `_preempt_request(request, timestamp)` | 抢占单个请求，释放其 KV 缓存并降级回等待队列 |

### 3. 块释放与延迟释放

```python
def _free_blocks(self, request: Request):
    """立即释放请求的 KV 块"""
    self.kv_cache_manager.free(request)

def _free_request_blocks(self, request: Request):
    """取出块用于延迟释放"""
    blocks = self.kv_cache_manager.pop_blocks_for_free(request)

def _drain_deferred_frees(self):
    """按步骤栅栏释放延迟块"""
    while self.deferred_frees and self.processed_step_seq >= fence_seq:
        _, blocks = self.deferred_frees.popleft()
        self.kv_cache_manager.block_pool.free_blocks(reversed(blocks))
```

| 方法名 | 功能 | 适用场景 |
|--------|------|----------|
| `_free_blocks(request)` | 立即调用 `kv_cache_manager.free()` 释放 | 普通单批次场景 |
| `_free_request_blocks(request)` | 取出块但不立即归还，加入延迟释放队列 | 多批次重叠 + KV 连接器消费者场景 |
| `_drain_deferred_frees()` | 按处理进度栅栏式安全释放延迟块 | 每步处理完成后调用，防止异步写入冲突 |

---

## 四、请求生命周期管理

### 核心代码片段

```python
def add_request(self, request: Request) -> None:
    """添加新请求到等待队列"""
    self.requests[request.request_id] = request
    self._enqueue_waiting_request(request)

def finish_requests(
    self,
    request_ids: list[str],
    finished_reason: RequestStatus,
) -> list[tuple[str, RequestStatus]]:
    """批量标记请求完成并释放资源"""

def _free_request(self, request: Request) -> None:
    """清理请求的所有资源：KV 缓存、编码器缓存、请求表"""

def _handle_stopped_request(self, request: Request) -> bool:
    """处理停止请求，返回是否真正完成"""

def update_from_output(
    self,
    scheduler_output: SchedulerOutput,
    model_runner_output: ModelRunnerOutput,
) -> dict[int, EngineCoreOutputs]:
    """根据模型执行输出更新请求状态"""
```

### 方法功能说明

| 方法名 | 功能 | 关键操作 |
|--------|------|----------|
| `add_request(request)` | 接收新请求 | 注册到全局表，加入等待队列，初始化 KV 相关状态 |
| `finish_requests(request_ids, reason)` | 批量完成请求 | 标记状态、释放资源、记录完成 ID |
| `_free_request(request)` | 彻底清理请求 | 释放 KV 块、编码器缓存、从请求表移除 |
| `update_from_output(scheduler_output, model_runner_output)` | 步进更新 | 更新每个请求的已计算 token 数、输出 token、推测解码状态，检测停止条件；返回以 engine_index 为键的输出字典 |
| `get_request_counts()` | 获取统计 | 返回 `(等待请求数, 运行请求数)` |
| `get_num_unfinished_requests()` | 未完成总数 | 等待 + 运行 + 流式输入等待 |
| `has_unfinished_requests()` | 是否有未完成请求 | 布尔判断 |

---

## 五、前缀缓存与缓存控制

```python
def reset_prefix_cache(
    self,
    trigerred_by_request: bool = False,
) -> bool:
    """重置前缀缓存"""
    success = self.kv_cache_manager.reset_prefix_cache()
    if success and self.connector:
        self.connector.reset_prefix_cache()
    return success

def reset_connector_cache(self) -> bool:
    """重置连接器远端缓存"""

def reset_encoder_cache(self) -> None:
    """重置编码器缓存"""
```

### 方法功能说明

| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `reset_prefix_cache(trigerred_by_request)` | 清空前缀缓存（本地 + 远端连接器） | `bool`，所有块都已释放时才成功 |
| `reset_connector_cache()` | 仅重置 KV 连接器的远端缓存 | `bool` |
| `reset_encoder_cache()` | 清空编码器缓存 | 无返回值 |

---

## 六、推测解码支持 {#spec-decode}

```python
def update_draft_token_ids(self, draft_token_ids: DraftTokenIds) -> None:
    """更新推测解码的草稿 token"""

def update_draft_token_ids_in_output(
    self,
    scheduler_output: SchedulerOutput,
    model_runner_output: ModelRunnerOutput,
) -> dict[int, EngineCoreOutputs]:
    """将草稿 token 写入输出，供验证阶段使用"""
```

调度器原生支持多种推测解码方案：
- **EAGLE**：`use_eagle=True`，lookahead 槽位数等于推测 token 数，KV 缓存需特殊处理尾块丢弃
- **Draft Model**：草稿模型方案，同样分配 lookahead 槽位
- **DFlash / DSpark**：不同的 lookahead 槽位计算规则
- **动态推测调度**：根据批大小动态调整推测 token 数（`dynamic_sd_lookup`）

---

## 七、分布式 KV 连接器集成 {#kv-connector}

```python
def get_kv_connector(self) -> KVConnectorBase_V1 | None:
    """获取 KV 连接器实例"""

def _connector_finished(
    self, request: Request, load_success: bool
) -> None:
    """KV 连接器加载完成回调"""

def _update_waiting_for_remote_kv(self, request: Request) -> None:
    """更新等待远端 KV 的请求状态"""

def _update_from_kv_xfer_finished(
    self, kv_connector_output: KVConnectorOutput
):
    """处理 KV 传输完成事件"""
```

KV 连接器为调度器提供分布式 KV 缓存能力：
- **生产者/消费者模式**：支持 P/D（Producer/Distributor）架构的 KV 传输
- **异步加载**：远端 KV 异步加载期间请求处于阻塞等待状态，加载完成后恢复调度
- **加载失败策略**：失败时可选「重新计算」或「请求失败」
- **预留块控制**：在途预填充请求占用预留块，防止异步加载饿死已在途请求

---

## 八、统计与可观测性

```python
def make_stats(self) -> SchedulerStats:
    """生成调度器统计信息"""

def make_spec_decoding_stats(self) -> SpecDecodingStats:
    """生成推测解码统计"""
```

| 方法名 | 功能 |
|--------|------|
| `make_stats()` | 汇总调度统计：请求数、缓存使用率、前缀缓存命中率、抢占次数等 |
| `make_spec_decoding_stats()` | 推测解码专项统计：接受率、草稿 token 数等 |

---

## 核心设计要点

1. **统一 token 预算模型**：摒弃预填充/解码两阶段划分，以「计算进度追赶目标长度」为统一抽象，天然兼容分块预填充、前缀缓存、推测解码
2. **三级调度流水线**：运行请求优先 → 等待请求准入 → 不足则抢占，保证高优先级请求资源供给
3. **完整序列准入控制**：通过 `full_sequence_must_fit` 参数确保分块预填充请求最终能完整放入缓存，避免中途反复抢占
4. **延迟释放安全机制**：多批次重叠 + KV 连接器场景下，通过步骤栅栏延迟释放块，防止异步写入与重新分配的内存冲突
5. **水位线保护机制**：预留 `watermark_blocks` 空闲块，避免等待/抢占请求频繁触发抢占抖动
6. **预留块异步隔离**：`_inflight_prefills` 集合为在途预填充预留块，防止异步 KV 加载抢占已有预填充的资源
7. **推测解码全链路原生支持**：从 KV 块分配（lookahead 槽位）、命中查找（EAGLE 尾块丢弃）到草稿 token 更新形成完整闭环
8. **分布式缓存扩展**：KV 连接器深度集成，支持远端缓存命中查询、异步加载、卸载等高级分布式特性
9. **Mamba 对齐模式**：针对 Mamba 线性注意力的缓存对齐模式，提供块对齐切分工具函数
10. **结构化输出集成**：与 `StructuredOutputManager` 联动，支持语法约束的生成调度
