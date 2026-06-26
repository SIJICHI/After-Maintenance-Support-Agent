# Copyright 2026 DataRobot, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""LLM-independent unit tests for agent tools.

LangChain @tool decorated functions are StructuredTool objects;
call them via .invoke() with a dict of arguments.
"""

import json

import pytest

from agent.tools import (
    create_dispatch_ticket,
    exact_lookup,
    get_dispatch_ticket,
    image_search,
    release_action_plan,
    release_dispatch_briefing,
    semantic_search,
    structured_query,
    voice_search,
)


class TestExactLookup:
    def test_known_error_code_returns_fields(self):
        result = json.loads(exact_lookup.invoke({"error_code": "AWS-001"}))
        assert result.get("error_code") == "AWS-001"
        assert "symptom" in result
        assert "recommended_action" in result
        assert "severity" in result

    def test_case_insensitive(self):
        result_upper = json.loads(exact_lookup.invoke({"error_code": "OPT-001"}))
        result_lower = json.loads(exact_lookup.invoke({"error_code": "opt-001"}))
        assert result_upper.get("error_code") == result_lower.get("error_code")

    def test_unknown_error_code_returns_error(self):
        result = json.loads(exact_lookup.invoke({"error_code": "ZZZ-999"}))
        assert "error" in result

    def test_ins_001(self):
        result = json.loads(exact_lookup.invoke({"error_code": "INS-001"}))
        assert result.get("error_code") == "INS-001"
        assert result.get("category") is not None

    def test_tool_name(self):
        assert exact_lookup.name == "exact_lookup"


class TestStructuredQuery:
    def test_filter_by_error_code_returns_records(self):
        result = json.loads(structured_query.invoke({
            "error_code": "AWS-001", "model": "", "site_name": "", "date_from": "", "date_to": "",
        }))
        assert "records" in result
        assert len(result["records"]) > 0
        assert "summary" in result

    def test_all_empty_filters_returns_all(self):
        result = json.loads(structured_query.invoke({
            "error_code": "", "model": "", "site_name": "", "date_from": "", "date_to": "",
        }))
        assert result["summary"]["total_records"] > 0

    def test_nonexistent_filter_returns_empty(self):
        result = json.loads(structured_query.invoke({
            "error_code": "ZZZ-999", "model": "", "site_name": "", "date_from": "", "date_to": "",
        }))
        assert result.get("records") == [] or "message" in result

    def test_summary_contains_expected_keys(self):
        result = json.loads(structured_query.invoke({
            "error_code": "OPT-001", "model": "", "site_name": "", "date_from": "", "date_to": "",
        }))
        if result.get("records"):
            summary = result["summary"]
            assert "total_records" in summary
            assert "first_time_fix_rate" in summary
            assert "avg_resolution_minutes" in summary

    def test_date_filter(self):
        result = json.loads(structured_query.invoke({
            "error_code": "", "model": "", "site_name": "", "date_from": "2024-01-01", "date_to": "2024-12-31",
        }))
        assert "summary" in result or "message" in result

    def test_tool_name(self):
        assert structured_query.name == "structured_query"


class TestSemanticSearch:
    def test_returns_results_for_known_topic(self):
        results = json.loads(semantic_search.invoke({"query": "アングルワイヤー断線"}))
        assert isinstance(results, list)
        assert len(results) > 0
        first = results[0]
        assert "source" in first
        assert "excerpt" in first
        assert "score" in first

    def test_cln_topic_returns_results(self):
        results = json.loads(semantic_search.invoke({"query": "防水 リークテスト 感染"}))
        assert isinstance(results, list)
        assert len(results) > 0

    def test_score_is_float(self):
        results = json.loads(semantic_search.invoke({"query": "送水ポンプ"}))
        for r in results:
            assert isinstance(r["score"], float)

    def test_opt_topic(self):
        results = json.loads(semantic_search.invoke({"query": "光学系 ノイズ イメージセンサー"}))
        assert isinstance(results, list)

    def test_tool_name(self):
        assert semantic_search.name == "semantic_search"


class TestVoiceSearch:
    def test_returns_veteran_knowledge(self):
        results = json.loads(voice_search.invoke({"query": "断線の前兆 アングルワイヤー"}))
        assert isinstance(results, list)
        assert len(results) > 0
        first = results[0]
        assert "speaker" in first
        assert "excerpt" in first

    def test_cln_query(self):
        results = json.loads(voice_search.invoke({"query": "防水 感染対策 リークテスト"}))
        assert isinstance(results, list)
        assert len(results) > 0

    def test_tool_name(self):
        assert voice_search.name == "voice_search"


class TestImageSearch:
    def test_known_keyword_returns_image_path(self):
        result = json.loads(image_search.invoke({"component_keyword": "送水"}))
        assert "image_path" in result
        assert result["image_path"].endswith("component_diagram.svg")
        assert "component" in result

    def test_angle_keyword(self):
        result = json.loads(image_search.invoke({"component_keyword": "アングル"}))
        assert "image_path" in result

    def test_unknown_keyword_returns_message_or_fuzzy(self):
        result = json.loads(image_search.invoke({"component_keyword": "存在しない部位XYZ"}))
        assert "message" in result or "image_path" in result

    def test_light_guide_keyword(self):
        result = json.loads(image_search.invoke({"component_keyword": "ライトガイド"}))
        assert "component" in result

    def test_tool_name(self):
        assert image_search.name == "image_search"


class TestDispatch:
    def test_child_number_under_parent(self):
        result = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "D-20260101-1234",
                "summary": "湾曲抵抗の切り分け中。CLN系疑い。",
                "error_codes": "INS-003",
                "recommended_parts": "湾曲部ゴム",
                "open_questions": "リーク箇所未特定",
            })
        )
        # 子番号は親番号配下に -01 形式で採番される
        assert result["dispatch_id"] == "D-20260101-1234-01"
        assert result["parent_dispatch_id"] == "D-20260101-1234"
        assert result["status"] == "open"

    def test_sequential_children_increment(self):
        parent = "D-20260202-5678"
        first = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": parent, "summary": "a",
                "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        second = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": parent, "summary": "b",
                "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        assert first["dispatch_id"] == f"{parent}-01"
        assert second["dispatch_id"] == f"{parent}-02"

    def test_empty_parent_generates_provisional(self):
        result = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "",
                "summary": "親番号不明", "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        # 親不明なら暫定の親番号を採番し、その配下に -01
        assert result["dispatch_id"].endswith("-01")
        assert result["parent_dispatch_id"].startswith("D-")

    def test_create_then_get_roundtrip(self):
        created = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "D-20260303-9999",
                "summary": "送水不良の切り分け中",
                "error_codes": "AWS-001",
                "recommended_parts": "送水ポンプ",
                "open_questions": "ポンプ単体故障か配管閉塞か未確定",
            })
        )
        dispatch_id = created["dispatch_id"]
        fetched = json.loads(get_dispatch_ticket.invoke({"dispatch_id": dispatch_id}))
        assert fetched["dispatch_id"] == dispatch_id
        assert fetched["parent_dispatch_id"] == "D-20260303-9999"
        assert fetched["summary"] == "送水不良の切り分け中"
        assert fetched["error_codes"] == "AWS-001"
        assert fetched["open_questions"] == "ポンプ単体故障か配管閉塞か未確定"

    def test_get_unknown_returns_error(self):
        result = json.loads(get_dispatch_ticket.invoke({"dispatch_id": "D-99999999-0000-99"}))
        assert "error" in result

    def test_tool_names(self):
        assert create_dispatch_ticket.name == "create_dispatch_ticket"
        assert get_dispatch_ticket.name == "get_dispatch_ticket"
        assert release_action_plan.name == "release_action_plan"

    def test_release_action_plan_roundtrip(self):
        created = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "D-20260606-3333",
                "summary": "s", "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        did = created["dispatch_id"]
        plan = "外装損傷の判定 | 湾曲部ゴム全周を接写;気泡発生位置を記録 | !減圧前に水中から引き上げる"
        released = json.loads(
            release_action_plan.invoke({"dispatch_id": did, "action_plan": plan})
        )
        assert released["status"] == "action_released"
        fetched = json.loads(get_dispatch_ticket.invoke({"dispatch_id": did}))
        assert fetched["released_action_plan"] == plan
        assert fetched["status"] == "action_released"

    def test_release_unknown_dispatch_errors(self):
        result = json.loads(
            release_action_plan.invoke({"dispatch_id": "D-00000000-0000-01", "action_plan": "x | y | z"})
        )
        assert "error" in result

    def test_release_dispatch_briefing_upsert_and_get(self):
        # コールセンター発番のみで未登録の番号でも、ブリーフィングのリリースで新規登録される
        did = "D-20260707-4242"
        released = json.loads(
            release_dispatch_briefing.invoke({
                "dispatch_id": did,
                "symptom": "送水不良",
                "diagnosis": "送水ポンプ劣化疑い",
                "initial_response": "使用中止を案内",
                "parts_to_bring": "送水ポンプ;Oリング",
                "focus_points": "防水点検;送水経路確認",
                "notes": "午前訪問希望",
            })
        )
        assert released["status"] == "fse_dispatched"
        fetched = json.loads(get_dispatch_ticket.invoke({"dispatch_id": did}))
        assert fetched["dispatch_briefing"]["symptom"] == "送水不良"
        assert fetched["dispatch_briefing"]["parts_to_bring"] == "送水ポンプ;Oリング"

    def test_external_policy_requires_parent(self, monkeypatch):
        # メーカー運用が「外部発番（コールセンター等）」の場合、親番号未指定はエラー
        from agent import dispatch_policy

        monkeypatch.setattr(dispatch_policy, "POLICY", "external")
        result = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "",
                "summary": "x", "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        assert "error" in result
        assert result.get("needs_parent_dispatch_id") is True

    def test_external_policy_accepts_given_parent(self, monkeypatch):
        from agent import dispatch_policy

        monkeypatch.setattr(dispatch_policy, "POLICY", "external")
        result = json.loads(
            create_dispatch_ticket.invoke({
                "parent_dispatch_id": "D-20260505-2222",
                "summary": "x", "error_codes": "", "recommended_parts": "", "open_questions": "",
            })
        )
        assert result["dispatch_id"] == "D-20260505-2222-01"


class TestDispatchPolicy:
    def test_format_child_id(self):
        from agent import dispatch_policy

        assert dispatch_policy.format_child_id("D-20260101-1234", 1) == "D-20260101-1234-01"
        assert dispatch_policy.format_child_id("D-20260101-1234", 12) == "D-20260101-1234-12"

    def test_generate_parent_id_format(self):
        from agent import dispatch_policy

        pid = dispatch_policy.generate_parent_id()
        assert pid.startswith("D-")
        assert len(pid.split("-")) == 3
