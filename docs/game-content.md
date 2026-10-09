# 游戏内容与审核

## 自动三语

开发者选择“简介与正文的原文语言”，填写一种语言即可。提交时只为缺失的游戏名、简介和正文生成英文、简体中文、韩文；不覆盖人工内容。Steam 导入会保留其已有三语简介和正文，原文被编辑后不再沿用对应的旧译文。

新申请仍为 `pending`，不会自动上架。后台“自动补全缺失三语”生成的是编辑框草稿，必须检查并点击“保存三语内容”；审核通过仍是独立操作。已有游戏不会被批量修改。

服务可选择 OpenAI、DeepSeek 或 Kimi，采用兼容 Chat Completions 的接口。OpenAI 使用严格 JSON Schema；DeepSeek 和 Kimi 使用 JSON 模式，三者均在应用层校验缺失字段、长度与响应完整性。

| `TRANSLATION_PROVIDER` | 密钥所属平台 | 固定 API 地址 | 默认模型 |
| --- | --- | --- | --- |
| `openai`（未设置时） | OpenAI | `api.openai.com` | `gpt-4.1-mini` |
| `deepseek` | DeepSeek | `api.deepseek.com` | `deepseek-chat` |
| `kimi` | Moonshot 中国站 | `api.moonshot.cn` | `moonshot-v1-32k` |

可用 `TRANSLATION_MODEL` 指定该平台当前可用的其他兼容模型。默认模型名属于兼容配置，真实可用性需要在有密钥后验证；不接受自定义 API 地址。Kimi 国际站密钥的目标与中国站不同，本实现使用中国站密钥。

配置：

1. 在所选平台创建 API Key，并确保有可用额度。网页版会员通常不提供 API 额度，不同平台密钥不可混用。
2. 在 Codex 环境的密钥设置填写 `TRANSLATION_API_KEY`，将该密钥的允许目标设为表中的对应 API 主机。设置普通变量 `TRANSLATION_PROVIDER` 为 `deepseek`、`kimi` 或 `openai`，用于本地验证。不要把密钥提交到 Git。
3. 在 Cloudflare Pages 的 `sry-projects` 项目 Production 设置中，将 `TRANSLATION_API_KEY` 配置为 **加密 Secret**，并将 `TRANSLATION_PROVIDER` 配置为普通变量。两者必须匹配。在 Pages 里填写真实密钥，不能复制 Codex 进程内的代理占位值。Preview 若要验证，需要独立配置密钥及测试 D1/R2 绑定。
4. 必要时在两处设置 `TRANSLATION_MODEL`。部署后，用测试申请验证三语生成并检查实际译文质量。

密钥创建入口：[DeepSeek](https://platform.deepseek.com/) · [Kimi / Moonshot](https://platform.moonshot.cn/) · [OpenAI](https://platform.openai.com/api-keys)。

密钥缺失、服务超时、额度不足或返回格式无效时，申请保留原文并提示翻译未完成；后台可以重试。不会把原文复制三份冒充译文。真实模型质量与时延需要有凭据后验证。全文沿用 2000 字符限制，翻译会要求保持事实并精简到限制内，审核时应检查专有名词与事实。

## 描述排版

编辑器提供标题、粗体、列表、引用和实时预览。预览、详情页和审核页使用同一渲染器。支持普通段落、`## 标题`、`### 子标题`、`**粗体**`、`- 列表`、`1. 有序列表`、`> 引用`、`[链接](https://...)`、`![说明](https://...)`、行内代码和分隔线。

原始 HTML 会作为文本显示；链接、图片仅接受 HTTP(S)，属性进行转义。正文有统一阅读宽度、段落间距、列表样式、图片圆角和说明文字。不需要数据库迁移。

## 删除重复申请

删除按钮通过转义后的 `data-name` 获取名称，不再把 JSON 字符串拼进双引号的事件属性。合作方删除按钮的同类问题一并修复。

管理员确认后，仅删除所选游戏 ID，并在 D1 原子批次中清理该游戏的收藏。云端 schema 的 `game_claims.game_id` 使用 `ON DELETE CASCADE`，会同步清理相应认领记录。不会删除开发者账号、工作室资料或另一条同名申请。删除不存在的 ID 返回 404，不再假报成功。

没有批量删除、自动合并或自动删除生产重复申请。上线前需核对要保留的那一条，现有确认提示仍生效。

## 验证和发布

在已设置的云环境运行：

```sh
cd /workspace/sry-projects
NODE_PATH=/workspace/.setup-tools/node_modules node --test tests/regression.mjs
```

回归覆盖描述安全渲染、Steam 排版保留、翻译补全/失败恢复，以及真实本地 D1 上的提交和管理员删除。翻译服务在这些测试中使用模拟响应，不调用真实模型。

浏览器测试需要 Playwright、系统 Chromium 和一个静态服务器：

```sh
python3 -m http.server 8811 --bind 127.0.0.1
# 在另一终端运行；接口均由测试模拟，不访问生产：
NODE_PATH=/workspace/.setup-tools/node_modules node tests/browser.cjs
```

测试工具安装在仓库外的 `/workspace/.setup-tools`。缺少时安装 Wrangler 4.149.0（包含 Miniflare）和 Playwright；浏览器可用 `CHROMIUM_PATH` 指定。Pages Functions 已用 Wrangler 编译验证。

当前改动为本地待审阅版本，未推送或部署。沿用 GitHub `main` → Cloudflare Pages 的现有发布流程；新部署后检查三语提交、详情页排版、管理员删除，并保留原有 DB/R2、会话和邮件密钥绑定。


### DeepSeek 实测（2026-10-09）

Codex 和 Pages 的 `TRANSLATION_PROVIDER=deepseek`、密钥绑定均已确认；不读取或输出密钥值。默认 `deepseek-chat` 的真实调用成功：短样本 489 tokens，约 1.7 秒；1789 字符中文正文在精简规则调整后用量 1867 tokens，约 3 秒，英文正文 680 字符、韩文正文 369 字符，原文保持不变。最初较长样本的直译超过 2000 字符限制，校验正确拒绝；现在要求合并重复章节、保留独特事实并将译文控制到较小预算。即使模型不遵守预算，服务仍会保留原文并返回未完成状态。

这验证了开发环境里的真实服务调用；代码仍未推送、未部署，不代表线上自动翻译功能已启用。费用按 DeepSeek 当期输入、输出与缓存价格计费。本次余额接口没有显示扣费差额，不能据此认定免费，也不能据此给出精确单次费用。
