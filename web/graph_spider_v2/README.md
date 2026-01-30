# Graph Spider V2

入口：`web/graph_spider_v2/index.html`

## 解决的问题
- 开局先显示“结构骨架(group)”+“Top-K重要节点”，不再一开始挤爆或空白
- 点击 group 渐进展开（子 group + Top-N 文件节点）
- 点击文件节点进入 Focus（只保留该节点 + 邻居 Top-M）

## 数据来源
优先从 Qt WebChannel：
- `GraphBridge.getGraphJson(): string`

否则使用同目录的 `sample_graph.json`。
