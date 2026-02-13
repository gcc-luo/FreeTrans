# D-Bus 接口

Ferdium 通过 [D-Bus](https://www.freedesktop.org/wiki/Software/dbus/) 在 Linux 系统上公开进程间通信。
这允许通过显示未读通知的数量来将 Ferdium 与您的桌面环境集成，并静音或取消静音通知。

## 桌面集成

作为集成示例，[`docs/dbus`](dbus) 文件夹包含一个用 Python 编写的状态栏模块。
要运行示例，您需要 Python 3.11 和 [`dbus-next`](https://pypi.org/project/dbus-next/) PyPI 包。

该集成使用 [`ferdium-dbus-py`](https://github.com/victorbnl/ferdium-dbus-py) 客户端库，它是 D-Bus 接口的异步包装器。
它说明了多个高级概念，例如通过 `asyncio` 与 Ferdium 进行异步通信，以及轮询会话 D-Bus 以查看 Ferdium 是否正在运行。

[`ferdium_bar.py`](dbus/ferdium_bar.py) 实现了一个状态栏模块，可与 waybar 或 polybar 等状态栏一起使用。有关如何使用它，请参阅 `ferdium_bar.py --help` 和 `ferdium_bar.py unread --help`。

## 底层 API

通过 D-Bus 公开的底层 API 在 [`org.ferdium.Ferdium.xml`](dbus/org.ferdium.Ferdium.xml) 中使用标准 D-Bus 内省语法记录。

Ferdium 将拥有总线名称 `org.ferdium.Ferdium` 的所有权，并在对象路径 `/org/ferdium` 处公开实现 `org.ferdium.Ferdium` 接口的对象。
