# Graph Force (Canvas / 暗色蛛网图)

目标：做成类似 Obsidian 的暗色蛛网关系网（灰点 + 灰线 + 文本标签），支持：
- Hover：节点/关联边高亮
- Drag：拖拽节点固定位置
- Pan/Zoom：拖拽空白平移，滚轮缩放
- Click：选中节点，并优先调用 Qt WebChannel 的桥接对象 GraphBridge（如果存在）
- 顶部 HUD：显示 selected / 搜索定位

## 入口
- web/graph_force/index.html

## Qt WebChannel（可选）
如果 Qt 侧注册了 QWebChannel 对象 `GraphBridge`，本页面会自动连接并调用：
- GraphBridge.getGraphJson() -> 返回 JSON 字符串（nodes/links）
- GraphBridge.openNode(nodeJson) -> 点击节点时回调（传 node 的 JSON 字符串）
（如果没有桥接，会自动加载 sample_graph.json）

## Graph JSON 格式
{
  "nodes": [{"id":"welcome","label":"Welcome","path":"..."}],
  "links": [{"source":"welcome","target":"create_link"}]
}
