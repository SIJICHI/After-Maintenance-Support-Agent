# Agent Development Instructions

## Dependencies Installation

The following command should be run after agent code modification:

```shell
dr task run agent:install
```

> **Warning:** When using a custom Docker context (`DATAROBOT_DEFAULT_EXECUTION_ENVIRONMENT` is unset and an `agent/docker_context/` folder is present), modifying `pyproject.toml` or `uv.lock` triggers a full execution environment rebuild on the next deployment. This rebuild can take **10–20 minutes** depending on the number of dependencies. When using the default DataRobot execution environment (the default configuration), dependency changes do not trigger a rebuild.

## Agent Structure

Agent must be implemented in the following location withing the `agent/agent` directory. None of the other files outside of this directory are related.



Agent must implement the following components:

### 1. Class Definition

```python
from datarobot_genai.langgraph.agent import LangGraphAgent

class MyAgent(LangGraphAgent):
    """Your agent description here."""
```

**Important**: `MyAgent` class should NOT be renamed!

### 2. Required Properties and Methods in Class Definition

#### `llm()` Method

**CRITICAL**: Do NOT modify, delete, or change this method. It MUST be kept exactly as shown below in the agent implementation:

```python
def llm(
    self,
    auto_model_override: bool = True,
) -> ChatLiteLLM:
    api_base = self.litellm_api_base(self.config.llm_deployment_id)
    model = self.model or self.default_model
    if auto_model_override and not self.config.use_datarobot_llm_gateway:
        model = self.default_model
    if self.verbose:
        print(f"Using model: {model}")
    return ChatLiteLLM(
        model=model,
        api_base=api_base,
        api_key=self.api_key,
        timeout=self.timeout,
        streaming=True,
        max_retries=3,
    )
```

**Why this is required**: This method handles model configuration, API authentication, and DataRobot LLM Gateway integration. Changing it will break deployment.

#### `workflow` Property
Defines the agent's execution flow using LangGraph's StateGraph.

```python
@property
def workflow(self) -> StateGraph[MessagesState]:
    langgraph_workflow = StateGraph[
        MessagesState, None, MessagesState, MessagesState
    ](MessagesState)

    # Add nodes for each agent component
    langgraph_workflow.add_node("agent_node", self.agent_node)

    # Define edges (workflow connections)
    langgraph_workflow.add_edge(START, "agent_node")
    langgraph_workflow.add_edge("agent_node", END)

    return langgraph_workflow  # type: ignore[return-value]
```

#### `prompt_template` Property

Use it to define how user prompt is formatted for the agent.

```python
@property
def prompt_template(self) -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages([
        ("user", "{user_prompt_content}"),
    ])
```

**IMPORTANT**: The template must accept `{user_prompt_content}` to receive user prompts.

### 3. Agent Nodes

Agent nodes are typically created using `create_agent`.
**IMPORTANT**: Use `create_agent` call to create agent's node while passing the preferred LLM, system prompt and required tools into it.

```python
@property
def agent_node(self) -> Any:
    return create_agent(
        self.llm(),
        tools=self.tools,  # or [] for no tools
        system_prompt=make_system_prompt(
            "Your agent's system prompt here."
        ),
    )
```

### 4. Agent tools

**IMPORTANT**: Add required tools in the `agent/agent` directory. Do not add/modify any files outside of this directory. If some of the tools require adding new packages, they should be added to the pyproject.toml and properly installed using command

```shell
dr task run agent:install
```

**IMPORTANT**: Tools must be imported and used in `MyAgent` implementation.


### 5. Preferred LLM model

Preferred model should be set using ```self.model = "{preferred_model_here}"``` which will then be read in each ```self.llm()``` invocation.
**Important**: `self.model` parameter must be prefixed with `datarobot/`.

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

## Migrations

### 11.8.8 — New agent format (class-based → factory-based)

Starting with agent component version 11.8.8 ([af-component-agent#474](https://github.com/datarobot-community/af-component-agent/pull/474)), agent templates (except `base`) no longer require defining agents within a `MyAgent` class. Agents are now defined using native framework primitives at module level and converted to `MyAgent` via a helper function (`datarobot_agent_class_from_*`). The LLM is also decoupled from the agent class and injected via `get_llm()`.

If you are upgrading an existing agent from a version prior to 11.8.8, follow the migration guide for your framework:

- [LangGraph migration](../docs/agent/langgraph-migration-to-11.8.8.md)
- [CrewAI migration](../docs/agent/crewai-migration-to-11.8.8.md)
- [LlamaIndex migration](../docs/agent/llamaindex-migration-to-11.8.8.md)
- [Base agent migration](../docs/agent/base-migration-to-11.8.8.md)
- [NAT agent migration](../docs/agent/nat-migration-to-11.8.8.md)
