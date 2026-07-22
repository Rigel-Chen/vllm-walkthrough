# GPUModelRunner 模型执行器与 AttentionBackend

## GPUModelRunner {#model-runner}

`GPUModelRunner`（定义于 `vllm/v1/worker/gpu_model_runner.py`）是 vLLM v1 架构中的模型执行引擎，位于 Scheduler 下游。它负责将调度器的调度决策转换为实际的 GPU 计算——构建 `block_table` 与 `slot_mapping` 张量、执行模型前向传播、采样下一个 token。

### 与 KV Cache 的交互

`GPUModelRunner` 是 KV Cache 的**最终消费者**：调度器（Scheduler）通过 `KVCacheManager` 分配物理块后，ModelRunner 将这些块的逻辑映射转化为模型可以直接寻址的物理索引。

```python
# 核心：block_table 和 slot_mapping 的构建
# block_table: [num_reqs, max_blocks_per_req] — 每行是一个请求的物理块 ID 序列
# slot_mapping: [total_tokens] — 每个 token 映射到的 (block_id * block_size + offset)
```

### 执行流程

1. **输入准备**：从 `InputBatch` 收集当前 step 的所有活跃请求，构建批次张量
2. **块表构建**：将每个请求的 `KVCacheBlock` 列表转换为 `block_table` 张量，填充 `slot_mapping`
3. **模型前向**：调用模型前向传播，Attention 层通过 `slot_mapping` 读写 KV Cache
4. **采样**：从 logits 采样下一个 token（支持拒绝采样、推测解码验证）
5. **输出**：返回 `ModelRunnerOutput`（包含采样的 token、logprobs、KV connector 输出等）

---

## AttentionBackend {#attention-backend}

`AttentionBackend`（抽象基类定义于 `vllm/v1/attention/backend.py`，具体实现在 `vllm/v1/attention/backends/`）是 KV Cache 物理读写的**最终执行者**。

### 核心接口

```python
class AttentionBackend:
    def build_metadata(self, common_metadata, ...) -> AttentionMetadata:
        """构建 Attention 层所需的元数据（含 block_table, slot_mapping）"""

    def forward(self, query, key, value, metadata, ...) -> Tensor:
        """执行 Attention 计算，自动从 block_table 定位物理块读写 KV"""
```

### KV Cache 读写路径

`AttentionBackend` 通过 `block_table` + `slot_mapping` 实现逻辑→物理地址翻译：

| 张量 | 形状 | 含义 |
|------|------|------|
| `block_table` | `[num_seqs, max_blocks]` | 每个序列的物理块 ID 列表 |
| `slot_mapping` | `[num_tokens]` | 每个 token 的 `block_id * block_size + offset` |

- **写入**：prefill 阶段，将计算出的 K/V 写入 `slot_mapping` 指向的物理位置
- **读取**：decode 阶段，从 `block_table` 定位已缓存的 K/V 块，与新 token 拼接计算

### 后端实现

vLLM 支持多种 Attention 后端，按硬件和特性自动选择：

| 后端 | 适用场景 | 关键特性 |
|------|---------|---------|
| FlashAttention | NVIDIA GPU (通用) | 高性能 fused kernel，支持 PagedAttention |
| FlashInfer | NVIDIA GPU | 更优的 decode 性能，支持 KV 量化 |
| Triton | NVIDIA GPU | 高性能 Triton kernel 实现，v1 默认 fallback |
| ROCm (AMD) | AMD GPU | AMD 平台适配 |
| GDN | Intel Gaudi | Intel 加速器支持 |

### `NULL_BLOCK_ID`

所有后端共享的约定：`NULL_BLOCK_ID = 0`（定义于 `vllm/v1/attention/backends/utils.py`），表示未分配的槽位。Attention 计算时会跳过这些位置。
