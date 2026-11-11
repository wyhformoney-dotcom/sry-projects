# 提交须知与协议

## 展示位置

- **提交须知**：三条，显示在 `submit-game.html` 表单顶部（Steam 自动填充上方），说明平台是 B2B 平台、内容面向发行商和投资者撰写。协议页开发者部分的开头也显示同一份须知。
- **游戏提交协议**（开发者）和**合作方协议**（发行商与投资者）：`/terms.html#developer`、`/terms.html#partner`，英、中、韩三语，各七条。
- 开发者在“提交审核”按钮上方勾选同意《游戏提交协议》；合作方在资料页“提交审核”按钮上方勾选同意《合作方协议》。未勾选不能提交。开发者的工作室信息页没有单独的协议。

协议只覆盖免费提交和展示游戏信息，不含收费条款；收费合作另行签订合同。

## 文本与版本

须知和两份协议的全部文字在 `assets/terms.js`，三个页面共用。版本号是协议生效日期，同时写在 `assets/terms.js` 的 `version` 和 `functions/lib/terms.js` 的 `TERMS_VERSION`。协议内容有实质改动时，两处一起改成新日期；`tests/terms.mjs` 会检查两处一致。

浏览器提交时带上页面显示的版本号 `terms_version`。接口在未带版本时返回 `terms_required`，版本与当前不一致时（例如页面是旧缓存）返回 `terms_outdated`，页面提示刷新后重新同意。

## 同意记录

`terms_acceptances` 表按账号、协议（`developer` / `partner`）和版本各记录一行，保留首次同意的时间。同一版本重复提交不新增记录；版本更新后再次提交会新增一行。协议上线前已有的游戏和合作方资料没有同意记录，合作方下次保存资料时需要勾选。

查询示例：

```sql
SELECT a.email, t.doc, t.version, t.accepted_at
FROM terms_acceptances t JOIN accounts a ON a.id = t.account_id
ORDER BY t.id DESC;
```

## 数据库与验证

发布 Functions 前先应用 `migrations/20261111_terms_acceptances.sql`（只新建一张表，不修改现有数据）。未应用时，游戏提交和合作方资料保存会返回服务器错误。

```sh
node --test tests/terms.mjs
# 本地静态服务监听 8811 后：
node tests/terms-browser.cjs
```

本地 D1 测试覆盖：未同意或版本过期时拒绝且不写入、同意后写入并记录、同一版本只记录一次、工作室信息保存不需要协议。浏览器测试覆盖三语须知、勾选与提示、提交的版本号、协议页两份协议及手机宽度。
