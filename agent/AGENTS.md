# Agent Development Instructions

## Dependencies Installation

The following command should be run after agent code modification:

```shell
dr task run agent:install
```

> **Warning:** When using a custom Docker context (`DATAROBOT_DEFAULT_EXECUTION_ENVIRONMENT` is unset and an `agent/docker_context/` folder is present), modifying `pyproject.toml` or `uv.lock` triggers a full execution environment rebuild on the next deployment. This rebuild can take **10–20 minutes** depending on the number of dependencies. When using the default DataRobot execution environment (the default configuration), dependency changes do not trigger a rebuild.

## Agent Structure

Agent must be implemented in the following location withing the `agent/agent` directory. None of the other files outside of this directory are related.

For detailed documentation, see [docs/agent/README.md](../docs/agent/README.md).



Agent must implement the following components:

### 1. Class Definition

```python
from datarobot_genai.nat.agent import NatAgent

class MyAgent(NatAgent):
    def __init__(self, *args, workflow_path=Path(__file__).parent / "workflow.yaml", **kwargs):
        super().__init__(*args, workflow_path=workflow_path, **kwargs)
```

**Important**: `MyAgent` class should NOT be renamed!

### 2. Agent Workflow

All agent logic is defined declaratively in `workflow.yaml`. Functions, LLMs, tools, and orchestration are all configured in YAML:

```yaml
functions:
  planner:
    _type: chat_completion
    llm_name: datarobot_llm
    system_prompt: |
      You are a content planner...

workflow:
  _type: per_user_tool_calling_agent
  llm_name: datarobot_llm
  tool_names:
    - planner
    - writer
    - mcp_tools
  system_prompt: |
    You are a blog content orchestrator...
```

### 3. Custom Tools

Register custom Python tools using `nat_tool()` from `datarobot_genai.nat.tool` in `register.py`, then reference them by name in `workflow.yaml`.

For detailed NAT documentation, see [docs/agent/frameworks/nat.md](../docs/agent/frameworks/nat.md).

## Agent Testing

Review and update the tests in the `agent/tests` directory after code changes were made to the agent.
Run the following shell commands to run the tests:

```shell
dr task run agent:lint
```

```shell
dr task run agent:test
```

## Post Deployment Validation

Run the following shell command to validate the agent after deployment. If the response has no errors then the deployment is successful.

```shell
task agent:cli -- execute-deployment --user_prompt "Agent specific prompt to validate that it's working" --deployment_id <deployment_id>
```

## Setting up custom metric and report values

Refer to [Custom metrics](../docs/agent/custom-metrics.md) page for how to set up and report values to custom metrics.

## Migrations

### 11.8.8 — New agent format (class-based → factory-based)

Starting with agent component version 11.8.8 ([af-component-agent#474](https://github.com/datarobot-community/af-component-agent/pull/474)), agent templates (except `base`) no longer require defining agents within a `MyAgent` class. Agents are now defined using native framework primitives at module level and converted to `MyAgent` via a helper function (`datarobot_agent_class_from_*`). The LLM is also decoupled from the agent class and injected via `get_llm()`.

If you are upgrading an existing agent from a version prior to 11.8.8, follow the migration guide for your framework:

- [LangGraph migration](../docs/agent/frameworks/migration-to-11.8.8-langgraph.md)
- [CrewAI migration](../docs/agent/frameworks/migration-to-11.8.8-crewai.md)
- [LlamaIndex migration](../docs/agent/frameworks/migration-to-11.8.8-llamaindex.md)
- [Base agent migration](../docs/agent/frameworks/migration-to-11.8.8-base.md)
- [NAT agent migration](../docs/agent/frameworks/migration-to-11.8.8-nat.md)
