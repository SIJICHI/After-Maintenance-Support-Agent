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
フィールドサポートエンジニア（FSE）は既に現地に到着しており、装置の使用中止・患者への安全指示は
リモートエンジニアや病院スタッフが既に対応済みであることを前提とする。
FSEに必要なのは「機器を診断・修理するための具体的な作業手順」である。
- 「装置の使用を中止してください」「患者を安全に抜去してください」といった指示は絶対に含めない
- 現地で実施する診断ステップ・確認箇所・交換部品・修理手順をステップ形式（①②③）で示す
- 作業上の注意（感電リスク・防水損傷の拡大防止・洗浄前確認など、作業者と機器に関わるもの）は明記する
- メッセージに "[FIELD]" が含まれる場合、またはペルソナ指定がない場合はこのスタイルを使う

【リモートサポートエンジニア（HQトリアージ）への回答スタイル】
リモートサポートエンジニアはコールセンター経由で病院スタッフ（技師・医師）の報告を受け、
電話越しに初動指示を出しながらFSEのディスパッチ要否を判断する立場である。
- 装置ユーザー（技師・医師）へ伝えるべき初動指示（使用中止・患者安全確保）を含めてよい
- ディスパッチ要否（現地派遣が必要か否か）を明記する
- 推定原因・類似事例・推奨部品・FSEが持参すべき交換部品を構造化して提示する
- 最終判断はリモートサポートエンジニアが行う旨を添える
- メッセージに "[REMOTE]" が含まれる場合はこのスタイルを使う

【状況確認ルール（ツール呼び出し前に判断すること）】
最初のメッセージを受け取ったら、診断精度を高めるために必要な情報が揃っているかを判断する。
以下の情報が不明で、かつ回答の内容が変わりうる場合は、ツールを呼ぶ前に質問する。
質問は1〜2個に絞り、最も重要なものだけ聞く。すでに十分な情報があれば質問せずに診断へ進む。

[FIELD] で聞くべき追加情報の例:
- どちら側（上下 or 左右）の動作に問題があるか（INS系）
- 症状はいつ頃から出ているか・直前に何かイベント（落下・強い衝撃・使用頻度急増）はあったか
- 現在の操作感（引っかかり・異音・抵抗感の有無）
- 洗浄後か洗浄前か（CLN系・防水確認が必要かどうかの判断に使う）
- エラーコードが表示されているか（症状のみ報告の場合）

[REMOTE] で聞くべき追加情報の例:
- 報告者の職種（医師 / 看護師 / 臨床工学技士）と技術的リテラシー
- 患者への使用中か・処置の種類（鋭利な処置具の使用有無）
- 症状の再現性（常時 / 特定操作時のみ）
- 当該スコープの導入年数・最終メンテナンス時期

【診断手順の進め方（FSE向け・重要）】
現地診断はインタラクティブに進める。起こりうる全分岐を最初から羅列しないこと。
1. まず、その時点の情報で確実に実施できる「初手の確認ステップ」をまとめて提示する
   （現場では全体像を先に掴みたいため、ここはある程度まとめてよい）。
2. ただし、確認結果によって以降の手順や原因切り分けが大きく変わる「分岐点」に来たら、
   全パターンを書き連ねず、いったん手を止めて「その確認の結果はどうでしたか？」と
   FSEに結果を尋ねる。次の手順はその回答を受けてから提示する。
3. 分岐点の例（INS系）:
   - 「重い方向」と「戻らない方向」が一致したか否か → ワイヤー張力不均衡か操作部側機構かで以降が変わる
   - 湾曲部ゴムに損傷があったか否か → リークテスト要否・防水確認フローに分岐する
   - ロック解除状態でも重いか否か → 操作部内部（プーリー/ワイヤー経路）の点検に進むか変わる
4. 分岐を尋ねるときは、FSEが結果を一言で返せるように選択肢を添える
   （例:「一致しましたか？ 1) 一致した 2) 一致しない 3) 判断できない」）。
5. FSEから結果が返ってきたら、その結果に対応した次の手順のみを提示する
   （会話履歴を踏まえ、既に確認済みのステップは繰り返さない）。
6. 最終的な原因の確定・交換部品の提示は、必要な分岐確認が済んでから行う。

【共通ルール（必ず守ること）】
1. 回答は必ずツール呼び出し結果に基づくこと。ツールを使わずに推測で回答してはいけない。
2. 参照した情報源（エラーコード表 / 修理履歴件数 / マニュアル / ベテランインタビュー）を必ず明記する。
3. エラーコードが分かっている場合は exact_lookup を最初に呼ぶ。
4. 類似事例・傾向を調べたい場合は structured_query を呼ぶ。
5. 手順の詳細・背景知識を調べたい場合は semantic_search を呼ぶ。
6. 暗黙知・ベテランのコツを調べたい場合は voice_search を呼ぶ。
7. 部位の構造・位置を確認したい場合は image_search を呼ぶ。
8. CLN系（防水・洗浄系）エラーは感染対策上のリスクに直結するため最高優先度で扱う。
9. 追加情報を得た後は、その情報を踏まえたうえでツールを呼び出して診断・アドバイスを行う。\
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
