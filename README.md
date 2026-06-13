# Proxy Checker v5

Proxy Checker 是一个通用免费代理检测工具，支持 HTTP、HTTPS、SOCKS4、SOCKS5、SOCKS5H。它可以批量检测代理可用性，识别出口 IP、国家和 IP 类型，并按常规访问或 AI 服务专项规则筛选结果。

项目地址：[strongshuai/proxy-checker](https://github.com/strongshuai/proxy-checker)

## 适合做什么

- 从多个持续更新的免费代理源拉取代理。
- 批量检测代理是否可用，并区分稳定、不稳定、失效。
- 检查常规 HTTPS 连通性，或针对 OpenAI、Grok、Gemini、Claude 做专项可达性检测。
- 保存可用代理到“我的仓库”，生成稳定 TXT 链接给其他程序拉取。
- 对仓库代理再次检测、导入、导出、复制、按标签筛选。

## v5 主要能力

### 通用检测模式

- 常规代理检测：HTTPS 连通性、出口 IP、国家、IP 类型。
- OpenAI 检测：ChatGPT 首页、OpenAI API、注册页、Cloudflare 识别。
- Grok 检测：grok.com 和 xAI API。
- Gemini 检测：gemini.google.com 和 Gemini API。
- Claude 检测：claude.ai 和 Anthropic API。

### 免费代理源

内置多个动态代理源，包括 Proxifly、ProxyNova、hide.mn、free-proxy-list、CheckerProxy、Spys.me、ProxyScrape、GeoNode、My-Proxy。前端支持单源拉取，也支持一键拉取所有免费代理源并去重。

### 检测工作流

- 无前缀代理自动识别协议。
- 检测轮数可选，默认 2 轮。
- 并发数量可自定义，默认 30。
- 默认跳过已检测代理，也可以强制重检。
- 检测过程中刷新页面不会打断 UI，页面会恢复并继续轮询后端任务。
- 结果按有效、失效、我的仓库分组展示。

### 我的仓库

- 本地保存代理仓库，刷新不丢失。
- 添加到仓库后自动同步云端。
- 每行有效代理可单独添加到仓库。
- 仓库按最新添加或更新排序。
- 仓库支持等级、服务可达、API 可达、CF 绕过、可注册、机房、住宅、国家等标签筛选。
- 仓库链接使用浏览器稳定 token，公共部署时不同用户不会互相覆盖。

### 访问密码

默认启用登录密码，防止公开部署后被路人直接操作。

- 默认密码：`linux.do`
- 推荐上线后立即修改。
- 同源部署登录前只返回独立登录页，不下发主界面 HTML 和 `app.js`。
- 同源部署登录状态使用 HttpOnly Cookie。
- GitHub Pages 等跨域前端会使用登录后返回的访问令牌。
- 纯静态前端无法隐藏已经发布出去的 HTML，只能保护后端操作接口；需要完整页面门禁时请使用同源自托管部署。
- 仓库 TXT / JSON 分享链接仍保持公开可拉取，方便给其他程序使用。

## v4 到 v5 更新内容

- 从 ChatGPT / OpenAI 专用检测器升级为通用代理检测器。
- 新增 `generic`、`openai`、`grok`、`gemini`、`claude` 五种检测模式。
- 新增服务可达、API 可达、出口 IP、国家、IP 类型等通用结果字段。
- 新增多个持续更新的免费代理源，并支持一键聚合拉取。
- 合并前端入口，根目录 `index.html` 和 `app.js` 是唯一前端源码。
- 我的仓库改为浏览器稳定 token，避免公共部署互相覆盖。
- 我的仓库新增标签筛选、单行添加、自动云端同步、最新置顶。
- 检测任务支持刷新恢复。
- 新增并发数量自定义。
- 新增访问密码保护。
- Smoke test 改为无服务器密码、可指定 base URL 和登录密码。
- 发布默认端口保持 `8888`，私有服务器端口不写入公开代码。

## 快速开始

```bash
git clone https://github.com/strongshuai/proxy-checker.git
cd proxy-checker
pip install -r requirements.txt
python server.py
```

打开：

```text
http://localhost:8888
```

首次登录默认密码：

```text
linux.do
```

## 部署位置很重要

最好把 Proxy Checker 部署在你实际跑号、跑业务、调用目标服务的那台服务器上。

代理检测不是一个绝对结果，而是“检测服务器 -> 代理 IP -> 目标服务”这条链路在当前时间点是否可用。其他服务器能检测出有效代理，只能说明那台服务器可以连通这个代理 IP；不代表你的服务器也一定能连通。最终要看你的服务器能不能连上代理 IP，以及这个代理从你的服务器出口访问目标服务时是否正常。

简单说：谁要用代理，谁来测，结果才最有参考价值。

## 配置

默认配置在 [config.json](./config.json)。上线部署建议新建 `config.local.json` 覆盖私有配置，`config.local.json` 已加入 `.gitignore`，不会被提交。

示例：

```json
{
  "auth_password": "change-me",
  "auth_session_days": 7,
  "max_concurrent": 30,
  "max_concurrent_limit": 200,
  "port": 8888,
  "log_file": "server.log"
}
```

配置优先级：

```text
环境变量 > config.local.json > config.json > 程序默认值
```

可用配置：

| 配置项 | 环境变量 | 默认值 | 说明 |
|---|---|---:|---|
| `auth_password` | `AUTH_PASSWORD` | `linux.do` | 登录密码，留空可关闭密码保护 |
| `auth_session_days` | `AUTH_SESSION_DAYS` | `7` | 登录有效天数 |
| `max_concurrent` | `MAX_CONCURRENT` | `30` | 默认检测并发数 |
| `max_concurrent_limit` | `MAX_CONCURRENT_LIMIT` | `200` | 用户可设置的最大并发数 |
| `port` | `PORT` | `8888` | HTTP 服务端口 |
| `log_file` | `LOG_FILE` | `server.log` | 服务日志路径 |

## systemd 示例

```ini
[Unit]
Description=Proxy Checker
After=network.target

[Service]
WorkingDirectory=/opt/proxy-checker
ExecStart=/usr/bin/python3 /opt/proxy-checker/server.py
Restart=always
Environment=PORT=8888
Environment=AUTH_PASSWORD=change-me

[Install]
WantedBy=multi-user.target
```

## Smoke Test

```bash
python tools/smoke.py --base-url http://localhost:8888 --password linux.do
```

测试内容包括：

- `/api/capabilities`
- 登录认证
- 前端关键元素和函数
- `/api/start` 默认常规检测
- 5 个检测模式的无效代理回归

## 项目结构

```text
proxy-checker/
├── index.html          # 前端页面
├── app.js              # 前端逻辑
├── server.py           # Python HTTP 服务
├── api/index.py        # Serverless / Flask 入口
├── proxy_check.py      # 代理检测核心
├── fetch_proxies.py    # 免费代理源
├── config.json         # 默认配置
├── tools/smoke.py      # Smoke test
├── PRODUCT.md          # 产品上下文
├── requirements.txt    # Python 依赖
└── README.md
```

## 发布前提醒

- 修改默认登录密码。
- 尽量部署在实际使用代理的服务器上，避免“别的机器测通、你的机器用不了”的误判。
- 不要提交 `config.local.json`、`.env`、日志文件、仓库数据、检测历史。
- 如果部署在公网，建议使用反向代理加 HTTPS。
- 免费代理质量波动很大，检测结果只代表当前时间点。

## License

MIT License
