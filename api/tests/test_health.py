"""测试 FastAPI 应用本身（不经过 Workers/Pyodide 运行时，那部分只能真机部署验证）。"""

from fastapi.testclient import TestClient

from entry import app

client = TestClient(app)


def test_health_returns_ok():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
