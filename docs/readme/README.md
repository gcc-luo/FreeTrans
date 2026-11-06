# README 图片与动图

这些素材展示一个虚构的「与海外同事约项目评审」场景，所有内容均在本机离线生成。

## 素材与来源

| 文件                     | 内容                                            |
| ------------------------ | ----------------------------------------------- |
| `product-preview.png`    | 产品概览：中英会话、翻译面板与本地原文预览      |
| `translation-detail.png` | 聊天区域特写，附两处文档标注                    |
| `send-demo.gif`          | 中文输入、译文预览、编辑译文与确认发送，约 8 秒 |
| `history-demo.gif`       | 历史补译、完成进度及重复执行跳过，约 7 秒       |

- **真实复用**：`src/features/messageTranslator/Component.tsx`、`src/styles/layout.scss` 中的翻译面板样式、`store.ts` 生成的消息翻译拦截器，以及项目语言选项与文案。
- **演示替身**：服务导航外壳、WhatsApp 风格的最小聊天页面、联系人、聊天记录、翻译引擎状态、翻译返回与存储桥接。
- 所有网页请求均由 Playwright 本地路由处理；不会访问 WhatsApp 或翻译服务，不会发送真实消息。
- 截图来自浏览器渲染，动图由截图序列编码；没有通过图像生成模型重画产品界面。
- `translation-detail.png` 的紫色提示是文档标注，录制后即从页面移除，不属于产品功能。

这些是**真实翻译组件驱动的离线界面演示**，不能称为完整 Electron 客户端实机截图，也不能用于证明真实服务的网络、登录、消息发送或兼容性。

## 重新录制

使用项目指定的 Node.js 与 pnpm，安装项目依赖和 Playwright Chromium。动图编码还需要 Python 与 Pillow。

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
python -m pip install Pillow
node docs/readme/demo/record.cjs
python docs/readme/demo/encode-gifs.py
```

录制脚本将临时构建文件和逐帧截图写入 `.tmp/readme-demo`，最终素材写入本目录。

修改 `demo/conversation.html` 中的示例消息时，同步调整 `demo/record.cjs` 的离线翻译字典；脚本会检查翻译、原文预览、历史完成与重复跳过是否实际发生。

后续可使用干净的演示账号录制真实 Electron 与 WhatsApp 页面，并替换同名素材；替换后也应同步更新 README 中的来源说明。

[打开素材预览](./gallery.html)
