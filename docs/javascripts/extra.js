document$.subscribe(function() {
  // 等待 Markdown 内容渲染完毕，再监听 Mermaid 图表
  initMermaidTooltips();
});

// tooltip 文本映射表（与你的节点文本严格一致）
const tooltipMap = {
  'LLMEngine.generate': '对外的总入口，接收用户请求并驱动生成流程。',
  'EngineCore.add_request': '将请求封装并注册到引擎核心，准备调度。',
  'Scheduler.schedule': '核心调度器，决定哪些请求可以执行或需要抢占。',
  '能否分配\nKV Cache?': '判断当前可用缓存是否满足请求需求。',
  'Scheduler.allocate_slot': '为请求分配槽位，并调用 KV Cache 管理器获取物理块。',
  '等待或抢占': '内存不足时暂停请求或回收低优先级缓存。',
  'KVCacheManager.allocate': '协调不同 KV 类型的统一分配，委托给具体管理器。',
  'SingleTypeKVCacheManager.allocate': '针对单一数据类型的物理块分配。',
  'BlockPool.get_new_blocks': '从空闲队列中取出指定数量的物理块。',
  'BlockTable.append': '将新分配的物理块 ID 追加到逻辑块表中。',
  'KVCacheManager.free': '释放请求占用的所有物理块。',
  'BlockPool.free_blocks': '减少引用计数，计数归零时回收块到空闲队列。',
  'ModelRunner.prepare_model_inputs': '构建 block_table 和 slot_mapping 等张量输入。',
  'ModelRunner.execute_model': '执行一次模型前向传播，计算 logits 并采样。',
  'Attention Backend\n操作物理 KV Cache': '根据 slot_mapping 将当前 token 的 KV 值写入物理缓存。',
};

function initMermaidTooltips() {
  // 使用 MutationObserver 确保 Mermaid 图表已被渲染
  const observer = new MutationObserver((mutations, obs) => {
    const mermaidDivs = document.querySelectorAll('div.mermaid');
    if (mermaidDivs.length === 0) return;

    const svgContainer = mermaidDivs[0]; // 假设你的结构树是第一个 Mermaid 图
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    // 图表已就绪，停止观察并绑定事件
    obs.disconnect();
    attachTooltips(svg);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function attachTooltips(svg) {
  const nodes = svg.querySelectorAll('g.node');
  if (nodes.length === 0) return;

  // 创建 tooltip 元素（全局复用）
  const tooltip = document.createElement('div');
  tooltip.className = 'custom-tooltip';
  document.body.appendChild(tooltip);

  // 为每个节点绑定事件
  nodes.forEach(node => {
    // 提取节点文本（兼容多行 tspan）
    let text = '';
    const textEl = node.querySelector('text');
    if (textEl) {
      const tspans = textEl.querySelectorAll('tspan');
      if (tspans.length > 0) {
        text = Array.from(tspans).map(t => t.textContent).join('\n');
      } else {
        text = textEl.textContent || '';
      }
    }
    const label = text.trim();

    if (!tooltipMap[label]) return; // 未在映射表中的节点跳过

    // 鼠标移入：显示 tooltip
    node.addEventListener('mouseenter', (e) => {
      tooltip.textContent = tooltipMap[label];
      tooltip.classList.add('visible');
    });

    // 鼠标移动：更新位置
    node.addEventListener('mousemove', (e) => {
      tooltip.style.left = (e.pageX + 15) + 'px';
      tooltip.style.top = (e.pageY + 15) + 'px';
    });

    // 鼠标移出：隐藏
    node.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });
  });
}