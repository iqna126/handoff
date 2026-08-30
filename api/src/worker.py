"""Cloudflare Workers 入口：把请求转给 entry.py 里的 FastAPI 应用（ASGI）处理。

这个文件依赖只在 Cloudflare Workers/Pyodide 沙盒里才存在的 `workers`/`js` 模块
（`from workers import ...` 会连带 import `js`），没法在普通 Python 环境里
import 或用 pytest 测——只能靠真机部署验证，跟 api-wodify/prime.py 里 CDP
抓包那部分同一个道理（见那边的说明）。

写法照抄 cloudflare/python-workers-examples 仓库里 `fastapi/` 的可用示例。
第一版自己猜的 `async def on_fetch(request, env)` 写法是错的：真实部署报
ModuleNotFoundError，根因是依赖声明方式（该用 pyproject.toml 的
[dependency-groups] 而不是 requirements.txt）和入口写法（该用
WorkerEntrypoint 子类而不是裸函数）都不对，这版按官方示例改过。
"""

from workers import WorkerEntrypoint

from entry import app, check_wods_freshness


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        import asgi

        return await asgi.fetch(app, request.js_object, self.env)

    async def scheduled(self, controller, env, ctx):
        """Cron Trigger：独立于常开机器的存活校验，见 entry.py 的
        check_wods_freshness 和 DESIGN.md §6.6「独立存活校验」。
        """
        await check_wods_freshness(env)
