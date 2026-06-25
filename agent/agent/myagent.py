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
from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, Optional

from datarobot_genai.core.agents import InvokeReturn, make_system_prompt
from datarobot_genai.core.agents.base import UsageMetrics
from datarobot_genai.core.chat import agent_chat_completion_wrapper
from datarobot_genai.core.mcp import MCPConfig
from datarobot_genai.langgraph.agent import datarobot_agent_class_from_langgraph
from datarobot_genai.langgraph.llm import get_llm
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, MessagesState, StateGraph
from openai.types.chat import CompletionCreateParams

from agent.tools import (
    exact_lookup,
    image_search,
    semantic_search,
    structured_query,
    voice_search,
)

if TYPE_CHECKING:
    from ragas import MultiTurnSample

_PLACEHOLDER_MODELS = frozenset({"unknown"})

SYSTEM_PROMPT = """\
あなたは医療機器（EVS-X1000 内視鏡システム）のアフターメンテナンスを支援するAIエージェントです。
以下の2ペルソナのどちらからの問い合わせかをメッセージの文脈から判断し、回答スタイルを変えてください。

【フィールドサポートエンジニア（現場対応）への回答スタイル】
- 現場でそのまま実行できる簡潔なステップ形式（①②③）で回答する
- 安全上の注意（患者への影響・感染対策リスク等）は必ず明記する
- メッセージに "[FIELD]" が含まれる場合、またはペルソナ指定がない場合はこのスタイルを使う

【リモートサポートエンジニア（HQトリアージ）への回答スタイル】
- ディスパッチ要否（現地派遣が必要か否か）を明記する
- 推定原因・類似事例・推奨部品を構造化して提示する
- 最終判断はリモートサポートエンジニアが行う旨を添える
- メッセージに "[REMOTE]" が含まれる場合はこのスタイルを使う

【共通ルール（必ず守ること）】
1. 回答は必ずツール呼び出し結果に基づくこと。ツールを使わずに推測で回答してはいけない。
2. 参照した情報源（エラーコード表 / 修理履歴件数 / マニュアル / ベテランインタビュー）を必ず明記する。
3. エラーコードが分かっている場合は exact_lookup を最初に呼ぶ。
4. 類似事例・傾向を調べたい場合は structured_query を呼ぶ。
5. 手順の詳細・背景知識を調べたい場合は semantic_search を呼ぶ。
6. 暗黙知・ベテランのコツを調べたい場合は voice_search を呼ぶ。
7. 部位の構造・位置を確認したい場合は image_search を呼ぶ。
8. CLN系（防水・洗浄系）エラーは感染対策上のリスクに直結するため最高優先度で扱う。
9. 情報が不十分な場合は複数ツールを組み合わせてから回答する。\
"""

prompt_template = ChatPromptTemplate.from_messages([
    ("system", "会話履歴: {chat_history}"),
    ("user", "{topic}"),
])


def graph_factory(
    llm: BaseChatModel, tools: list[BaseTool], verbose: bool = False
) -> StateGraph[MessagesState]:
    custom_tools = [exact_lookup, structured_query, semantic_search, voice_search, image_search]
    all_tools = custom_tools + tools

    agent_node = create_agent(
        llm,
        tools=all_tools,
        system_prompt=make_system_prompt(SYSTEM_PROMPT),
        name="maintenance_support_agent",
        debug=verbose,
    )

    workflow: StateGraph[MessagesState] = StateGraph(MessagesState)
    workflow.add_node("maintenance_support_agent", agent_node)
    workflow.add_edge(START, "maintenance_support_agent")
    workflow.add_edge("maintenance_support_agent", END)
    return workflow


MyAgent = datarobot_agent_class_from_langgraph(graph_factory, prompt_template)


@asynccontextmanager
async def noop_mcp_tools_context(
    _mcp_config: MCPConfig,
) -> AsyncGenerator[list[Any], None]:
    """No-op MCP tools context: custom tools are injected directly in graph_factory."""
    yield []


async def custompy_adaptor(
    completion_create_params: CompletionCreateParams,
) -> InvokeReturn | tuple[str, Optional["MultiTurnSample"], UsageMetrics]:
    forwarded_headers: dict[str, str] = completion_create_params.get(  # type: ignore[assignment]
        "forwarded_headers", {}
    )
    authorization_context = completion_create_params.get("authorization_context", {})
    mcp_config = MCPConfig(
        forwarded_headers=forwarded_headers,
        authorization_context=authorization_context,
    )
    model_name = completion_create_params.get("model")
    agent = MyAgent(
        llm=get_llm(model_name=model_name if model_name not in _PLACEHOLDER_MODELS else None),
        verbose=completion_create_params.get("verbose", True),
        timeout=completion_create_params.get("timeout", 90),
        forwarded_headers=forwarded_headers,
    )
    return await agent_chat_completion_wrapper(
        agent, completion_create_params, lambda: noop_mcp_tools_context(mcp_config)
    )
