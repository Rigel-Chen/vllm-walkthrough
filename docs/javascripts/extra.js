// ============================================================
//  KV Cache Architecture Page — Interactive Features
// ============================================================

// ============================================================
//  1. Node Detail Card (Mermaid click handler)
// ============================================================
const nodeDetails = {
  'llmengine.generate': {
    title: 'LLMEngine.generate',
    subtitle: '引擎入口层',
    description: [
      '对外的总入口，接收用户请求（prompt + sampling params），驱动整个生成流程。',
      '每次用户发送一次对话请求时触发，是整个推理链路的起点。'
    ],
    link: '../api/llm_engine/#llmengine.generate'
  },
  'enginecore.add_request': {
    title: 'EngineCore.add_request',
    subtitle: '引擎入口层',
    description: [
      '将请求封装并注册到引擎核心，分配给 Scheduler 进行调度。',
      'LLMEngine 收到新请求后立即调用，完成请求的入队与初始化。'
    ],
    link: '../api/llm_engine/#enginecore.add_request'
  },
  'scheduler.schedule': {
    title: 'Scheduler.schedule',
    subtitle: '调度决策层',
    description: [
      '核心调度器，决定下一个 step 哪些请求可以执行、哪些需要等待或抢占。',
      '比较所需 KV Cache 与当前可用块数，若不足则触发抢占回收机制。'
    ],
    link: '../api/scheduler/#scheduler.schedule'
  },
  '能否分配kvcache?': {
    title: '能否分配 KV Cache?',
    subtitle: '调度决策层 · 判断分支',
    description: [
      '决策分支节点：判断当前可用缓存是否满足请求需求。',
      '<strong>是</strong> → 调用 allocate_slot 分配新物理块，继续执行。',
      '<strong>否</strong> → 进入等待或抢占流程，调用 free 回收其他请求的缓存。'
    ],
    link: null
  },
  'scheduler.allocate_slot': {
    title: 'Scheduler.allocate_slot',
    subtitle: '调度决策层',
    description: [
      '为请求分配调度槽位，并调用 KVCacheManager 获取物理块。',
      '是调度层向缓存层下发分配指令的核心接口。'
    ],
    link: '../api/scheduler/#scheduler.allocate_slot'
  },
  '等待或抢占': {
    title: '等待或抢占',
    subtitle: '调度决策层 · 异常分支',
    description: [
      '当内存不足时，Scheduler 的两种处理策略：',
      '<strong>等待</strong>：暂停当前请求，等其他请求释放缓存后再执行。',
      '<strong>抢占</strong>：抢先回收低优先级请求的缓存，优先保障高优先级请求。',
      '具体策略由 Scheduler 内部的抢占算法决定。'
    ],
    link: null
  },
  'kvcachemanager.allocate': {
    title: 'KVCacheManager.allocate',
    subtitle: '缓存管理层',
    description: [
      '协调不同 KV 类型（如普通 KV 与跨层共享 KV）的统一分配入口。',
      '向下委托给 SingleTypeKVCacheManager 执行具体分配逻辑。'
    ],
    link: '../api/kv_cache_manager/#kvcachemanager.allocate'
  },
  'singletypekvcachemanager': {
    title: 'SingleTypeKVCacheManager.allocate',
    subtitle: '缓存管理层',
    description: [
      '针对单一数据类型的物理块分配器。',
      '调用 BlockPool 的底层方法，从空闲队列获取物理块。'
    ],
    link: '../api/kv_cache_manager/#singletypekvcachemanager.allocate'
  },
  'blockpool.get_new_blocks': {
    title: 'BlockPool.get_new_blocks',
    subtitle: '缓存管理层',
    description: [
      '从物理块池的空闲队列中取出指定数量的块。',
      '如果空闲块不足，返回失败，上层将触发抢占逻辑。'
    ],
    link: '../api/block_pool/#blockpool.get_new_blocks'
  },
  'blocktable.append': {
    title: 'BlockTable.append',
    subtitle: '缓存管理层',
    description: [
      '将新分配的物理块 ID 追加到请求的逻辑块表中。',
      '建立逻辑块序号到物理块 ID 的映射关系，是地址翻译的基础。'
    ],
    link: '../api/block_table/#blocktable.append'
  },
  'kvcachemanager.free': {
    title: 'KVCacheManager.free',
    subtitle: '缓存管理层',
    description: [
      '释放请求占用的所有物理块的统一入口。',
      '通常发生在请求完成或被抢占时，向下委托给各类型管理器执行释放。'
    ],
    link: '../api/kv_cache_manager/#kvcachemanager.free'
  },
  'blockpool.free_blocks': {
    title: 'BlockPool.free_blocks',
    subtitle: '缓存管理层',
    description: [
      '减少块的引用计数，当引用计数归零时将块放回空闲队列。',
      '支持共享 KV 的引用计数机制，同一块可被多个请求共享。'
    ],
    link: '../api/block_pool/#blockpool.free_blocks'
  },
  'modelrunner.prepare_inputs': {
    title: 'ModelRunner.prepare_model_inputs',
    subtitle: '模型执行层',
    description: [
      '构建模型前向传播所需的 block_table、slot_mapping 等张量。',
      '将逻辑块映射转换为模型可直接使用的物理地址索引。'
    ],
    link: '../api/model_runner/#modelrunner.prepare_model_inputs'
  },
  'modelrunner.execute_model': {
    title: 'ModelRunner.execute_model',
    subtitle: '模型执行层',
    description: [
      '执行一次模型前向传播，计算 logits 并采样下一个 token。',
      '是生成过程中最核心的计算步骤，耗时占比最高。'
    ],
    link: '../api/model_runner/#modelrunner.execute_model'
  },
  'attentionbackend': {
    title: 'Attention Backend',
    subtitle: '模型执行层',
    description: [
      '根据 slot_mapping 将当前 token 的 KV 值写入对应物理块的位置。',
      '完成 KV 缓存的实际写入，是 Attention 算子的一部分。',
      '不同后端（FlashAttention、xFormers）实现细节有差异。'
    ],
    link: '../api/attention_backend/'
  }
};

// ---------- Detail card helpers ----------
function normalizeLabel(text) {
  return text.replace(/[\s\n\r]+/g, '').toLowerCase().trim();
}

function findNodeEl(target) {
  let el = target;
  while (el && el !== document) {
    if (el.classList && el.classList.contains('node')) return el;
    el = el.parentNode;
  }
  return null;
}

function getNodeFirstLine(nodeEl) {
  const textEl = nodeEl.querySelector('text');
  if (!textEl) return '';
  const tspans = textEl.querySelectorAll('tspan');
  if (tspans.length > 0) return tspans[0].textContent || '';
  return textEl.textContent || '';
}

// ---------- Detail card DOM ----------
let overlay, card;

function ensureDetailCard() {
  if (card) return;
  overlay = document.createElement('div');
  overlay.className = 'detail-overlay';

  card = document.createElement('div');
  card.className = 'detail-card';
  card.innerHTML = `
    <div class="detail-card-header">
      <h3 class="detail-card-title"></h3>
      <div class="detail-card-subtitle"></div>
      <button class="detail-card-close" aria-label="关闭">×</button>
    </div>
    <div class="detail-card-body"></div>
    <div class="detail-card-footer">
      <a class="detail-card-link" target="_blank">查看完整 API 文档 →</a>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(card);

  overlay.addEventListener('click', closeDetail);
  card.querySelector('.detail-card-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && card.classList.contains('visible')) closeDetail();
  });
}

function openDetail(data) {
  ensureDetailCard();
  card.querySelector('.detail-card-title').textContent = data.title;
  card.querySelector('.detail-card-subtitle').textContent = data.subtitle;
  const body = card.querySelector('.detail-card-body');
  body.innerHTML = data.description.map(function(p) { return '<p>' + p + '</p>'; }).join('');
  const linkEl = card.querySelector('.detail-card-link');
  if (data.link) {
    linkEl.href = data.link;
    linkEl.classList.remove('no-link');
  } else {
    linkEl.classList.add('no-link');
  }
  overlay.classList.add('visible');
  card.classList.add('visible');
}

function closeDetail() {
  if (overlay) overlay.classList.remove('visible');
  if (card) card.classList.remove('visible');
}

function initClickHandler() {
  document.addEventListener('click', function(e) {
    const nodeEl = findNodeEl(e.target);
    if (!nodeEl) return;
    const firstLine = getNodeFirstLine(nodeEl);
    const key = normalizeLabel(firstLine);
    const data = nodeDetails[key];
    if (data) {
      e.preventDefault();
      e.stopPropagation();
      openDetail(data);
    }
  });
}


// ============================================================
//  2. Architecture Explorer — Section 二 interactive cards
// ============================================================
function initArchExplorer() {
  var explorer = document.querySelector('.arch-explorer');
  if (!explorer) return;

  // Collect all layers
  var layers = explorer.querySelectorAll('.arch-layer');
  if (layers.length === 0) return;

  // Click handler: toggle individual layer
  explorer.addEventListener('click', function(e) {
    var header = e.target.closest('.arch-layer-header');
    if (!header) return;
    var layer = header.closest('.arch-layer');
    if (!layer) return;
    toggleLayer(layer);
  });

  // Keyboard: Enter / Space on header
  explorer.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var header = e.target.closest('.arch-layer-header');
      if (!header) return;
      e.preventDefault();
      var layer = header.closest('.arch-layer');
      if (layer) toggleLayer(layer);
    }
  });

  // Expand all / Collapse all buttons
  var btnExpandAll = explorer.querySelector('.arch-btn-expand-all');
  var btnCollapseAll = explorer.querySelector('.arch-btn-collapse-all');

  if (btnExpandAll) {
    btnExpandAll.addEventListener('click', function() {
      layers.forEach(function(l) { openLayer(l); });
    });
  }
  if (btnCollapseAll) {
    btnCollapseAll.addEventListener('click', function() {
      layers.forEach(function(l) { closeLayer(l); });
    });
  }
}

function toggleLayer(layer) {
  if (layer.getAttribute('data-open') === 'true') {
    closeLayer(layer);
  } else {
    openLayer(layer);
  }
}

function openLayer(layer) {
  layer.setAttribute('data-open', 'true');
  var header = layer.querySelector('.arch-layer-header');
  if (header) header.setAttribute('aria-expanded', 'true');
  var body = layer.querySelector('.arch-layer-body');
  if (body) body.removeAttribute('hidden');
}

function closeLayer(layer) {
  layer.setAttribute('data-open', 'false');
  var header = layer.querySelector('.arch-layer-header');
  if (header) header.setAttribute('aria-expanded', 'false');
  var body = layer.querySelector('.arch-layer-body');
  if (body) body.setAttribute('hidden', '');
}


// ============================================================
//  3. Bootstrap
// ============================================================
function init() {
  initClickHandler();
  initArchExplorer();
}

if (typeof document$ !== 'undefined' && document$.subscribe) {
  var initialized = false;
  document$.subscribe(function() {
    if (!initialized) { init(); initialized = true; }
  });
} else {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
