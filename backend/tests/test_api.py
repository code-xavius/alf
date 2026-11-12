from httpx import ASGITransport, AsyncClient

from app.main import app


async def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def create_session(http: AsyncClient, title: str = "Cours test") -> dict:
    response = await http.post("/api/sessions", json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()


async def test_health() -> None:
    async with await client() as http:
        response = await http.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


async def test_wordcloud_flow() -> None:
    async with await client() as http:
        session = await create_session(http)
        assert len(session["code"]) == 6

        activity_response = await http.post(
            f"/api/sessions/{session['id']}/activities",
            json={"kind": "wordcloud", "title": "Nuage"},
        )
        assert activity_response.status_code == 201, activity_response.text
        activity = activity_response.json()

        join = await http.post(
            f"/api/sessions/code/{session['code']}/join",
            json={"nickname": "Alice"},
        )
        assert join.status_code == 200, join.text
        participant = join.json()

        word = await http.post(
            f"/api/activities/{activity['id']}/words",
            json={"text": "Python", "participant_id": participant["id"]},
        )
        assert word.status_code == 201, word.text

        results = await http.get(f"/api/activities/{activity['id']}/results")
        assert results.status_code == 200, results.text
        assert results.json()["words"] == [{"text": "Python", "count": 1}]


async def test_poll_flow_and_reveal() -> None:
    async with await client() as http:
        session = await create_session(http, "Vote")
        activity = (
            await http.post(
                f"/api/sessions/{session['id']}/activities",
                json={"kind": "poll", "title": "Quel langage ?"},
            )
        ).json()

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

        participant = (
            await http.post(
                f"/api/sessions/code/{session['code']}/join",
                json={"nickname": "Bob"},
            )
        ).json()

        answer = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 1},
        )
        assert answer.status_code == 200, answer.text
        assert answer.json()["recorded"] is True

        duplicate = await http.post(
            f"/api/questions/{question['id']}/responses",
            json={"participant_id": participant["id"], "value": 0},
        )
        assert duplicate.json()["recorded"] is False

        results = (await http.get(f"/api/activities/{activity['id']}/results")).json()
        assert results["questions"][0]["counts"] == [0, 1]
        assert results["questions"][0]["total"] == 1


async def test_public_session_hides_answers_until_reveal() -> None:
    async with await client() as http:
        session = await create_session(http, "Quiz")
        activity = (
            await http.post(
                f"/api/sessions/{session['id']}/activities",
                json={"kind": "quiz", "title": "Quiz"},
            )
        ).json()
        await http.post(
            f"/api/activities/{activity['id']}/questions",
            json={
                "prompt": "2 + 2 ?",
                "kind": "mcq",
                "options": ["3", "4"],
                "correct_index": 1,
            },
        )

        public = (await http.get(f"/api/sessions/code/{session['code']}")).json()
        assert public["activities"][0]["questions"][0]["correct_index"] is None

        await http.patch(
            f"/api/activities/{activity['id']}",
            json={"state": {"current_question": 0, "revealed": True}},
        )
        revealed = (await http.get(f"/api/sessions/code/{session['code']}")).json()
        assert revealed["activities"][0]["questions"][0]["correct_index"] == 1
