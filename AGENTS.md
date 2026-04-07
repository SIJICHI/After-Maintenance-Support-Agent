# Project Instructions

These instructions apply to all agents working in this repository.

## Running Shell Commands In Project

**IMPORTANT**: All shell commands must be executed from the project root directory.

## Run Project Locally

Run the following shell commands to run the project locally (agent + backend + frontend)

```shell
dr run dev
```

# Agent Development Instructions

## Dependencies Installation

The following command should be run after agent code modification:

```shell
dr task run agent:install
```

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
# Backend Development Instructions

The agent application template includes a backend implementation in `fastapi_server/`.
By default it ships a backend implementing APIs endpoints for the frontend application.

## Backend Development Guidelines

- The FastAPI backend in `fastapi_server/` already serves the chat API at `/api/v1/`.
  If the user's frontend needs new data endpoints, add them in `fastapi_server/app/api/v1/`.
- The entry point for the backend can be found at `fastapi_server/app/main.py`

## Installing backend packages

Before making any changes to the backen code, install dependencies by running shell command:

```shell
dr task run fastapi_server:install
```

## Backend Testing

```shell
dr task run fastapi_server:lint
```

```shell
dr task run fastapi_server:test
```

# Frontend Development Instructions

The agent application frontend MUST be implemented in the following location withing the `frontend_web/`.
The technology stack is TypeScript + React + Vite + Tailwind CSS + shadcn/ui.
By default it ships a chat UI, but it can reimplemented to contain dashboards, multi-page apps, or other custom UIs.

## Frontend Development Guidelines

IMPORTANT: Do NOT replace this stack with a different framework (e.g. Next.js, Vue, Angular, Svelte). If the user asks to switch frameworks, because deployment pipeline and infrastructure depend on the current stack. 
IMPORTANT: The frontend depends on backend API endpoints and agent tool outputs being in place.

- You may modify files ONLY inside `frontend_web/` and `fastapi_server/` for the frontend work.
- The frontend is a standard Vite + React + TypeScript project:
  * Pages live in `frontend_web/src/pages/`
  * Routes are defined in `frontend_web/src/routesConfig.tsx`
  * Reusable components are in `frontend_web/src/components/`
  * UI primitives (shadcn/ui) are in `frontend_web/src/components/ui/`
  * API hooks and requests are in `frontend_web/src/api/`
  * Theming is in `frontend_web/src/theme/`
- Read `frontend_web/README.md` to further understand the existing structure.

## Frontend  Security
- NEVER embed API keys, secrets, or credentials in frontend code. If the frontend needs to call
  external services, route those calls through `fastapi_server/` endpoints. Do not make direct external API
  calls from browser-side code as this exposes secrets and creates CORS issues.

## Installing frontend packages

Before making any changes to the frontend code, install dependencies (npm packages) by running shell command:

```shell
dr task run frontend_web:install
```

- To install new npm packages, use shell to run `npm install <package>` from the `frontend_web/` directory.

## Installing shadcn/ui components

Before importing any shadcn/ui component (e.g. `Select`, `Tabs`, `Table`, `Popover`, `DatePicker`), check whether its file already exists in `frontend_web/src/components/ui/`. If it does NOT exist, run `npx shadcn@latest add <component>` from the `frontend_web/` directory before writing any code that imports it. Never import a shadcn component that has not been explicitly added — it will not exist on disk and will break the build.

## Frontend Testing

```shell
dr task run frontend_web:lint
```

```shell
dr task run frontend_web:test
```

## Project Deployment

Run the following shell commands to deploy the project:

```shell
dr task run infra:up-yes
```

In case the deployment process fails, you can try deleting it by running the following command:

```shell
dr task run infra:down-yes
```