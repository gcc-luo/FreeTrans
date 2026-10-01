# GitHub 桌面端发布与更新

FreeTrans 保留 Electron 桌面架构。推送与 `package.json` 版本一致的 tag（例如 `v0.0.2`）后，[发布流水线](../.github/workflows/release.yml)在 GitHub Actions 上构建 macOS 和 Windows 安装包。两个平台产物齐备并通过清单检查后，流水线创建同一个 GitHub Release。带预发布后缀的 tag 会创建预发布版本。

## 发布准备

1. GitHub 仓库及其 Release 必须允许用户公开读取。桌面客户端不包含 GitHub 访问令牌。
2. 在仓库 **Settings → Secrets and variables → Actions** 中配置 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。它们分别是 macOS Developer ID Application 证书 `.p12` 文件的 Base64 编码内容（或可访问地址）和密码。缺少任意一项时，macOS 构建会在发布前停止。每个版本应保持相同签名身份。GitHub Actions 使用仓库自带的 `GITHUB_TOKEN` 发布，不需要单独创建个人访问令牌。
3. 更新 `package.json` 的版本并将代码提交到 GitHub，然后推送相同版本的 tag。流水线会核对 tag 与应用版本，版本不匹配时停止。

## 安装包与更新文件

- macOS：DMG 用于手动安装；ZIP、`latest-mac.yml` 和 blockmap 用于应用内更新。
- Windows：NSIS EXE 用于安装和应用内更新；同时发布 `latest.yml` 和 blockmap。

安装包和更新文件由 `electron-builder` 构建，应用使用 `electron-updater` 从 GitHub Releases 检查和下载更新。发行说明取自所选版本的 GitHub Release 正文。关闭 Beta 时只接收正式版本；开启 Beta 时也可以接收预发布版本。

发布流程先分别验证两个平台的更新清单及其引用文件，再创建 Release，避免公开不完整的版本。macOS 自动更新需要有效代码签名；首次从未签名版本迁移到签名版本的用户需要手动安装一次。Linux 保留现有打包目标，当前 tag 流水线只构建 macOS 和 Windows。
