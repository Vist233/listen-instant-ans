# Listen Instant Ans

老师讲课时，持续听写，并在老师提出问题后几秒内给出只含核心要点的答案。全部在本机运行。

## 使用

需要：macOS、Node.js 24 或更高、ffmpeg（`brew install ffmpeg`）。

```bash
npm install
npm start
```

浏览器会自动打开 http://localhost:3100。第一次打开会弹出“设置”，填入：

- **MiMo API Key**：用来生成答案。
- **阿里云 AppKey 和 Token**：用来把语音转成文字。

密钥只保存在这台电脑的 `~/.listen-instant-ans/settings.json`（仅自己可读），不会发到别处。之后随时可以点左下角的“设置”修改，不用重启。也可以用环境变量 `MIMO_API_KEY`、`ALIYUN_APP_ID`、`ALIYUN_TMP_TOKEN`，设置里填的值优先。

然后选好麦克风，点“开始录音”。点“开始录音”会新建一个会话；左侧是历史会话。

## 如果点了录音却没有文字

先确认选的是真正在用的麦克风。如果选对了仍然没有任何文字，最常见的原因是：**启动服务的程序没有麦克风权限**。macOS 不会报错，只会给全零的静音。

请在系统自带的“终端”里运行 `npm start`，并在“系统设置 → 隐私与安全性 → 麦克风”里允许“终端”。

## 开发

```bash
npm run check   # 类型检查
npm test        # 离线测试，不联网、不碰麦克风
```

设计见 [docs/design.md](docs/design.md)，进度与实测记录见 [docs/execution.md](docs/execution.md)。
