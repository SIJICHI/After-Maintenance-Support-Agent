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
"""ディスパッチ番号の発番ポリシー（メーカーの運用に合わせて差し替える一箇所）。

医療機器メーカーによって、ディスパッチ番号の「発番元」「採番規則」は異なる。
例:
  - コールセンターが発番（オペレーターが受電時に採番）
  - サービス管理システムが発番（基幹システム連携で受領）
  - 現地／アプリが発番（小規模・スタンドアロン運用）
このモジュールにそれらの差異を集約し、環境変数で切り替えられるようにする。
発番ルールを変えたいときは、原則このファイル（と環境変数）だけを編集すればよい。

環境変数:
  DISPATCH_NUMBERING_POLICY:
    - "app_provisional"（既定）: 親ディスパッチ番号が未指定なら、アプリが暫定の親番号を採番する
      （デモ・スタンドアロン向け）。
    - "external"          : 親ディスパッチ番号はコールセンター／サービス管理システムが発番済みである
      前提。アプリは親番号を採番しない（未指定はエラー扱い）。
  DISPATCH_PREFIX: 親番号のプレフィックス（既定 "D"）。
  DISPATCH_CHILD_SEP / DISPATCH_CHILD_WIDTH: 子番号の区切り（既定 "-"）と桁数（既定 2）。
"""

from __future__ import annotations

import os
import random
from datetime import datetime, timezone

# モジュール属性として保持し、テストや実行時に差し替え可能にする。
POLICY = os.environ.get("DISPATCH_NUMBERING_POLICY", "app_provisional")
PREFIX = os.environ.get("DISPATCH_PREFIX", "D")
CHILD_SEP = os.environ.get("DISPATCH_CHILD_SEP", "-")
CHILD_WIDTH = int(os.environ.get("DISPATCH_CHILD_WIDTH", "2"))


class ParentDispatchRequiredError(Exception):
    """親ディスパッチ番号が必須なポリシーで、番号が指定されなかった場合に送出する。"""


def generate_parent_id() -> str:
    """アプリが暫定の親ディスパッチ番号を採番する（app_provisional ポリシー用）。"""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{PREFIX}-{today}-{random.randint(1000, 9999)}"


def resolve_parent_id(parent_dispatch_id: str) -> str:
    """親ディスパッチ番号を確定する。

    - 指定があればそれを使う。
    - 未指定の場合、ポリシーに従って暫定採番するか、エラーを送出する。
    """
    parent = parent_dispatch_id.strip()
    if parent:
        return parent
    if POLICY == "external":
        raise ParentDispatchRequiredError(
            "このメーカー運用では親ディスパッチ番号はコールセンター／サービス管理システムが発番します。"
            "FSEはコールセンターで採番された案件のディスパッチ番号を確認してください。"
        )
    # app_provisional（既定）
    return generate_parent_id()


def format_child_id(parent_id: str, seq: int) -> str:
    """親番号配下の子番号（相談・部品手配等のサブ番号）を整形する。"""
    return f"{parent_id}{CHILD_SEP}{seq:0{CHILD_WIDTH}d}"
