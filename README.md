# Listen Instant Ans

[![CI](https://github.com/Vist233/listen-instant-ans/actions/workflows/ci.yml/badge.svg)](https://github.com/Vist233/listen-instant-ans/actions/workflows/ci.yml)

**Listen Instant Ans（听课即答）是一个开源的课堂实时问答工具：** 它通过麦克风持续听写老师讲课（阿里云实时语音识别），在老师提出问题后几秒内，用 MiMo 大模型（`mimo-v2.6-flash`）给出**只含核心要点**的答案（每条不超过 100 字）。提供 macOS 桌面版（`.dmg`）和浏览器版，全部在你自己的电脑上运行，密钥只保存在本机。

**In English:** Listen Instant Ans is an open-source (MIT) live classroom Q&A assistant. It transcribes a lecture from your microphone in real time (Aliyun speech recognition), detects the questions the teacher asks, and shows a concise answer (at most 100 Chinese characters) within seconds using the MiMo LLM. It ships as a macOS desktop app (`.dmg`, arm64 and x64) and a local browser app (Node.js 24+). Audio and keys stay on your machine; the UI is in Chinese.

## 一眼看懂

| 项目 | 说明 |
| --- | --- |
| 做什么 | 听课实时转文字，识别老师的提问，几秒内给出要点答案 |
| 适合谁 | 上课、听讲座、开会时想快速跟上提问的学生和参会者 |
| 语音识别 | 阿里云智能语音交互（实时识别，中文） |
| 答案生成 | 小米 MiMo `mimo-v2.6-flash`（OpenAI 兼容接口） |
| 平台 | macOS 桌面版（Apple 芯片 / Intel）；浏览器版支持任何装有 Node.js 24+ 的系统 |
| 数据位置 | 全部在本机：`~/.listen-instant-ans/`；音频不保存 |
| 费用 | 软件免费（MIT）；MiMo 与阿里云按各自规则计费 |
| 技术栈 | TypeScript、Node.js 24（`node:sqlite`）、Mastra、Electron、原生 JS 前端 |

关键词：课堂实时问答、语音转文字、实时字幕、听课助手、AI 课堂助手、老师提问自动回答、Aliyun ASR、MiMo、Mastra、Electron、macOS。

左侧是历史会话；右侧左栏是麦克风选择、开始/停止录音和**语音转录**，右栏是**问答**。转录和问答都是最新的在最上面。

## 怎么用

你需要两个账号的密钥（各自计费）：

| 用途 | 需要 |
| --- | --- |
| 生成答案 | [MiMo](https://platform.xiaomimimo.com) 的 API Key |
| 语音转文字 | 阿里云「智能语音交互」的 AppKey 和 Token（Token 是临时的，会过期，过期后在“设置”里换一个新的） |

### 方式一：macOS 桌面版（推荐）

1. 到 [Releases](https://github.com/Vist233/listen-instant-ans/releases) 下载适合你电脑的 `.dmg`（Apple 芯片选 `arm64`，Intel 选 `x64`）。
2. 打开 `.dmg`，把 **Listen Instant Ans** 拖进“应用程序”。
3. **第一次打开会被系统拦下**，因为这个应用没有付费的开发者签名（见下文）。请这样放行：
   - 双击打开一次，出现提示后点“完成”；
   - 打开 **系统设置 → 隐私与安全性**，往下找到 *“Listen Instant Ans” 已被阻止*，点 **仍要打开**；
   - 或者在终端执行：`xattr -dr com.apple.quarantine "/Applications/Listen Instant Ans.app"`。
4. 弹出“设置”后填入上面的密钥并保存。
5. 系统问“是否允许使用麦克风”时点 **允许**，选好麦克风，点 **开始录音**。

### 方式二：浏览器版

需要 Node.js 24 或更高。

```bash
git clone https://github.com/Vist233/listen-instant-ans.git
cd listen-instant-ans
npm install
npm start
```

浏览器会自动打开 http://localhost:3100。也可以从 Releases 下载 `listen-instant-ans-web-*.zip`，解压后执行 `node server.mjs --open`，不需要 `npm install`。

首次打开会弹出“设置”。浏览器会在你点“开始录音”时询问麦克风权限。

## 如果没有声音或没有文字

- 录音时麦克风旁边有一条**音量条**。持续几秒完全没有动静，页面会提示“听不到声音”：检查系统有没有静音、是不是选错了设备。
- 提示“没有麦克风权限”：到 **系统设置 → 隐私与安全性 → 麦克风** 里允许本应用（浏览器版则是允许你的浏览器），然后点页面上的“重新检测”。
- 有声音但没有文字：多半是阿里云 Token 过期了，在“设置”里换一个新的。
- 有文字但没有答案：检查 MiMo API Key。页面状态栏会写明哪个环节被跳过以及原因。

## 它是怎么工作的

两条错开的“车道”（A 和 B）每 10 秒各看一次最新的转录，B 比 A 晚 5 秒，所以每 5 秒就有一次新请求。问题一写完就显示，不用等整轮结束；两条车道各自的对话只追加、不改写，让模型服务的缓存生效；重复的问题会被去掉。

## 隐私与安全

- 音频只在你的电脑和阿里云之间传输，**不保存**；转录文字和问答保存在本机 `~/.listen-instant-ans/data.sqlite`。
- 密钥保存在 `~/.listen-instant-ans/settings.json`（仅自己可读），页面和日志里从不显示完整密钥。
- 服务只监听 `127.0.0.1`，并拒绝来自其他网站和其他主机名的请求。
- 卸载应用不会删除 `~/.listen-instant-ans/`，需要时请手动删除。

## 开发

```text
apps/api       后端：车道调度、模型、语音识别、HTTP 接口、SQLite
apps/web       网页界面（原生 JS）和浏览器麦克风采集
apps/desktop   Electron 外壳
packages/contracts   前后端共用的数据类型
scripts        构建脚本（网页版、桌面版、图标）
test/build     构建产物的验证测试
```

```bash
npm run check        # 类型检查
npm test             # 后端、网页界面、桌面辅助代码的测试（离线，不联网、不碰麦克风）
npm run test:build   # 构建网页版和桌面版并验证（macOS 上会生成并安装 .dmg）
npm run build:web    # -> dist/web
npm run build:desktop            # -> dist/desktop/*.dmg  （加 -- --arch=x64 生成 Intel 版）
```

设置 `MIMO_API_KEY` 后，`npm run test:build` 还会让构建出的程序真的回答一个问题。

### 发布

推送形如 `v0.1.0` 的标签，GitHub Actions 会自动构建两个 `.dmg`（arm64、x64）和浏览器版压缩包，并发布到 Releases。也可以在 Actions 页面手动运行 *Release*，只生成文件、不发布。

### 关于签名

没有 Apple 开发者账号（99 美元/年）时，应用只做了本机签名，别人首次打开需要上面的放行步骤。要去掉这一步，需要付费账号做签名和公证；之后只需在 `scripts/build-desktop.mjs` 里配置证书，不用改代码。

## 已知限制

- 目前只有 macOS 桌面版；浏览器版在任何有 Node 24 的系统上都能用。
- 阿里云 Token 需要手动更新。
- 同一道题换了说法，偶尔会被两条车道各答一次（去重的阈值偏保守，宁可多显示一条，也不误删真正的新问题）。
- 老师隔很久重新提问同一个问题时，模型可能因为“已经答过”而不再回答。
- 没有搜索功能：涉及最新新闻、价格等的问题，模型会说明无法核实。

## 常见问题

**它是什么？** 一个本地运行的课堂实时问答工具：听老师讲课，老师一提问，几秒内显示要点答案。

**需要联网和付费吗？** 需要联网调用两项云服务：阿里云智能语音交互（语音转文字）和小米 MiMo（生成答案），都按各自规则计费；本软件本身免费开源。

**音频和密钥会上传到哪里？** 音频只发给阿里云做识别，不保存；密钥只存在本机 `~/.listen-instant-ans/settings.json`，页面和日志不显示完整密钥。

**支持 Windows / Linux 吗？** 目前桌面版只有 macOS。浏览器版在任何装有 Node.js 24+ 的系统上可用。

**答案多久出来？** 问题一写完就显示；两条错开的车道每 5 秒就有一次新请求，通常几秒内能看到答案。具体时间取决于网络和模型服务。

**答案会不会很长？** 不会：每条答案不超过 100 字，只给核心要点。

**能回答最新新闻、价格吗？** 不能，没有搜索功能，模型会说明无法核实。

**为什么 macOS 第一次打开会被拦？** 应用没有付费的 Apple 开发者签名，按上文步骤放行一次即可。

**可以换成别的模型或语音服务吗？** 目前内置 MiMo 和阿里云；代码按模块拆分（`apps/api/src/agent`、`apps/api/src/voice`），可自行扩展。

## 许可证

[MIT](LICENSE)
