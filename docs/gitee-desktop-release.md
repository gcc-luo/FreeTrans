# Gitee 桌面端自动发布

仓库中的 `.workflow/desktop-release.yml` 定义了 Gitee Go tag 发布流水线。推送符合版本格式的 tag（例如 `v7.1.2` 或 `v7.1.2-beta.1`）后，流水线会在 macOS 与 Windows 主机组分别构建安装包和自动更新文件，并将产物上传到同一个 Gitee Release。

## 首次启用

1. 在 Gitee 仓库开启 Gitee Go，并从代码视图导入 `.workflow/desktop-release.yml`。
2. 配置两个 Gitee Go Agent 主机组，ID 分别为 `ferdium-macos` 和 `ferdium-windows`。两个主机组需要提供对应平台的原生构建环境。
3. 两组主机均需安装 Node.js `22.18.0`、pnpm `10.14.0` 和 Git。macOS 主机需安装 Xcode Command Line Tools；Windows 主机需具备 Electron 原生依赖构建所需的 Visual Studio C++ Build Tools 和 Python。
4. 在 Gitee Go 项目环境变量中添加敏感变量 `GITEE_TOKEN`。令牌需拥有该仓库 Release 创建和附件上传权限。当前客户端更新地址固定为 `BoltTool/ferdium-app`；若发布仓库不同，也要同步修改 `src/electron/ipc-api/giteeReleases.ts` 和 `electron-builder.yml` 中的仓库地址。`GITEE_API_BASE` 可用于覆盖流水线脚本的 API 地址。
5. 添加 macOS 签名所需的敏感变量 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。`CSC_LINK` 指向 Developer ID Application `.p12` 证书文件或证书 URL，所有版本必须使用同一签名身份，才能被 electron-updater 安全地覆盖安装。
6. 推送与 `package.json` 中版本号一致的 tag。流水线会校验 tag 与应用版本一致；包含连字符的版本会发布为预发布版本。

应用端通过公开 Gitee API 查询 macOS 和 Windows 版本及发行说明，不需要把发布写入令牌打包进客户端；用于更新的 Gitee 仓库和 Release 附件必须允许公开读取。Linux 保留当前 GitHub 自动更新源，因为这条 Gitee 流水线只生成 macOS 和 Windows 更新文件。

## 自动更新

macOS 发布上传 DMG、ZIP、`latest-mac.yml` 和 ZIP blockmap；Windows 发布上传 NSIS 安装包、`latest.yml` 和 EXE blockmap。electron-builder 使用 Generic 更新配置生成清单，流水线再把这些文件作为 Gitee Release 附件上传。应用内发行说明读取 Gitee Release 正文；创建 Release 后可在 Gitee 上编辑正文补充具体变更内容。

应用检查更新时通过 Gitee API 选择最新发行版，并确保该版本已包含当前平台的更新清单。关闭 Beta 后只检查正式版本；开启 Beta 后也检查预发布版本。更新下载使用所选 tag 对应的 Gitee Release 附件地址。

macOS 自动更新必须签名；若缺少 `CSC_LINK` 或 `CSC_KEY_PASSWORD`，发布脚本会在构建前停止。用户若从未签名版本升级到首个签名版本，需要先手动安装一次；之后才能使用应用内自动更新。Windows 自动更新使用 NSIS 安装包，不使用 Portable 包。

每个平台的构建步骤会直接上传自己的 Release 附件。Release 创建和重复附件检查均按 tag 执行，因此两个平台并发时可以共用一个 Release。重跑时若该平台的附件已经完整，则整组跳过；若只存在部分附件，脚本会失败并要求先清理该平台的部分附件，避免新旧清单与安装包混用。
