import httpx


def mock_client(handler):
    """按 handler 的逻辑造一个假的出站 client，供 dependency_overrides 用。"""

    async def override():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            yield c

    return override
