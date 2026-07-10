// ============================================================
//  Mermaid 节点悬浮提示（事件委托版，不依赖渲染时机）
//  核心思路：事件绑在 document 上，利用事件冒泡
//  不管 mermaid 什么时候渲染 SVG，鼠标移上去都能触发
// ============================================================

// tooltip 文本映射表（key 为节点文本归一化形式）
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

// 归一化文本：去空格、去换行、转小写
function normalizeLabel(text) {
  return text.replace(/[\s\n\r]+/g, '').toLowerCase().trim();
}

// 从事件目标向上找到最近的 g.node 元素
function findNodeEl(target) {
  let el = target;
  while (el && el !== document) {
    if (el.classList && el.classList.contains('node')) {
      return el;
    }
    el = el.parentNode;
  }
  return null;
}

// 提取节点文本
function getNodeText(nodeEl) {
  const textEl = nodeEl.querySelector('text');
  if (!textEl) return '';
  const tspans = textEl.querySelectorAll('tspan');
  if (tspans.length > 0) {
    return Array.from(tspans).map(t => t.textContent || '').join('');
  }
  return textEl.textContent || '';
}

// 创建并获取 tooltip 元素（单例）
function getTooltip() {
  let tooltip = document.querySelector('.custom-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

// 当前激活的节点（防止重复查找）
let currentNode = null;

function initEventDelegation() {
  const tooltip = getTooltip();

  // 鼠标移入/移动
  document.addEventListener('mousemove', (e) => {
    const nodeEl = findNodeEl(e.target);

    if (nodeEl) {
      // 进入了新节点
      if (nodeEl !== currentNode) {
        currentNode = nodeEl;
        const rawText = getNodeText(nodeEl);
        const key = normalizeLabel(rawText);
        const tipText = tooltipMap[key];

        if (tipText) {
          tooltip.textContent = tipText;
          tooltip.classList.add('visible');
        } else {
          tooltip.classList.remove('visible');
        }
      }
      // 更新位置
      if (tooltip.classList.contains('visible')) {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
      }
    } else {
      // 离开了节点
      if (currentNode) {
        currentNode = null;
        tooltip.classList.remove('visible');
      }
    }
  });

  // 鼠标快速移出 SVG 区域时兜底隐藏
  document.addEventListener('mouseleave', () => {
    currentNode = null;
    tooltip.classList.remove('visible');
  });
}

// 启动
if (typeof document$ !== 'undefined' && document$.subscribe) {
  // MkDocs Material：每次页面内容刷新都确保事件已绑定（只绑一次）
  let bound = false;
  document$.subscribe(function() {
    if (!bound) {
      initEventDelegation();
      bound = true;
    }
  });
} else {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEventDelegation);
  } else {
    initEventDelegation();
  }
}
