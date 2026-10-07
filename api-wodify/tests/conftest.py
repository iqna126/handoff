import json
import pathlib

import pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def payload():
    return json.loads((FIXTURES / "workout_response.json").read_text())


@pytest.fixture
def schedule_payload():
    return json.loads((FIXTURES / "schedule_response.json").read_text())
