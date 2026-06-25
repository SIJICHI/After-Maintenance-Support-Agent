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
"""Register custom tools with NAT so they can be referenced in workflow.yaml."""

from datarobot_genai.nat.tool import nat_tool

from agent.tools import (
    exact_lookup,
    image_search,
    semantic_search,
    structured_query,
    voice_search,
)

nat_tool(exact_lookup, "exact_lookup")
nat_tool(structured_query, "structured_query")
nat_tool(semantic_search, "semantic_search")
nat_tool(voice_search, "voice_search")
nat_tool(image_search, "image_search")
