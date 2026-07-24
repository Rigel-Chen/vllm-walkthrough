---
hide:
  - navigation
  - toc
---

# 🎬 KV Cache 前缀缓存命中 — 逐步演示

基于真实 trace 数据（Qwen3-0.6B 模型，block_size=256 tokens，697 个物理块）。包含 4 个场景，从简单到复杂全方位展示 KV Cache 运作。

<div class="demo-container">

<!-- ═══════════ Scene Tabs ═══════════ -->
<div class="demo-tabs" id="demo-tabs">
  <button class="demo-tab active" onclick="switchScene(0)">🎯 场景1<br><small>单个短请求</small></button>
  <button class="demo-tab" onclick="switchScene(1)">💥 场景2<br><small>爆发式前缀缓存</small></button>
  <button class="demo-tab" onclick="switchScene(2)">📦 场景3<br><small>批量短请求</small></button>
  <button class="demo-tab" onclick="switchScene(3)">🔄 场景4<br><small>跨批次持久化</small></button>
</div>

<div class="demo-scene-title" id="scene-title"></div>

<!-- ═══════════ Prompt Text Display ═══════════ -->
<div class="demo-prompt-box" id="prompt-box" style="display:none">
  <details open><summary>📝 请求文本内容</summary>
  <div id="prompt-content"></div>
  </details>
</div>

<!-- ═══════════ Controls ═══════════ -->
<div class="demo-controls">
  <button class="demo-btn" id="btn-prev" onclick="stepPrev()">◀ 上一步</button>
  <span class="demo-step-info" id="step-info">步骤 0 / 0</span>
  <button class="demo-btn" id="btn-next" onclick="stepNext()">下一步 ▶</button>
  <button class="demo-btn demo-btn-auto" id="btn-auto" onclick="toggleAuto()">▶ 自动播放</button>
  <button class="demo-btn" id="btn-reset" onclick="resetDemo()">↺ 重置</button>
</div>

<!-- ═══════════ Visualization ═══════════ -->
<div class="demo-stage">
  <div class="demo-section">
    <h3>📦 BlockPool 物理块池 <span style="font-weight:400;font-size:0.8rem;color:var(--fc-muted)">（显示前 15 块，block 0 = null_block）</span></h3>
    <div class="demo-block-grid" id="block-grid"></div>
    <div class="demo-legend">
      <span class="leg-dot" style="background:#e0e4e8"></span>空闲
      <span class="leg-dot" style="background:#ef5350"></span>MISS(新分配)
      <span class="leg-dot" style="background:#66bb6a"></span>HIT(缓存命中)
      <span class="leg-dot" style="background:#ffa726"></span>部分块(未满)
    </div>
  </div>
  <div class="demo-section">
    <h3>📋 请求状态</h3>
    <div class="demo-req-row" id="req-row"></div>
  </div>
</div>

<!-- ═══════════ Explanation ═══════════ -->
<div class="demo-explain" id="demo-explain">
  <div class="demo-explain-icon" id="explain-icon"></div>
  <div class="demo-explain-text" id="explain-text"></div>
</div>

<!-- ═══════════ Stats ═══════════ -->
<div class="demo-stats" id="demo-stats">
  <div class="demo-stat"><div class="demo-stat-num" id="stat-hit">0</div><div class="demo-stat-label">HIT blocks</div></div>
  <div class="demo-stat"><div class="demo-stat-num" id="stat-miss">0</div><div class="demo-stat-label">MISS blocks</div></div>
  <div class="demo-stat"><div class="demo-stat-num" id="stat-rate">0%</div><div class="demo-stat-label">缓存命中率</div></div>
  <div class="demo-stat"><div class="demo-stat-num" id="stat-saved">0</div><div class="demo-stat-label">节省 tokens</div></div>
</div>

</div>

<!-- ═══════════ Styles ═══════════ -->
<style>
.demo-container { margin: 12px 0 28px; }
.demo-tabs { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.demo-tab {
  flex: 1; min-width: 110px; padding: 10px 10px 8px; border: 1.5px solid var(--fc-border);
  border-radius: 8px; background: var(--fc-card-bg); cursor: pointer; font-size: 0.82rem;
  font-weight: 600; color: var(--fc-muted); transition: all 0.18s; text-align: center; line-height: 1.2;
}
.demo-tab small { font-size: 0.68rem; font-weight: 400; display: block; margin-top: 2px; }
.demo-tab:hover { border-color: var(--fc-arrow); }
.demo-tab.active { border-color: var(--md-primary-fg-color, #3f51b5); color: var(--md-primary-fg-color, #3f51b5); box-shadow: 0 0 0 2px rgba(63,81,181,0.12); }
.demo-scene-title { font-size: 1rem; font-weight: 700; margin-bottom: 12px; color: var(--md-default-fg-color); }

.demo-prompt-box {
  margin-bottom: 14px; border: 1.5px solid var(--fc-border); border-radius: 8px; overflow: hidden;
}
.demo-prompt-box summary {
  padding: 8px 14px; font-weight: 600; font-size: 0.82rem; cursor: pointer;
  background: var(--fc-card-bg); color: var(--fc-muted); user-select: none;
}
.demo-prompt-text { padding: 10px 14px; font-size: 0.78rem; line-height: 1.55; color: var(--fc-muted); }
.demo-prompt-text .shared { background: #e8f5e9; padding: 2px 4px; border-radius: 3px; color: #2e7d32; font-weight: 600; }
.demo-prompt-text .unique { background: #fff3e0; padding: 2px 4px; border-radius: 3px; color: #e65100; font-weight: 600; }
[data-md-color-scheme="slate"] .demo-prompt-text .shared { background: #152a18; color: #81c784; }
[data-md-color-scheme="slate"] .demo-prompt-text .unique { background: #2a2010; color: #ffb74d; }
.demo-prompt-note { font-size: 0.72rem; color: var(--fc-muted); margin-top: 6px; }

.demo-controls {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  flex-wrap: wrap; margin-bottom: 16px; padding: 10px 14px;
  background: var(--fc-card-bg, #fafbfc); border: 1.5px solid var(--fc-border); border-radius: 10px;
}
.demo-btn {
  padding: 7px 14px; border: 1.5px solid var(--fc-border);
  border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.8rem;
  font-weight: 600; color: var(--md-default-fg-color, #222); transition: all 0.15s;
}
.demo-btn:disabled { opacity: 0.4; cursor: default; }
[data-md-color-scheme="slate"] .demo-btn { background: #1e2330; }
.demo-btn:hover:not(:disabled) { border-color: var(--md-primary-fg-color, #3f51b5); color: var(--md-primary-fg-color, #3f51b5); }
.demo-btn-auto { color: #1976d2; border-color: #1976d2; }
.demo-step-info { font-size: 0.83rem; font-weight: 600; color: var(--fc-muted); min-width: 90px; text-align: center; }

.demo-stage { display: flex; gap: 18px; flex-wrap: wrap; }
.demo-section { flex: 1; min-width: 270px; }
.demo-section h3 { font-size: 0.92rem; margin: 0 0 8px; }

.demo-block-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;
  padding: 10px; background: #f5f6f8; border-radius: 8px; border: 1px solid var(--fc-border);
}
[data-md-color-scheme="slate"] .demo-block-grid { background: #161b24; }
.demo-block {
  aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
  border-radius: 5px; font-size: 0.68rem; font-weight: 700; font-family: monospace;
  border: 1.5px solid transparent; transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  cursor: default; position: relative; min-width: 36px;
}
.demo-block.free    { background: #e8eaed; color: #9aa0a6; }
.demo-block.miss   { background: #ffebee; color: #c62828; border-color: #ef5350; transform: scale(0.95); }
.demo-block.hit    { background: #e8f5e9; color: #2e7d32; border-color: #66bb6a; animation: pulseHit 0.6s ease-out; }
.demo-block.partial{ background: #fff3e0; color: #e65100; border-color: #ffa726; }
[data-md-color-scheme="slate"] .demo-block.free    { background: #1e2330; color: #5a6070; }
[data-md-color-scheme="slate"] .demo-block.miss   { background: #2a1515; color: #ef5350; }
[data-md-color-scheme="slate"] .demo-block.hit    { background: #152a18; color: #81c784; }
[data-md-color-scheme="slate"] .demo-block.partial{ background: #2a2010; color: #ffb74d; }

@keyframes pulseHit { 0%{transform:scale(1)} 30%{transform:scale(1.12)} 100%{transform:scale(1)} }

.demo-req-row { display: flex; flex-wrap: wrap; gap: 6px; }
.demo-req-card {
  flex: 1; min-width: 120px; max-width: 170px; padding: 8px 10px;
  border-radius: 8px; border: 1.5px solid var(--fc-border); background: var(--fc-card-bg);
  font-size: 0.74rem; line-height: 1.35;
}
.demo-req-card .req-name { font-weight: 700; font-size: 0.8rem; }
.demo-req-card .req-blocks { font-family: monospace; font-size: 0.7rem; color: var(--fc-muted); margin-top: 3px; word-break: break-all; }
.demo-req-card .req-hit  { color: #2e7d32; font-weight: 600; }
.demo-req-card .req-miss { color: #c62828; font-weight: 600; }
.demo-req-card.active { border-color: var(--md-primary-fg-color, #3f51b5); box-shadow: 0 0 0 2px rgba(63,81,181,0.15); }

.demo-legend { display: flex; gap: 14px; margin-top: 6px; font-size: 0.7rem; color: var(--fc-muted); flex-wrap: wrap; }
.leg-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; vertical-align: middle; }

.demo-explain {
  margin-top: 14px; padding: 12px 16px; border-radius: 8px;
  background: #e3f2fd; border: 1.5px solid #90caf9; display: flex; gap: 10px; align-items: flex-start; transition: all 0.3s;
}
[data-md-color-scheme="slate"] .demo-explain { background: #0d2137; border-color: #1565c0; }
.demo-explain-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 1px; }
.demo-explain-text { font-size: 0.82rem; line-height: 1.6; }
.demo-explain-text b { color: #1565c0; }
[data-md-color-scheme="slate"] .demo-explain-text b { color: #64b5f6; }

.demo-stats { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.demo-stat {
  flex: 1; min-width: 90px; text-align: center; padding: 8px 6px;
  background: var(--fc-card-bg); border-radius: 8px; border: 1px solid var(--fc-border);
}
.demo-stat-num { font-size: 1.3rem; font-weight: 800; transition: all 0.3s; }
.demo-stat-label { font-size: 0.68rem; color: var(--fc-muted); margin-top: 1px; }

@media (max-width: 600px) {
  .demo-stage { flex-direction: column; }
  .demo-tab { min-width: 70px; font-size: 0.72rem; padding: 8px 6px 6px; }
}
</style>

<!-- ═══════════ Script ═══════════ -->
<script>
var TOTAL_BLOCKS = 15;
var currentScene = 0;
var currentStep = 0;
var autoTimer = null;
var blockStates = Array(TOTAL_BLOCKS).fill('free');

// ============================================================
//  Scene Data
// ============================================================

var scenes = [
  // ─── Scene 0: 单个短请求 ───
  {
    title: '🎯 场景1: 单个短请求 — 完整 Prefill → Decode 生命周期',
    description: 'Qwen3-0.6B 模型。观察一个简短 prompt 从分配、Prefill 计算、到逐 token Decode、最终释放的完整流程。',
    requests: [
      { id:'S4', name:'请求E', blocks:[0], hitBlocks:[], missBlocks:[0], label:'15 tokens, 1 block' }
    ],
    promptText: '<div class="demo-prompt-text">'
      + '用户输入: <code class="shared">What is 2+2?</code><br>'
      + '（经过 chat template 格式化后 → <b>15 tokens, 需要 1 个 block</b>）<br>'
      + '<div class="demo-prompt-note">💡 block_size=256, 15 个 token 只需 1 个未满块（部分块），不可被前缀缓存</div>'
      + '</div>',
    steps: [
      { title:'初始状态', icon:'🔧',
        text:'KV Cache 初始化完成。<b>697 个物理块</b>，每块 256 tokens / 28MB。<br>等待第一个请求到达。',
        blocks:{}, reqActive:null, hit:0, miss:0, rate:0, saved:0 },
      { title:'请求E 分配', icon:'📥',
        text:'请求E (S4) 到达。<b>15 tokens</b> → 需要 <b>1 个 block</b>。<br><br>Block[0] → 物理块 #0 (15tok) <b>MISS</b><br><br>block_table = <b>[0]</b><br>仅 15 个 token, 远小于 256, 所以是部分块，不进入前缀缓存。',
        blocks:{0:'partial'}, reqActive:0, hit:0, miss:1, rate:0, saved:0 },
      { title:'Prefill 执行', icon:'⚡',
        text:'Prefill 阶段：一次性计算全部 15 个 token 的 attention。<br>耗时 <b>1208ms</b>，速度 <b>12,412 tok/s</b>。<br><br>这一步是计算瓶颈——因为要算完整的 15×15 的 attention 矩阵。',
        blocks:{0:'partial'}, reqActive:-1, hit:0, miss:1, rate:0, saved:0 },
      { title:'Decode 阶段', icon:'🔄',
        text:'进入 Decode 阶段。每步生成 <b>1 个 token</b>。<br>共 23 个 decode step，每次只需处理 1 个 token 的 attention。<br><br>首步耗时 ~795ms（CUDA graph 预热），<br>后续稳定在 <b>~30ms/step (~33K tok/s)</b>。<br><br>💡 Decode 比 Prefill 快得多——因为只需要计算新 token 对历史的 attention。',
        blocks:{0:'partial'}, reqActive:-1, hit:0, miss:1, rate:0, saved:0 },
      { title:'释放', icon:'🗑️',
        text:'请求完成，共生成 <b>24 tokens</b>。<br>释放 block [0] → 归还 BlockPool。<br><br>总耗时 ~2.67s，吞吐量 9 tok/s。<br>因为是部分块，没有写入前缀缓存。',
        blocks:{0:'free'}, reqActive:-1, hit:0, miss:1, rate:0, saved:0 },
    ]
  },

  // ─── Scene 1: 爆发式前缀缓存 ───
  {
    title: '💥 场景2: 爆发式前缀缓存 — 4 请求同批次共享前缀',
    description: '4 个请求共享 ~1100 tokens 的前缀。第一批 MISS 建立缓存，后三批各命中 4 块（1024 tokens）。',
    requests: [
      { id:'S5', name:'请求A', blocks:[1,2,3,4,5], hitBlocks:[],      missBlocks:[1,2,3,4,5], label:'1221t, 首个' },
      { id:'S6', name:'请求B', blocks:[1,2,3,4,6], hitBlocks:[1,2,3,4], missBlocks:[6],          label:'1219t, HIT×4' },
      { id:'S7', name:'请求C', blocks:[1,2,3,4,7], hitBlocks:[1,2,3,4], missBlocks:[7],          label:'1219t, HIT×4' },
      { id:'S8', name:'请求D', blocks:[1,2,3,4,8], hitBlocks:[1,2,3,4], missBlocks:[8],          label:'1221t, HIT×4' },
    ],
    promptText: '<div class="demo-prompt-text">'
      + '<b>🟢 共享前缀</b> (~1100 tokens):<br>'
      + '<code class="shared">The transformer architecture introduced by Vaswani et al has fundamentally changed the landscape of machine learning. At its core the self-attention mechanism computes weighted representations... [中略] ...Large language models based on this architecture have demonstrated remarkable capabilities in text generation translation summarization and code synthesis among many other tasks.</code><br><br>'
      + '<b>🟠 各请求独有的后缀 (suffix):</b><br>'
      + '<code class="unique">请求A: \\n\\nQuestion 1: What is the purpose of the softmax operation in the attention mechanism?</code><br>'
      + '<code class="unique">请求B: \\n\\nQuestion 2: Why are positional encodings necessary in the transformer architecture?</code><br>'
      + '<code class="unique">请求C: \\n\\nQuestion 3: Explain the role of residual connections in deep transformer models.</code><br>'
      + '<code class="unique">请求D: \\n\\nQuestion 4: What is the difference between encoder-decoder and decoder-only architectures?</code><br>'
      + '<div class="demo-prompt-note">💡 1100 tokens → 4 个满 block (4×256=1024 tokens 可缓存) + 1 个部分块。后缀各不相同，仅最后的 1 个块不同。</div>'
      + '</div>',
    steps: [
      { title:'初始状态', icon:'🔧',
        text:'4 个请求同时提交到同一批次。<br>共享前缀 ~1100 tokens，各自有不同的后缀提问。<br><br>前缀缓存当前为空——第一个请求将承担"建立缓存"的角色。',
        blocks:{}, reqActive:null, hit:0, miss:0, rate:0, saved:0 },
      { title:'请求A — 建立缓存', icon:'🟥',
        text:'<b>请求A (S5, 1221 tokens)</b> 第一个分配。<br>前缀缓存为空，全部 MISS。<br><br>Block[0]→#1 (256t) <b>MISS</b>  Block[1]→#2 <b>MISS</b><br>Block[2]→#3 (256t) <b>MISS</b>  Block[3]→#4 <b>MISS</b><br>Block[4]→#5 (197t) <b>MISS</b> — 部分块<br><br>block_table = <b>[1,2,3,4,5]</b><br><br>💡 虽然全是 MISS，但 4 个满块会写入前缀缓存！',
        blocks:{1:'miss',2:'miss',3:'miss',4:'miss',5:'partial'}, reqActive:0, hit:0, miss:5, rate:0, saved:0 },
      { title:'请求B — 爆发式 HIT!', icon:'💥',
        text:'<b>请求B (S6, 1219 tokens)</b> 分配。<br>前缀哈希在 BlockHashToBlockMap 中找到了请求A 的满块！<br><br>Block[0]→#1 <b>🟢 HIT!</b>  Block[1]→#2 <b>🟢 HIT!</b><br>Block[2]→#3 <b>🟢 HIT!</b>  Block[3]→#4 <b>🟢 HIT!</b><br>Block[4]→#6 (195t) <b>MISS</b> — 后缀不同<br><br>block_table = <b>[1,2,3,4,6]</b><br>✅ <b>命中 1024 tokens</b>, 只需计算后缀！',
        blocks:{1:'hit',2:'hit',3:'hit',4:'hit',5:'partial',6:'miss'}, reqActive:1, hit:4, miss:6, rate:40, saved:1024 },
      { title:'请求C — 持续命中', icon:'🎯',
        text:'<b>请求C (S7, 1219 tokens)</b> 分配。<br>前缀块 1-4 被 touch() 保护，ref_cnt 递增。<br><br>全部 4 个满块 <b>🟢 HIT!</b><br>block_table = <b>[1,2,3,4,7]</b><br>✅ <b>命中 1024 tokens</b>',
        blocks:{1:'hit',2:'hit',3:'hit',4:'hit',5:'partial',6:'miss',7:'miss'}, reqActive:2, hit:8, miss:7, rate:53, saved:2048 },
      { title:'请求D — 全部完成', icon:'✅',
        text:'<b>请求D (S8, 1221 tokens)</b> 分配。<br>全部 4 个满块 <b>🟢 HIT!</b><br>block_table = <b>[1,2,3,4,8]</b><br>✅ <b>命中 1024 tokens</b><br><br>4 个请求全部分配完成！',
        blocks:{1:'hit',2:'hit',3:'hit',4:'hit',5:'partial',6:'miss',7:'miss',8:'miss'}, reqActive:3, hit:12, miss:8, rate:60, saved:3072 },
      { title:'Prefill & Decode', icon:'⚡',
        text:'<b>Prefill</b>: 处理 1808 tokens 仅 <b>217ms</b> (8.3M tok/s)<br><b>Decode</b>: 4 序列并行, ~32ms/step, ~124K tok/s<br><br>📊 <b>HIT:12  MISS:8  命中率:60%</b><br>节省 3072 tokens 的 attention 计算！<br><br>💡 未命中部分都是各请求独有的后缀（不同的问题）。',
        blocks:{1:'hit',2:'hit',3:'hit',4:'hit',5:'partial',6:'miss',7:'miss',8:'miss'}, reqActive:-1, hit:12, miss:8, rate:60, saved:3072 },
      { title:'释放', icon:'🗑️',
        text:'4 个请求完成。释放物理块。<br>块 [1,2,3,4] 的 ref_cnt 从 4 递减至 0 → 归还 BlockPool。<br><br>满块的哈希保留在 BlockHashToBlockMap 中，<br>LRU 保护，未来仍可命中。',
        blocks:{}, reqActive:-1, hit:12, miss:8, rate:60, saved:3072 },
    ]
  },

  // ─── Scene 2: 批量短请求 ───
  {
    title: '📦 场景3: 批量短请求 — 无前缀共享对比',
    description: '4 个独立短请求同时处理。由于内容完全不同、无共享前缀，所有块都是 MISS。',
    requests: [
      { id:'S9',  name:'请求J', blocks:[9],  hitBlocks:[], missBlocks:[9],  label:'"Say hello in French"' },
      { id:'S10', name:'请求K', blocks:[10], hitBlocks:[], missBlocks:[10], label:'"Say hello in Spanish"' },
      { id:'S11', name:'请求L', blocks:[11], hitBlocks:[], missBlocks:[11], label:'"Say hello in German"' },
      { id:'S12', name:'请求M', blocks:[12], hitBlocks:[], missBlocks:[12], label:'"Say hello in Japanese"' },
    ],
    promptText: '<div class="demo-prompt-text">'
      + '4 个完全独立的请求，<b>没有共享前缀</b>:<br>'
      + '<code class="unique">请求J: Say \'hello\' in French.</code><br>'
      + '<code class="unique">请求K: Say \'hello\' in Spanish.</code><br>'
      + '<code class="unique">请求L: Say \'hello\' in German.</code><br>'
      + '<code class="unique">请求M: Say \'hello\' in Japanese.</code><br>'
      + '<div class="demo-prompt-note">💡 每个仅 7 tokens, 1 block, 远小于 256 的部分块。无共享前缀 = 全部 MISS。</div>'
      + '</div>',
    steps: [
      { title:'初始状态', icon:'🔧',
        text:'4 个独立短请求同时到达。<br>内容完全不同——前缀缓存无法帮助。<br><br>块 [1-8] 已被之前场景释放（空闲状态）。',
        blocks:{}, reqActive:null, hit:0, miss:0, rate:0, saved:0 },
      { title:'4 请求分配 — 全部 MISS', icon:'📥',
        text:'4 个请求依次分配，每个仅需 1 个块，全部 MISS。<br><br>请求J: block [9], 请求K: block [10]<br>请求L: block [11], 请求M: block [12]<br><br>都是部分块（7 tokens << 256），不进入前缀缓存。<br>⚠️ 与场景2 对比：没有共享前缀 = 无任何命中！',
        blocks:{9:'partial',10:'partial',11:'partial',12:'partial'}, reqActive:-1, hit:0, miss:4, rate:0, saved:0 },
      { title:'Prefill & Decode', icon:'⚡',
        text:'<b>Prefill</b>: 处理 28 tokens，仅 <b>35ms</b> (791K tok/s)<br><b>Decode</b>: 4 序列并行，每步 ~32ms<br>各生成 12 tokens，共 12 个 decode step。<br><br>📊 <b>HIT:0  MISS:4  命中率:0%</b><br>无任何前缀缓存收益。<br><br>💡 对比场景2: 命中的收益来自 token 数量——长前缀才有意义。',
        blocks:{9:'partial',10:'partial',11:'partial',12:'partial'}, reqActive:-1, hit:0, miss:4, rate:0, saved:0 },
      { title:'释放', icon:'🗑️',
        text:'4 个请求完成，释放各自 block。<br>块 [9,10,11,12] → 归还 BlockPool。<br><br>短暂请求，无缓存持久化。',
        blocks:{}, reqActive:-1, hit:0, miss:4, rate:0, saved:0 },
    ]
  },

  // ─── Scene 3: 跨批次持久化 ───
  {
    title: '🔄 场景4: 跨批次前缀缓存持久化',
    description: '两次独立的 generate() 调用共享前缀。第一次填充缓存后，第二次仍能命中——证明缓存跨批次持久化。',
    requests: [
      { id:'S13', name:'请求N (批次1)', blocks:[1,2,13], hitBlocks:[1,2], missBlocks:[13], label:'614t, HIT×2' },
      { id:'S14', name:'请求O (批次2)', blocks:[1,2,14], hitBlocks:[1,2], missBlocks:[14], label:'615t, HIT×2' },
    ],
    promptText: '<div class="demo-prompt-text">'
      + '<b>🟢 共享前缀</b> (~600 tokens):<br>'
      + '<code class="shared">The transformer architecture introduced by Vaswani et al has fundamentally changed the landscape... [中略] ...demonstrated remarkable capabilities in text generation translation summarization and code synthesis among many other tasks.</code><br><br>'
      + '<b>🟠 各请求独有的后缀 (suffix):</b><br>'
      + '<code class="unique">批次1 (请求N): \\n\\nTask: Summarize the key points about attention mechanisms.</code><br>'
      + '<code class="unique">批次2 (请求O): \\n\\nTask: Summarize the key points about positional encodings.</code><br>'
      + '<div class="demo-prompt-note">💡 两次 <b>独立的 generate() 调用</b>。前缀 ~600 tokens → 2 个满 block (512 tokens 可缓存)。块 [1,2] 在场景2 中曾被写入缓存，释放后哈希仍保留。两个批次都能命中！</div>'
      + '</div>',
    steps: [
      { title:'跨批次之前', icon:'🔧',
        text:'两个独立的 <code>llm.generate()</code> 调用即将执行。<br>共享前缀 ~600 tokens，但分属不同批次。<br><br>块 [1,2] 的哈希仍保留在 BlockHashToBlockMap 中<br>（来自之前场景的前缀缓存写入）。',
        blocks:{}, reqActive:null, hit:0, miss:0, rate:0, saved:0 },
      { title:'批次1 — 请求N 命中!', icon:'🎯',
        text:'<b>第一个 generate(): 请求N (S13, 614 tokens)</b><br>块 [1]→#1 <b>🟢 HIT!</b> (256tok)<br>块 [2]→#2 <b>🟢 HIT!</b> (256tok)<br>块 [3]→#13 (102tok) <b>MISS</b> — 后缀+部分<br><br>block_table = <b>[1,2,13]</b>, 命中 <b>512 tokens</b>!<br><br>💡 这是跨批次命中——缓存来自之前的场景！',
        blocks:{1:'hit',2:'hit',13:'miss'}, reqActive:0, hit:2, miss:1, rate:67, saved:512 },
      { title:'请求N — Prefill & Decode', icon:'⚡',
        text:'Prefill: 仅 102 新 tokens (命中 512)，<b>35.6ms</b><br>Decode: 8 个 step，每步 ~30ms<br>生成 8 tokens 后完成。<br><br>释放 blocks [1,2,13]。<br>块 [1,2] ref_cnt 递减，但哈希索引保留。',
        blocks:{1:'hit',2:'hit',13:'miss'}, reqActive:-1, hit:2, miss:1, rate:67, saved:512 },
      { title:'批次2 — 请求O 再次命中!', icon:'🔄',
        text:'<b>第二个 generate(): 请求O (S15, 615 tokens)</b><br><br>块 [1]→#1 <b>🟢 HIT!</b><br>块 [2]→#2 <b>🟢 HIT!</b> — 又一次！<br>块 [3]→#14 (103tok) <b>MISS</b><br><br>block_table = <b>[1,2,14]</b>, 命中 <b>512 tokens</b>!<br><br>🎉 证明了前缀缓存的<b>跨批次持久化</b>——<br>即使前一批已释放，哈希索引仍在，新请求仍可命中。',
        blocks:{1:'hit',2:'hit',14:'miss'}, reqActive:1, hit:4, miss:2, rate:67, saved:1024 },
      { title:'释放 & 总结', icon:'🏁',
        text:'请求O 完成并释放。块 [1,2,14] 归还 BlockPool。<br><br><b>场景4 核心价值:</b><br>🔗 前缀缓存在 <b>不同 generate() 调用之间持久化</b><br>🧹 物理块可以被释放/复用，但哈希索引保留<br>📈 LRU 驱逐机制在空间不足时清理旧哈希<br>⚡ 只要哈希还在，任何时刻的新请求都能命中<br><br>💡 这就是为什么 vLLM 可以在连续多轮对话中持续受益于前缀缓存。',
        blocks:{}, reqActive:-1, hit:4, miss:2, rate:67, saved:1024 },
    ]
  }
];

// ============================================================
//  Rendering
// ============================================================
function switchScene(idx) {
  currentScene = idx; currentStep = 0;
  blockStates = Array(TOTAL_BLOCKS).fill('free');
  stopAuto();
  // Update tabs
  var tabs = document.querySelectorAll('.demo-tab');
  tabs.forEach(function(t,i){ t.classList.toggle('active', i===idx); });
  render();
}

function render() {
  var scene = scenes[currentScene];
  var s = scene.steps[currentStep];

  // Title
  document.getElementById('scene-title').textContent = scene.description;

  // Prompt box
  var pb = document.getElementById('prompt-box');
  var pc = document.getElementById('prompt-content');
  pc.innerHTML = scene.promptText;
  pb.style.display = 'block';

  // Block grid
  var html = '';
  for (var i = 0; i < TOTAL_BLOCKS; i++) {
    var state = (s.blocks[i] !== undefined) ? s.blocks[i] : blockStates[i];
    var label = (i === 0) ? '∅' : i;
    html += '<div class="demo-block ' + state + '" title="Block#' + i + ': ' + state + '">' + label + '</div>';
    blockStates[i] = state;
  }
  document.getElementById('block-grid').innerHTML = html;

  // Requests
  var rh = '';
  for (var j = 0; j < scene.requests.length; j++) {
    var req = scene.requests[j];
    var hb = req.hitBlocks.length, mb = req.missBlocks.length;
    var active = (s.reqActive === j) ? ' active' : '';
    rh += '<div class="demo-req-card' + active + '">';
    rh += '<div class="req-name">' + req.name + '</div>';
    rh += '<div class="req-blocks">blocks: [' + req.blocks.join(',') + ']</div>';
    if (hb+mb > 0) {
      rh += '<div><span class="req-hit">HIT×' + hb + '</span> <span class="req-miss">MISS×' + mb + '</span></div>';
    }
    rh += '<div style="font-size:0.66rem;color:var(--fc-muted)">' + req.label + '</div>';
    rh += '</div>';
  }
  document.getElementById('req-row').innerHTML = rh;

  // Explanation
  document.getElementById('explain-icon').textContent = s.icon;
  document.getElementById('explain-text').innerHTML = s.text;

  // Stats
  document.getElementById('stat-hit').textContent = s.hit;
  document.getElementById('stat-miss').textContent = s.miss;
  document.getElementById('stat-rate').textContent = s.rate + '%';
  document.getElementById('stat-saved').textContent = s.saved;

  // Step info
  document.getElementById('step-info').textContent = '步骤 ' + (currentStep + 1) + ' / ' + scene.steps.length + '  ' + s.title;

  // Buttons
  document.getElementById('btn-prev').disabled = (currentStep === 0);
  document.getElementById('btn-next').disabled = (currentStep >= scene.steps.length - 1);
}

// ============================================================
//  Navigation
// ============================================================
function stepNext() {
  var max = scenes[currentScene].steps.length - 1;
  if (currentStep < max) { currentStep++; render(); }
}
function stepPrev() {
  if (currentStep > 0) { currentStep--; render(); }
}
function resetDemo() {
  currentStep = 0; blockStates = Array(TOTAL_BLOCKS).fill('free');
  stopAuto(); render();
}
function toggleAuto() {
  if (autoTimer) { stopAuto(); }
  else {
    document.getElementById('btn-auto').textContent = '⏸ 暂停';
    autoTimer = setInterval(function() {
      var max = scenes[currentScene].steps.length - 1;
      if (currentStep < max) { currentStep++; render(); }
      else { stopAuto(); }
    }, 3500);
  }
}
function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  document.getElementById('btn-auto').textContent = '▶ 自动播放';
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowRight') stepNext();
  if (e.key === 'ArrowLeft') stepPrev();
});

// Init
switchScene(0);
</script>
