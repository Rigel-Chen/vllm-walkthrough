# KV Cache 源码深度分析

本项目是 vLLM 源码走读系列的 KV Cache 模块专题，旨在系统性梳理 vLLM 中 KV Cache 的管理、调度与分配机制。

## 项目结构

```
kv-cache-analysis/
├── docs/              # 文档源文件
│   ├── index.md       # 首页
│   ├── architecture.md # 调用结构树
│   └── api/           # API 文档（mkdocstrings 自动生成）
├── src/kv_cache/      # vLLM KV Cache 相关源码
├── mkdocs.yml         # MkDocs 配置
└── requirements.txt   # Python 依赖
```

## 快速开始

1. 安装依赖：`pip install -r requirements.txt`
2. 本地预览：`mkdocs serve`
3. 访问 `http://127.0.0.1:8000` 查看文档

## 导航

- [调用结构树](architecture.md) — KV Cache 完整调用链路流程图
- [API 文档](api/block_pool.md) — 各模块源码自动生成的 API 文档
