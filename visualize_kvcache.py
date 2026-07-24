"""
KV Cache 可视化演示脚本
=======================
运行前需先在远程服务器上下载好模型（如 Qwen3-0.6B），然后:

  Linux/macOS:
    NANOVLLM_TRACE=2 NANOVLLM_TRACE_FILE=kvcache.log python visualize_kvcache.py

  Windows (PowerShell):
    $env:NANOVLLM_TRACE="2"; $env:NANOVLLM_TRACE_FILE="kvcache.log"; python visualize_kvcache.py

追踪级别:
  NANOVLLM_TRACE=1 → 紧凑单行（每步一行）
  NANOVLLM_TRACE=2 → 步骤面板 + Block 分配详情（推荐）
  NANOVLLM_TRACE=3 → 全细节含 slot mapping

保存日志:
  NANOVLLM_TRACE_FILE=kvcache.log  → 终端 + 纯文本文件双写

场景:
  场景1: 单个短请求 — 完整 prefill→decode 生命周期
  场景2: ★ 4 个请求共享 1100+ tokens 前缀 — 爆发式 HIT（12 次）
  场景3: 批量短请求 — block 分配/释放和 batch decode
  场景4: 跨批次前缀缓存 — 两个独立的 generate 调用共享前缀，持久化命中
"""

import os

if "NANOVLLM_TRACE" not in os.environ:
    os.environ["NANOVLLM_TRACE"] = "2"

MODEL_PATH = os.path.expanduser("~/huggingface/Qwen3-0.6B/")

if not os.path.isdir(MODEL_PATH):
    print(f"⚠ 模型路径不存在: {MODEL_PATH}")
    print("  请修改 MODEL_PATH 为你的实际模型路径，或运行:")
    print("  huggingface-cli download --resume-download Qwen/Qwen3-0.6B \\")
    print("    --local-dir ~/huggingface/Qwen3-0.6B/ \\")
    print("    --local-dir-use-symlinks False")
    exit(1)

from nanovllm import LLM, SamplingParams
from transformers import AutoTokenizer


def make_long_shared_prefix(tokenizer, target_tokens: int = 1100) -> str:
    """构造一段足够长的共享前缀，确保跨越多于 4 个满 block（256 tokens/block）。

    前缀缓存只对「满 block（恰好 256 tokens 的块）」生效。
    target_tokens=1100 → ceil(1100/256)=5 blocks，其中 4 个满块可缓存。
    """
    base = (
        "The transformer architecture introduced by Vaswani et al has fundamentally changed "
        "the landscape of machine learning. At its core the self-attention mechanism computes "
        "weighted representations of each token by considering all other tokens in the sequence. "
        "This is achieved through three learned projections queries keys and values. "
        "The query of a token is compared with the keys of all tokens to produce attention scores "
        "which are then normalized through a softmax operation and used to aggregate the values. "
        "Multi-head attention extends this by performing multiple attention operations in parallel "
        "each with its own set of learned projections allowing the model to capture different types "
        "of relationships simultaneously. Positional encodings are added to the input embeddings "
        "to provide the model with information about token positions since the self-attention "
        "operation itself is permutation invariant. The feed-forward network in each transformer "
        "layer consists of two linear transformations with a non-linear activation function in "
        "between typically a GELU or ReLU variant. Layer normalization is applied before each "
        "sub-layer and residual connections help with gradient flow during training. "
        "The decoder-only architecture popularized by GPT models uses causal masking to ensure "
        "that each token can only attend to previous tokens making it suitable for autoregressive "
        "generation tasks. Training is typically done using the next-token prediction objective "
        "where the model learns to predict each subsequent token given the preceding context. "
        "Scaling laws have shown that model performance improves predictably with increases in "
        "model size dataset size and compute budget. Large language models based on this "
        "architecture have demonstrated remarkable capabilities in text generation translation "
        "summarization and code synthesis among many other tasks. "
    )
    text = base
    while len(tokenizer.encode(text)) < target_tokens:
        text += " " + base
    return text


def print_header(title: str, desc: str):
    w = 68
    print()
    print("=" * w)
    print(f"  {title}")
    print(f"  {desc}")
    print("=" * w)
    print()


# ─────────────────────────────────────────────────────────────────
#  场景 1：单个短请求 — 完整 prefill→decode
# ─────────────────────────────────────────────────────────────────
def scene1(llm, tokenizer):
    print_header("场景 1: 单个短请求",
                 "观察一个简短 prompt 从 prefill 到 decode 的完整 KV Cache 运作")
    prompt = tokenizer.apply_chat_template(
        [{"role": "user", "content": "What is 2+2?"}],
        tokenize=False, add_generation_prompt=True,
    )
    outputs = llm.generate([prompt], SamplingParams(temperature=0.6, max_tokens=24))
    print(f"  结果: {outputs[0]['text']!r}")


# ─────────────────────────────────────────────────────────────────
#  场景 2：★ 爆发式前缀缓存 — 4 请求同批次，共享 1100+ tokens
# ─────────────────────────────────────────────────────────────────
def scene2(llm, tokenizer):
    print_header("场景 2: 爆发式前缀缓存（★ 核心演示）",
                 "4 个请求共享 ~1100 tokens 前缀 → 第一批 MISS×5, 后三批各 HIT×4")

    shared_text = make_long_shared_prefix(tokenizer, target_tokens=1100)
    st = tokenizer.encode(shared_text)
    n_full = len(st) // 256          # 满 block 数（可缓存）
    n_partial = len(st) % 256        # 最后一个部分块（不可缓存）
    print(f"  共享前缀: {len(st)} tokens "
          f"→ {n_full} 个满 block（可缓存）+ {n_partial}tok 部分块")

    suffixes = [
        "\n\nQuestion 1: What is the purpose of the softmax operation in the attention mechanism?",
        "\n\nQuestion 2: Why are positional encodings necessary in the transformer architecture?",
        "\n\nQuestion 3: Explain the role of residual connections in deep transformer models.",
        "\n\nQuestion 4: What is the difference between encoder-decoder and decoder-only architectures?",
    ]

    prompts = [shared_text + s for s in suffixes]
    token_lens = [len(tokenizer.encode(p)) for p in prompts]
    for i, tl in enumerate(token_lens):
        nb = (tl + 255) // 256
        print(f"  请求 {chr(65+i)}: {tl} tokens → {nb} blocks "
              f"(期望命中 {n_full} blocks = {n_full * 256} tokens 缓存)")

    sp = SamplingParams(temperature=0.6, max_tokens=8)  # 短 decode，快速演示
    print()
    print("  ★ 注意观察：第一个请求是连续的 MISS，后面的全是连续的 HIT!")
    print()

    outputs = llm.generate(prompts, [sp] * 4)
    for i, out in enumerate(outputs):
        print(f"  请求{chr(65+i)}: {out['text'][:60]!r}...")


# ─────────────────────────────────────────────────────────────────
#  场景 3：批量短请求
# ─────────────────────────────────────────────────────────────────
def scene3(llm):
    print_header("场景 3: 批量短请求",
                 "同时发送多个短请求，观察 block 分配、释放和 batch decode")
    prompts = [
        "Say 'hello' in French.",
        "Say 'hello' in Spanish.",
        "Say 'hello' in German.",
        "Say 'hello' in Japanese.",
    ]
    sps = [SamplingParams(temperature=0.6, max_tokens=12) for _ in prompts]
    outputs = llm.generate(prompts, sps)
    for p, o in zip(prompts, outputs):
        print(f"  {p!r} → {o['text']!r}")


# ─────────────────────────────────────────────────────────────────
#  场景 4：跨批次前缀缓存持久化
# ─────────────────────────────────────────────────────────────────
def scene4(llm, tokenizer):
    print_header("场景 4: 跨批次前缀缓存持久化",
                 "第一个 generate 填充缓存后，第二个 generate 仍然能命中")

    shared_text = make_long_shared_prefix(tokenizer, target_tokens=600)
    st = tokenizer.encode(shared_text)
    n_full = len(st) // 256
    print(f"  共享前缀: {len(st)} tokens → {n_full} 个满 block 可缓存")

    sp = SamplingParams(temperature=0.6, max_tokens=8)

    print("\n  >>> 批次1: 请求A (建立缓存)...")
    p1 = shared_text + "\n\nTask: Summarize the key points about attention mechanisms."
    llm.generate([p1], sp)

    print("\n  >>> 批次2: 请求B (跨批次复用——应出现 HIT!)...")
    p2 = shared_text + "\n\nTask: Summarize the key points about positional encodings."
    llm.generate([p2], sp)


# ─────────────────────────────────────────────────────────────────
def main():
    print()
    print("╔" + "═" * 66 + "╗")
    print("║     Nano-vLLM KV Cache 可视化演示                           ║")
    print("║     追踪级别: Lv." + os.environ.get("NANOVLLM_TRACE", "0")
          + f"  |  日志: {os.environ.get('NANOVLLM_TRACE_FILE', '仅终端')}" + " " * 20 + "║")
    print("╚" + "═" * 66 + "╝")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    print(f"\n  加载模型: {MODEL_PATH}")
    llm = LLM(MODEL_PATH, enforce_eager=True, tensor_parallel_size=1, max_num_seqs=8)

    scene1(llm, tokenizer)
    scene2(llm, tokenizer)
    scene3(llm)
    scene4(llm, tokenizer)

    print("\n" + "=" * 68)
    print("  演示完成！提示：")
    print("    NANOVLLM_TRACE=2   →  面板模式（看 HIT/MISS）")
    print("    NANOVLLM_TRACE=3   →  全细节（看 slot_mapping）")
    print("    NANOVLLM_TRACE_FILE=xxx.log  →  保存纯文本日志")
    print("=" * 68)


if __name__ == "__main__":
    main()
