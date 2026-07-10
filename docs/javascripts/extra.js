// tooltip 文本映射表（key 为节点文本的归一化形式：去空格、去换行、小写）
const tooltipMap = {
  'llmengine.generate': '对外的总入口，接收用户请求并驱动生成流程。',
  'enginecore.add_request': '将请求封装并注册到引擎核心，准备调度。',
  'scheduler.schedule': '核心调度器，决定哪些请求可以执行或需要抢占。',
  '能否分配kvcache?': '判断当前可用缓存是否满足请求需求。',
  'scheduler.allocate_slot': '为请求分配槽位，并调用 KV Cache 管理器获取物理块。',
  '等待或抢占': '内存不足时暂停请求或回收低优先级缓存。',
  'kvcachemanager.allocate': '协调不同 KV 类型的统一分配，委托给具体管理器。',
  'singletypekvcachemanager.allocate': '针对单一数据类型的物理块分配。',
  'blockpool.get_new_blocks': '从空闲队列中取出指定数量的物理块。',
  'blocktable.append': '将新分配的物理块 ID 追加到逻辑块表中。',
  'kvcachemanager.free': '释放请求占用的所有物理块。',
  'blockpool.free_blocks': '减少引用计数，计数归零时回收块到空闲队列。',
  'modelrunner.prepare_model_inputs': '构建 block_table 和 slot_mapping 等张量输入。',
  'modelrunner.execute_model': '执行一次模型前向传播，计算 logits 并采样。',
  'attentionbackend操作物理kvcache': '根据 slot_mapping 将当前 token 的 KV 值写入物理缓存。',
};

// 归一化文本：去空格、去换行、转小写，用于模糊匹配
function normalizeLabel(text) {
  return text.replace(/[\s\n\r]+/g, '').toLowerCase().trim();
}

// 提取节点文本（兼容多行 tspan 和各种节点形状）
function getNodeText(node) {
  const textEl = node.querySelector('text');
  if (!textEl) return '';
  const tspans = textEl.querySelectorAll('tspan');
  if (tspans.length > 0) {
    return Array.from(tspans).map(t => t.textContent || '').join('');
  }
  return textEl.textContent || '';
}

// 绑定 tooltip 事件
function attachTooltips(svg) {
  const nodes = svg.querySelectorAll('g.node');
  if (nodes.length === 0) return false;

  // 创建 tooltip 元素（全局复用）
  let tooltip = document.querySelector('.custom-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);
  }

  let boundCount = 0;

  // 为每个节点绑定事件
  nodes.forEach(node => {
    const rawText = getNodeText(node);
    const key = normalizeLabel(rawText);
    const tipText = tooltipMap[key];

    if (!tipText) return; // 未在映射表中的节点跳过

    // 使用 mouseover/mouseout，兼容性比 mouseenter/mouseleave 更好（SVG 场景）
    node.addEventListener('mouseover', (e) => {
      tooltip.textContent = tipText;
      tooltip.classList.add('visible');
    });

    node.addEventListener('mousemove', (e) => {
      // 使用 clientX/clientY + fixed 定位，避免页面滚动偏移问题
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';
    });

    node.addEventListener('mouseout', () => {
      tooltip.classList.remove('visible');
    });

    boundCount++;
  });

  return boundCount > 0;
}

// 尝试初始化：先直接检查，再用 observer 兜底
function tryInit() {
  const mermaidDivs = document.querySelectorAll('div.mermaid');
  let success = false;

  mermaidDivs.forEach(div => {
    const svg = div.querySelector('svg');
    if (svg) {
      if (attachTooltips(svg)) {
        success = true;
      }
    }
  });

  return success;
}

function initMermaidTooltips() {
  // 先立即尝试一次（页面加载完 mermaid 可能已经渲染好了）
  if (tryInit()) return;

  // 如果没找到，用 MutationObserver 继续等待渲染
  let observer;
  const timeoutId = setTimeout(() => {
    if (observer) observer.disconnect();
  }, 10000); // 10秒超时兜底

  observer = new MutationObserver((mutations, obs) => {
    if (tryInit()) {
      obs.disconnect();
      clearTimeout(timeoutId);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// 兼容 MkDocs Material 的 document$，同时降级处理
if (typeof document$ !== 'undefined' && document$.subscribe) {
  document$.subscribe(function() {
    initMermaidTooltips();
  });
} else {
  // 降级：等 DOM 就绪后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMermaidTooltips);
  } else {
    // 已经加载完，延迟一点等 mermaid 渲染
    setTimeout(initMermaidTooltips, 500);
  }
}