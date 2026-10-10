# 开发者联系方式与站内留言

## 查看额度

已认证的合作方每个自然月可以解锁 10 位不同开发者的联系方式，以 UTC 月份计数。重复查看已解锁的开发者免费，其名下其他游戏也不重复扣次数；历史已解锁联系人仍可查看。开发者查看合作方的原有 5 条额度保持不变。并发解锁通过条件写入限制，不能超过额度。

公开的 `/api/games` 不再返回联系邮箱；联系方式只通过需要登录和检查额度的接口返回。合作方选择不公开邮箱时，开发者表达意向不会扣额度，也不会在已解锁列表中暴露该邮箱。

## 留言流程

仅审核通过、类型包含发行或投资的合作方，在当月 10 条额度全部用完后可以留言。月初额度重置后，必须再次用完当月额度。游戏需要已上架，且归属于有效的开发者账号。

在游戏详情页点击“联系开发团队”，用完额度后会显示“给开发者留言”。填写主题和内容发送，开发者在账号中心的“留言箱”查看。已经解锁的联系方式仍正常展示，额度用完后也会显示留言按钮。

留言显示发送方的公司名称、联系邮箱、相关游戏和发送时间。主题最多 120 字符，正文最多 2,000 字符。内容作为纯文本展示；这版没有站内回复和邮件通知。开发者可使用发送方邮箱自行联系。

同一发送方每 24 小时只能给同一开发者发送一条，所有开发者合计每滚动 24 小时最多 20 条。重复点击或网络重试使用同一个请求标识，不会重复生成留言。

留言自发送日起可查看 30 天，超过期限立即无法通过接口读取。数据库中的过期记录在下一次认证后的留言接口请求中删除；未配置后台定时清理。开发者只能读取自己的留言，未读状态在打开详情后更新，留言列表按每批 50 条加载。游戏删除后保留留言中的游戏名称快照。

英文、简体中文、韩文界面均提供留言入口、发送反馈、未读提示和留言箱。

## 数据库与验证

新增表和索引见 `migrations/20261010_developer_messages.sql`。使用 `IF NOT EXISTS`，不会修改现有游戏、账号和查看记录。发布 Functions 前先应用迁移。本地应用命令：

```sh
cd /workspace/sry-projects
XDG_CONFIG_HOME=/workspace/.setup-state/config WRANGLER_LOG_PATH=/workspace/.setup-state/wrangler.log WRANGLER_SEND_METRICS=false /workspace/.setup-tools/node_modules/.bin/wrangler d1 execute DB --config /workspace/.setup-state/local-d1.json --local --persist-to /workspace/.setup-state/pages --file migrations/20261010_developer_messages.sql --yes
NODE_PATH=/workspace/.setup-tools/node_modules node --test tests/messages.mjs tests/regression.mjs
```

这些测试使用独立本地 D1 和本地会话，覆盖额度、重复查看、并发、认证权限、跨月重置、留言幂等性、频次限制、接收者隔离、未读更新、30 天过期、分页和公开接口邮箱保护，不发送真实邮件或留言。

浏览器测试先运行一个静态服务器，再从另一终端执行：

```sh
python3 -m http.server 8812 --bind 127.0.0.1
NODE_PATH=/workspace/.setup-tools/node_modules node tests/messages-browser.cjs
```

浏览器接口由测试模拟，检查首页每页 18 款游戏、Steam 封面 460:215 完整展示、留言入口与额度关系、发送反馈、安全文本显示、未读更新、三语切换和手机布局。封面不再悬停放大，避免重新裁切。

线上验收：刷新首页确认每页 18 款；用已认证的发行商或投资者账号解锁 10 位不同开发者，在第 11 位的游戏详情发送留言；登录该游戏所属的开发者账号，在账号中心查看留言箱和发送方邮箱。当前线上没有已认证的合作方账号时，需要先按正常流程申请并通过审核。
