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
    exact_lookup,
    image_search,
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
