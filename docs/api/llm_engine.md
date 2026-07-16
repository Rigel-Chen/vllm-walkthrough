# LLMEngine 引擎入口

`LLMEngine` 是 vLLM v1 架构对外的顶层引擎接口，作为向后兼容的经典封装，承接用户请求的输入预处理、核心引擎调度执行、输出后处理全链路。它内部通过 `EngineCoreClient` 对接真正的执行核心 `EngineCore`，而 KV 缓存管理、调度等核心逻辑均下沉到 `EngineCore` 内部的 `Scheduler` 与 `KVCacheManager` 体系中。

该类是用户与 KV 缓存系统交互的最外层入口，前缀缓存重置、睡眠唤醒、LoRA 管理等缓存相关操作均通过它向下透传。

---

## InputProcessor 与 OutputProcessor {#input-output-processor}

`LLMEngine` 内部通过两个处理器完成请求的预处理与后处理：

- **`InputProcessor`**：定义于 `vllm/v1/engine/input_processor.py`，负责将用户原始输入（prompt 文本/token ids/多模态数据）转换为引擎内部 `EngineCoreRequest`，包括 tokenize、prompt 格式化、多模态占位符注入。
- **`OutputProcessor`**：定义于 `vllm/v1/engine/output_processor.py`，负责将引擎核心输出反 tokenize、组装流式 `RequestOutput`、检测停止条件。

---

## 一、初始化与核心属性

```python
class LLMEngine:
    def __init__(
        self,
        vllm_config: VllmConfig,
        executor_class: type[Executor],
        log_stats: bool,
        aggregate_engine_logging: bool = False,
        usage_context: UsageContext = UsageContext.ENGINE_CONTEXT,
        stat_loggers: list[StatLoggerFactory] | None = None,
        mm_registry: MultiModalRegistry = MULTIMODAL_REGISTRY,
        multiprocess_mode: bool = False,
    ) -> None:
        self.vllm_config = vllm_config
        self.model_config = vllm_config.model_config

        # 输入渲染与预处理
        self.renderer = renderer_from_config(self.vllm_config)
        self.input_processor = InputProcessor(self.vllm_config, renderer)

        # 输出后处理
        self.output_processor = OutputProcessor(...)

        # 核心引擎客户端（调度器 + KV 缓存均在 EngineCore 内部）
        self.engine_core = EngineCoreClient.make_client(...)

        # 统计日志管理
        self.logger_manager: StatLoggerManager | None = None
```

### 类属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| `vllm_config` | `VllmConfig` | 全局 vLLM 配置对象，包含模型、调度、缓存、并行等所有配置 |
| `model_config` | `ModelConfig` | 模型配置，包含模型类型、最大长度、词表大小等 |
| `observability_config` | `ObservabilityConfig` | 可观测性配置，控制追踪、指标、日志等 |
| `dp_group` | `ProcessGroup` \| `None` | 数据并行通信组，多 DP 副本场景下使用 |
| `renderer` | `Renderer` | 输入渲染器，负责将原始 prompt 转换为模型可接受的格式 |
| `input_processor` | `InputProcessor` | 输入处理器，将用户输入转换为 `EngineCoreRequest` 内部请求 |
| `output_processor` | `OutputProcessor` | 输出处理器，将引擎核心输出转换为用户友好的 `RequestOutput` |
| `engine_core` | `EngineCoreClient` | 引擎核心客户端，实际执行调度、KV 缓存管理、模型推理的核心 |
| `logger_manager` | `StatLoggerManager` \| `None` | 统计日志管理器，仅 `log_stats=True` 时初始化 |
| `log_stats` | `bool` | 是否开启统计日志输出 |
| `should_execute_dummy_batch` | `bool` | DP 场景下是否需要执行空批次，用于对齐多副本步调 |

---

## 二、类方法：创建引擎实例

### 核心代码片段

```python
    @classmethod
    def from_vllm_config(
        cls,
        vllm_config: VllmConfig,
        usage_context: UsageContext = UsageContext.ENGINE_CONTEXT,
        stat_loggers: list[StatLoggerFactory] | None = None,
        disable_log_stats: bool = False,
    ) -> "LLMEngine":
        return cls(
            vllm_config=vllm_config,
            executor_class=Executor.get_class(vllm_config),
            log_stats=(not disable_log_stats),
            ...
        )

    @classmethod
    def from_engine_args(
        cls,
        engine_args: EngineArgs,
        usage_context: UsageContext = UsageContext.ENGINE_CONTEXT,
        stat_loggers: list[StatLoggerFactory] | None = None,
        enable_multiprocessing: bool = False,
    ) -> "LLMEngine":
        """Creates an LLM engine from the engine arguments."""
        vllm_config = engine_args.create_engine_config(usage_context)
        executor_class = Executor.get_class(vllm_config)
        return cls(...)
```

### 方法功能说明

| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `from_vllm_config(cls, vllm_config, ...)` | 从已构建的 `VllmConfig` 配置对象创建引擎实例 | `LLMEngine` 实例 |
| `from_engine_args(cls, engine_args, ...)` | 从 `EngineArgs` 命令行参数对象创建引擎（内部先构建 `VllmConfig`） | `LLMEngine` 实例 |

---

## 三、请求管理

### 1. 添加请求

```python
    def add_request(
        self,
        request_id: str,
        prompt: EngineCoreRequest | PromptType | EngineInput,
        params: SamplingParams | PoolingParams,
        arrival_time: float | None = None,
        lora_request: LoRARequest | None = None,
        tokenization_kwargs: dict[str, Any] | None = None,
        trace_headers: Mapping[str, str] | None = None,
        priority: int = 0,
        prompt_text: str | None = None,
    ) -> str:
```

#### 方法参数说明

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `request_id` | `str` | 请求唯一标识，必须为字符串类型 |
| `prompt` | `EngineCoreRequest` \| `PromptType` \| `EngineInput` | 输入内容，支持原始 prompt、渲染后输入或内部请求对象 |
| `params` | `SamplingParams` \| `PoolingParams` | 采样参数或池化参数 |
| `arrival_time` | `float` \| `None` | 请求到达时间戳，用于延迟统计 |
| `lora_request` | `LoRARequest` \| `None` | LoRA 适配器请求 |
| `priority` | `int` | 请求优先级，数值越大优先级越高 |
| `prompt_text` | `str` \| `None` | 原始 prompt 文本，用于日志与调试 |

#### 核心流程
1. 输入校验与预处理：通过 `input_processor` 将原始输入转换为内部 `EngineCoreRequest`
2. 多输出分支：若 `n > 1` 则扇出为多个子请求（并行采样）
3. 注册输出处理器状态
4. 下发给 `engine_core` 进入调度队列（最终由 `Scheduler` 管理 KV 缓存分配）

### 2. 中止请求

```python
    def abort_request(self, request_ids: list[str], internal: bool = False) -> None:
        request_ids = self.output_processor.abort_requests(request_ids, internal)
        self.engine_core.abort_requests(request_ids)
```

同时清理输出处理器状态与引擎核心中的请求（含其占用的 KV 缓存）。

### 3. 请求状态查询

```python
    def get_num_unfinished_requests(self) -> int:
        return self.output_processor.get_num_unfinished_requests()

    def has_unfinished_requests(self) -> bool:
        has_unfinished = self.output_processor.has_unfinished_requests()
        if self.dp_group is None:
            return has_unfinished or self.engine_core.dp_engines_running()
        return self.has_unfinished_requests_dp(has_unfinished)
```

| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `get_num_unfinished_requests()` | 获取未完成请求总数 | `int` |
| `has_unfinished_requests()` | 是否存在未完成请求 | `bool`；DP 场景会聚合所有副本状态 |

---

## 四、执行循环：`step()`

```python
    def step(self) -> list[RequestOutput | PoolingRequestOutput]:
        # 1) 从 EngineCore 获取输出（内部完成调度 + 推理 + KV 缓存更新）
        outputs = self.engine_core.get_output()

        # 2) 处理输出：反 tokenize、检测停止条件、统计指标
        processed_outputs = self.output_processor.process_outputs(...)

        # 3) 中止因停止词而结束的请求（释放其 KV 缓存）
        self.engine_core.abort_requests(processed_outputs.reqs_to_abort)

        # 4) 记录统计日志
        if self.logger_manager is not None:
            self.logger_manager.record(...)

        return processed_outputs.request_outputs
```

### 执行四阶段

| 阶段 | 操作 | 关键模块 |
|------|------|----------|
| **获取输出** | 阻塞等待引擎核心完成一步推理，返回各请求的输出 token | `EngineCore` → `Scheduler` → `KVCacheManager` |
| **处理输出** | 反 tokenize、流式输出组装、停止条件检测、迭代统计更新 | `OutputProcessor` |
| **中止停止请求** | 对触发停止条件的请求下发中止指令，释放缓存资源 | `EngineCore` → `Scheduler` → 块释放 |
| **记录统计** | 汇总调度统计、迭代统计、多模态缓存统计，按间隔输出日志 | `StatLoggerManager` |

### 返回值
`list[RequestOutput | PoolingRequestOutput]`：本步产生的请求输出列表，包含生成文本、token id、完成状态等信息。

---

## 五、缓存控制

### 1. 前缀缓存重置

```python
    def reset_prefix_cache(
        self, reset_running_requests: bool = False, reset_connector: bool = False
    ) -> bool:
        return self.engine_core.reset_prefix_cache(
            reset_running_requests, reset_connector
        )
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `reset_running_requests` | `bool` | 是否同时重置运行中请求的缓存状态 |
| `reset_connector` | `bool` | 是否同时重置 KV 连接器的远端缓存 |

返回 `bool`：重置是否成功。所有业务块都已释放时才能成功重置。

### 2. 编码器缓存重置

```python
    def reset_encoder_cache(self) -> None:
        """Reset the encoder cache to invalidate all cached encoder outputs."""
        self.engine_core.reset_encoder_cache()
```

用于模型权重更新后清理过期的视觉/编码器嵌入缓存。

### 3. 多模态缓存重置

```python
    def reset_mm_cache(self):
        self.renderer.clear_mm_cache()
        self.engine_core.reset_mm_cache()
```

同时清理渲染层与引擎核心的多模态缓存。

---

## 六、睡眠与唤醒

```python
    def sleep(self, level: int = 1, mode: PauseMode = "abort"):
        if level >= 1:
            self.renderer.clear_mm_cache()
        self.engine_core.sleep(level, mode)

    def wake_up(self, tags: list[str] | None = None):
        self.engine_core.wake_up(tags)

    def is_sleeping(self) -> bool:
        return self.engine_core.is_sleeping()
```

### 方法功能说明

| 方法名 | 功能 | 说明 |
|--------|------|------|
| `sleep(level, mode)` | 引擎进入睡眠状态，释放 GPU 资源 | `level` 控制释放深度；`mode` 为 `abort` 时中止所有请求 |
| `wake_up(tags)` | 唤醒睡眠中的引擎，恢复服务能力 | `tags` 可选，用于精细化唤醒控制 |
| `is_sleeping()` | 查询引擎是否处于睡眠状态 | 返回 `bool` |

睡眠模式下 KV 缓存会被清空，唤醒后需要重新分配。

---

## 七、LoRA 管理

```python
    def add_lora(self, lora_request: LoRARequest) -> bool:
        return self.engine_core.add_lora(lora_request)

    def remove_lora(self, lora_id: int) -> bool:
        return self.engine_core.remove_lora(lora_id)

    def list_loras(self) -> set[int]:
        return self.engine_core.list_loras()

    def pin_lora(self, lora_id: int) -> bool:
        return self.engine_core.pin_lora(lora_id)
```

| 方法名 | 功能 | 返回值 |
|--------|------|--------|
| `add_lora(lora_request)` | 加载新的 LoRA 适配器到引擎 | `bool` 是否成功 |
| `remove_lora(lora_id)` | 移除已加载的 LoRA 适配器 | `bool` 是否成功 |
| `list_loras()` | 列出所有已注册的适配器 ID | `set[int]` |
| `pin_lora(lora_id)` | 固定适配器，防止被驱逐 | `bool` 是否成功 |

LoRA 适配器与前缀缓存深度集成：不同 LoRA 的前缀哈希互不干扰，通过 `lora_id` 区分。

---

## 八、工具方法与属性

### 核心代码片段

```python
    @property
    def tokenizer(self) -> TokenizerLike | None:
        return self.renderer.tokenizer

    def get_tokenizer(self) -> TokenizerLike:
        return self.renderer.get_tokenizer()

    def get_supported_tasks(self) -> tuple[SupportedTask, ...]:
        if not hasattr(self, "_supported_tasks"):
            self._supported_tasks = self.engine_core.get_supported_tasks()
        return self._supported_tasks

    def get_metrics(self) -> list[Metric]:
        assert self.log_stats, "Stat logging disabled"
        return get_metrics_snapshot()

    def do_log_stats(self) -> None:
        if self.logger_manager:
            self.logger_manager.log()

    def collective_rpc(
        self, method: str | Callable[[WorkerBase], _R],
        timeout: float | None = None,
        args: tuple = (), kwargs: dict[str, Any] | None = None,
    ) -> list[_R]:
        return self.engine_core.collective_rpc(method, timeout, args, kwargs)

    def apply_model(self, func: Callable[[nn.Module], _R]) -> list[_R]:
        return self.collective_rpc("apply_model", args=(func,))
```

### 方法功能说明

| 方法 / 属性 | 功能 | 返回值 |
|-------------|------|--------|
| `tokenizer` (property) | 获取 tokenizer 实例（可能为 None） | `TokenizerLike` \| `None` |
| `get_tokenizer()` | 获取 tokenizer 实例（保证非 None） | `TokenizerLike` |
| `get_supported_tasks()` | 获取引擎支持的任务类型列表 | `tuple[SupportedTask, ...]` |
| `get_metrics()` | 获取当前指标快照 | `list[Metric]`；需开启日志统计 |
| `do_log_stats()` | 立即输出一次统计日志 | 无返回值 |
| `collective_rpc(method, ...)` | 对所有 worker 执行集体 RPC 调用 | `list[_R]`，每个 worker 的返回值 |
| `apply_model(func)` | 对模型应用函数，常用于权重检查与修改 | `list[_R]` |

---

## 九、性能分析

```python
    def start_profile(self, profile_prefix: str | None = None):
        self.engine_core.profile(True, profile_prefix)

    def stop_profile(self):
        self.engine_core.profile(False)
```

| 方法名 | 功能 |
|--------|------|
| `start_profile(profile_prefix)` | 启动性能分析（如 PyTorch Profiler） |
| `stop_profile()` | 停止性能分析并保存结果 |

---

## 核心设计要点

1. **三层架构清晰分离**：输入预处理 → 引擎核心（调度+KV缓存+推理）→ 输出后处理，各层职责单一，便于扩展与维护
2. **向后兼容封装**：v1 架构下保留经典 `LLMEngine` 接口，内部通过 `EngineCoreClient` 桥接新核心，降低迁移成本
3. **多进程模式支持**：通过 `multiprocess_mode` 切换单进程/多进程引擎核心，适配不同部署场景
4. **数据并行原生集成**：DP 场景下自动管理通信组、对齐步调（dummy batch）、聚合未完成状态
5. **缓存控制统一入口**：前缀缓存、编码器缓存、多模态缓存、连接器缓存均提供独立重置接口，按需精细化管理
6. **睡眠唤醒资源管理**：支持分级睡眠释放 GPU 资源，低负载时降本增效，唤醒后自动恢复服务
7. **LoRA 热插拔**：运行时动态增删 LoRA 适配器，支持固定防止驱逐，与前缀缓存哈希体系深度整合
8. **可观测性完备**：内置统计日志、OTLP 追踪、指标快照三层可观测体系，满足不同运维需求
9. **弱引用终结器**：通过 `weakref.finalize` 注册模型清理钩子，引擎销毁时自动释放编译缓存与 GPU 内存
10. **多输出扇出机制**：`n > 1` 的并行采样通过父子请求模型实现，共享前缀 KV 缓存，大幅提升吞吐效率
