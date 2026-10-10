# 管理后台加载优化

游戏列表使用 `GET /api/admin/games?summary=1&status=...`，仅返回列表需要的字段。展开单款游戏时再请求 `GET /api/admin/game?id=...`，生成三语编辑器、正文预览和截图。两个接口均检查管理员会话，响应禁止 HTTP 缓存；未指定 `summary=1` 时保留原有完整列表响应。

2026-10-10 对生产数据库执行只读查询，同一组 64 条已通过游戏的完整查询结果 JSON 为 417,401 字节，摘要结果为 23,880 字节，减少约 94%。数据库报告的执行时间分别约 11.5 ms 和 1.3 ms。这是查询结果的测量，不是用户浏览器端的延迟测量；网络、图片和第三方服务仍会影响实际速度。

列表和详情在当前页面内缓存 20 秒；切换已访问栏目可立即显示。写入成功或点击“刷新数据”会清空缓存。收起再展开同一条已加载详情会保留未保存输入；切换栏目或刷新仍会重建列表。图片延迟加载；列表、详情和操作按钮立即显示加载反馈。快速切换栏目会取消旧列表请求，并忽略过期响应。临时网络失败显示刷新提示，登录失效才显示登录提示。

测试使用本地 D1 和浏览器模拟接口，不修改生产数据：

```sh
NODE_PATH=/workspace/.setup-tools/node_modules node --test tests/regression.mjs
# 静态服务器运行在 127.0.0.1:8811 后：
NODE_PATH=/workspace/.setup-tools/node_modules node tests/browser.cjs
NODE_PATH=/workspace/.setup-tools/node_modules node tests/admin-performance.cjs
```

性能测试模拟 100 条游戏和较慢响应，检查按需详情、缓存复用、未保存输入、快速切换、按钮反馈、写入后刷新、错误重试及账号栏目渲染。D1 回归检查摘要字段、详情、计数、旧接口兼容和访问权限。`tests/fixtures/schema.sql` 仅含结构，用于本地测试，不是生产迁移文件。
