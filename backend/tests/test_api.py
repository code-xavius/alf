from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


async def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def create_activity(
    http: AsyncClient,
    kind: str = "wordcloud",
    title: str = "Activité test",
    config: dict | None = None,
) -> dict:
    response = await http.post(
        "/api/activities",
        json={"kind": kind, "title": title, "config": config or {}},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def join(
    http: AsyncClient, code: str, nickname: str, device_id: str | None = None
) -> dict:
    body = {"nickname": nickname}
    if device_id is not None:
        body["device_id"] = device_id
    response = await http.post(f"/api/activities/code/{code}/join", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def test_health() -> None:
    async with await client() as http:
        response = await http.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


async def test_wordcloud_flow() -> None:
    async with await client() as http:
        activity = await create_activity(http)
        assert len(activity["code"]) == 6
        assert activity["status"] == "open"

        participant = await join(http, activity["code"], "Alice")

        word = await http.post(
            f"/api/activities/{activity['id']}/words",
            json={"text": "Python", "participant_id": participant["id"]},
        )
        assert word.status_code == 201, word.text

        public = (await http.get(f"/api/activities/code/{activity['code']}")).json()
        assert public["participant_count"] == 1

        results = await http.get(f"/api/activities/{activity['id']}/results")
        assert results.status_code == 200, results.text
        assert results.json()["words"] == [{"text": "Python", "count": 1}]


async def test_internal_word_batch_requires_token() -> None:
    async with await client() as http:
        activity = await create_activity(http)
        response = await http.post(
            f"/api/internal/activities/{activity['code']}/words/batch",
            json={"words": [{"text": "Python"}]},
        )
        assert response.status_code == 401


async def test_internal_word_batch_inserts_and_dedupes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "internal_token", "test-secret")

    async with await client() as http:
        activity = await create_activity(http)
        participant = await join(http, activity["code"], "Alice")
        word = {
            "id": "11111111-1111-4111-8111-111111111111",
            "text": "Python",
            "participant_id": participant["id"],
        }
        url = f"/api/internal/activities/{activity['code']}/words/batch"
        headers = {"X-ALF-Internal-Token": "test-secret"}

        first = await http.post(url, json={"words": [word, word]}, headers=headers)
        assert first.status_code == 200, first.text
        assert first.json() == {"inserted": 1, "skipped": 1}

        second = await http.post(url, json={"words": [word]}, headers=headers)
        assert second.status_code == 200, second.text
        assert second.json() == {"inserted": 0, "skipped": 1}

        results = await http.get(f"/api/activities/{activity['id']}/results")
        assert results.json()["words"] == [{"text": "Python", "count": 1}]


async def test_poll_flow() -> None:
    async with await client() as http:
        activity = await create_activity(http, "poll", "Quel langage ?")

        question = (
            await http.post(
                f"/api/activities/{activity['id']}/questions",
                json={
                    "prompt": "Langage préféré ?",
                    "kind": "poll",
                    "options": ["Python", "Rust"],
                },
            )
        ).json()

        participant = await join(http, activity["code"], "Bob")

        answer = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 1},
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["recorded"] is True

        changed = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 0},
        )
        assert changed.json()["recorded"] is True
        assert changed.json()["updated"] is True

        results = (await http.get(f"/api/activities/{activity['id']}/results")).json()
        assert results["questions"][0]["counts"] == [1, 0]
        assert results["questions"][0]["total"] == 1


async def test_quiz_response_can_be_changed() -> None:
    async with await client() as http:
        activity = await create_activity(http, "quiz", "Quiz modifiable")
        question = (
            await http.post(
                f"/api/activities/{activity['id']}/questions",
                json={
                    "prompt": "Capitale de la France ?",
                    "kind": "mcq",
                    "options": ["Lyon", "Paris"],
                    "correct_index": 1,
                },
            )
        ).json()

        participant = await join(http, activity["code"], "Alice")

        first = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 0},
        )
        assert first.json()["recorded"] is True
        assert first.json()["is_correct"] is False

        changed = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 1},
        )
        assert changed.json()["recorded"] is True
        assert changed.json()["updated"] is True
        assert changed.json()["is_correct"] is True

        results = (await http.get(f"/api/activities/{activity['id']}/results")).json()
        assert results["questions"][0]["counts"] == [0, 1]
        assert results["questions"][0]["total"] == 1

        await http.patch(
            f"/api/activities/{activity['id']}",
            json={"state": {"current_question": 0, "revealed": True}},
        )
        locked = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 0},
        )
        assert locked.status_code == 400


async def test_public_activity_hides_answers_until_reveal() -> None:
    async with await client() as http:
        activity = await create_activity(http, "quiz", "Quiz")
        await http.post(
            f"/api/activities/{activity['id']}/questions",
            json={
                "prompt": "2 + 2 ?",
                "kind": "mcq",
                "options": ["3", "4"],
                "correct_index": 1,
            },
        )

        public = (await http.get(f"/api/activities/code/{activity['code']}")).json()
        assert public["questions"][0]["correct_index"] is None

        await http.patch(
            f"/api/activities/{activity['id']}",
            json={"state": {"current_question": 0, "revealed": True}},
        )
        revealed = (await http.get(f"/api/activities/code/{activity['code']}")).json()
        assert revealed["questions"][0]["correct_index"] == 1


async def test_public_results_for_embed() -> None:
    async with await client() as http:
        activity = await create_activity(http, "quiz", "Quiz embed")
        question = (
            await http.post(
                f"/api/activities/{activity['id']}/questions",
                json={
                    "prompt": "Capitale de la France ?",
                    "kind": "mcq",
                    "options": ["Lyon", "Paris"],
                    "correct_index": 1,
                },
            )
        ).json()

        participant = await join(http, activity["code"], "Alice")
        await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 1},
        )

        hidden = await http.get(f"/api/activities/code/{activity['code']}/results")
        assert hidden.status_code == 200, hidden.text
        assert hidden.json()["questions"][0]["counts"] == [0, 1]
        assert hidden.json()["questions"][0]["total"] == 1
        assert hidden.json()["questions"][0]["correct_index"] is None

        await http.patch(
            f"/api/activities/{activity['id']}",
            json={"state": {"current_question": 0, "revealed": True}},
        )
        revealed = await http.get(f"/api/activities/code/{activity['code']}/results")
        assert revealed.json()["questions"][0]["correct_index"] == 1


async def test_user_can_use_wordcloud_and_quiz() -> None:
    async with await client() as http:
        wordcloud = await create_activity(http, "wordcloud", "Nuage utilisateur")
        alice = await join(http, wordcloud["code"], "Alice", device_id="sim-alice")
        bob = await join(http, wordcloud["code"], "Bob", device_id="sim-bob")

        submissions = (
            (alice["id"], "Python"),
            (bob["id"], "Python"),
            (bob["id"], "Rust"),
        )
        for participant_id, text in submissions:
            sent = await http.post(
                f"/api/activities/{wordcloud['id']}/words",
                json={"text": text, "participant_id": participant_id},
            )
            assert sent.status_code == 201, sent.text

        visible_words = (
            await http.get(f"/api/activities/{wordcloud['id']}/words/public")
        ).json()
        assert [word["text"] for word in visible_words] == ["Python", "Python", "Rust"]

        cloud_results = (
            await http.get(f"/api/activities/{wordcloud['id']}/results")
        ).json()
        assert cloud_results["words"] == [
            {"text": "Python", "count": 2},
            {"text": "Rust", "count": 1},
        ]

        quiz = await create_activity(http, "quiz", "Quiz utilisateur")
        question = (
            await http.post(
                f"/api/activities/{quiz['id']}/questions",
                json={
                    "prompt": "Capitale de la France ?",
                    "kind": "mcq",
                    "options": ["Lyon", "Paris"],
                    "correct_index": 1,
                },
            )
        ).json()
        quiz_alice = await join(http, quiz["code"], "Alice", device_id="quiz-alice")
        quiz_bob = await join(http, quiz["code"], "Bob", device_id="quiz-bob")

        wrong = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": quiz_alice["id"], "value": 0},
        )
        assert wrong.status_code == 200, wrong.text
        assert wrong.json()["is_correct"] is False

        right = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": quiz_alice["id"], "value": 1},
        )
        assert right.json() == {"recorded": True, "updated": True, "is_correct": True}

        other = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": quiz_bob["id"], "value": 0},
        )
        assert other.json()["is_correct"] is False

        public_quiz = (await http.get(f"/api/activities/code/{quiz['code']}")).json()
        assert public_quiz["questions"][0]["correct_index"] is None

        quiz_results = (await http.get(f"/api/activities/{quiz['id']}/results")).json()
        assert quiz_results["questions"][0]["counts"] == [1, 1]
        assert quiz_results["questions"][0]["total"] == 2

        await http.patch(
            f"/api/activities/{quiz['id']}",
            json={"state": {"current_question": 0, "revealed": True}},
        )
        revealed = (await http.get(f"/api/activities/code/{quiz['code']}")).json()
        assert revealed["questions"][0]["correct_index"] == 1

        locked = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": quiz_bob["id"], "value": 1},
        )
        assert locked.status_code == 400


async def test_close_and_delete_activity() -> None:
    async with await client() as http:
        activity = await create_activity(http, "wordcloud", "À fermer")

        updated = await http.patch(
            f"/api/activities/{activity['id']}",
            json={"status": "closed"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["status"] == "closed"

        refused = await http.post(
            f"/api/activities/code/{activity['code']}/join",
            json={"nickname": "Alice"},
        )
        assert refused.status_code == 400

        deleted = await http.delete(f"/api/activities/{activity['id']}")
        assert deleted.status_code == 204

        missing = await http.get(f"/api/activities/{activity['id']}")
        assert missing.status_code == 404

async def test_participant_list_and_temporary_ban() -> None:
    async with await client() as http:
        activity = await create_activity(http)
        alice = await join(http, activity["code"], "Alice", device_id="device-a")
        bob = await join(http, activity["code"], "Bob", device_id="device-b")

        listed = (
            await http.get(f"/api/activities/{activity['id']}/participants")
        ).json()
        assert [entry["nickname"] for entry in listed] == ["Alice", "Bob"]
        assert listed[0]["device_id"] == "device-a"
        assert listed[0]["ip"] is not None
        assert listed[0]["user_agent"] is not None
        assert listed[0]["banned_until"] is None
        assert listed[0]["banned"] is False

        ban_url = f"/api/activities/{activity['id']}/participants/{alice['id']}/ban"
        banned = await http.post(ban_url, json={"minutes": 10})
        assert banned.status_code == 200, banned.text
        assert banned.json()["banned_until"] is not None
        relisted = (
            await http.get(f"/api/activities/{activity['id']}/participants")
        ).json()
        assert relisted[0]["banned"] is True

        refused = await http.post(
            f"/api/activities/code/{activity['code']}/join",
            json={"nickname": "Alice bis", "device_id": "device-a"},
        )
        assert refused.status_code == 403

        blocked_word = await http.post(
            f"/api/activities/{activity['id']}/words",
            json={"text": "test", "participant_id": alice["id"]},
        )
        assert blocked_word.status_code == 403

        carol = await join(http, activity["code"], "Carol", device_id="device-c")
        assert carol["nickname"] == "Carol"
        assert bob["nickname"] == "Bob"

        unbanned = await http.post(ban_url, json={"minutes": 0})
        assert unbanned.status_code == 200
        assert unbanned.json()["banned_until"] is None

        rejoined = await join(http, activity["code"], "Alice", device_id="device-a")
        assert rejoined["id"] == alice["id"]


def test_presenter_receives_live_updates(monkeypatch) -> None:
    monkeypatch.setattr(settings, "realtime_url", None)
    monkeypatch.setattr(settings, "internal_token", None)

    with TestClient(app) as http:
        created = http.post(
            "/api/activities",
            json={"kind": "wordcloud", "title": "Nuage direct", "config": {}},
        )
        assert created.status_code == 201, created.text
        activity = created.json()

        with http.websocket_connect(f"/ws/{activity['code']}") as socket:
            assert socket.receive_json()["type"] == "presence"

            joined = http.post(
                f"/api/activities/code/{activity['code']}/join",
                json={"nickname": "Alice"},
            )
            assert joined.status_code == 200, joined.text
            participant = joined.json()

            event = socket.receive_json()
            assert event["type"] == "participant_joined"
            assert event["participant_count"] == 1

            socket.send_json(
                {
                    "type": "word",
                    "text": "Nuage",
                    "participant_id": participant["id"],
                }
            )
            event = socket.receive_json()
            assert event["type"] == "word_added"
            assert event["text"] == "Nuage"

        public = http.get(f"/api/activities/{activity['id']}/words/public")
        assert public.status_code == 200, public.text
        assert [word["text"] for word in public.json()] == ["Nuage"]
