# GitHub 桌面端发布与更新

FreeTrans 保留 Electron 桌面架构。推送与 `package.json` 版本一致的 tag（例如 `v0.0.2`）后，[发布流水线](../.github/workflows/release.yml)在 GitHub Actions 上构建 macOS 和 Windows 安装包。安装包齐备并通过文件检查后，流水线创建同一个 GitHub Release。带预发布后缀的 tag 会创建预发布版本。

## 发布准备

1. GitHub 仓库及其 Release 必须允许用户公开读取。桌面客户端不包含 GitHub 访问令牌。
2. GitHub Actions 使用仓库自带的 `GITHUB_TOKEN` 发布，不需要单独创建个人访问令牌。macOS 签名是可选的：若有 Apple Developer ID Application 证书，可在仓库 **Settings → Secrets and variables → Actions** 中配置 `CSC_LINK`（`.p12` 的 Base64 内容或可访问地址）与 `CSC_KEY_PASSWORD`。没有证书时仍会构建未签名安装包，用户手动安装时可能需要按 macOS 的安全提示选择打开。
3. 更新 `package.json` 的版本并将代码提交到 GitHub，然后推送相同版本的 tag。流水线会核对 tag 与应用版本，版本不匹配时停止。

## 安装包与更新文件

- macOS：分别构建 Apple Silicon 与 Intel 的 DMG，用户下载对应安装包后手动安装。
- Windows：发布 x64 NSIS EXE，用户下载后手动运行安装程序。

安装包和更新文件由 `electron-builder` 构建。应用从 GitHub Releases 检查版本并显示发行说明；用户点击“下载安装包”后，浏览器下载对应系统和架构的 DMG 或 EXE，由用户自行运行安装包完成更新。后台检查可以关闭，设置页中的手动检查始终可用。关闭 Beta 时只接收正式版本；开启 Beta 时也可以接收预发布版本。

发布流程先验证 macOS 两种架构和 Windows x64 的安装包，再创建 Release，避免公开不完整的版本。当前应用内流程是手动下载安装包，不执行静默安装或自动替换。Linux 保留现有打包目标，当前 tag 流水线只构建 macOS 和 Windows。
