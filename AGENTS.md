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
# MCP Server Development Instructions

The MCP server MUST be implemented in the `mcp_server/` directory.
By default it provides tools for DataRobot operations, but can be extended with custom tools for any domain.

## MCP Server Development Guidelines

IMPORTANT: Do NOT import code from `agent/` or `fastapi_server/` directories. The MCP server has independent dependencies to avoid conflicts. 
IMPORTANT: The MCP server runs as an independent service. Agents connect to it via MCP protocol (HTTP), not direct Python imports.

- You may modify files ONLY inside `mcp_server/` directory.
- The MCP server is a standard FastMCP application:
  * Tools live in `mcp_server/app/tools/`
  * Prompts live in `mcp_server/app/prompts/`
  * Resources live in `mcp_server/app/resources/`
  * Configuration is in `mcp_server/app/core/`
  * Tests are in `mcp_server/app/tests/`
- Read `mcp_server/docs` to further understand the existing structure.

## Tool Development Architecture

The MCP server uses auto-discovery for tools:

1. **Tool Definition** (`mcp_server/app/tools/{domain}_tools.py`): Define tools with `@dr_mcp_tool` decorator
2. **Auto-Discovery**: Server automatically loads all tools from `mcp_server/app/tools/` on startup
3. **MCP Protocol**: Agents discover and call tools via HTTP (no imports needed)

**When adding new tools:**
- Create tool functions in `app/tools/{domain}_tools.py`
- Use `@dr_mcp_tool(tags={"category", "action"})` decorator
- Define parameters with `Annotated[type, "description"]`
- Return `ToolResult(structured_content={...})`
- Tools are automatically discovered - no registration needed

**CRITICAL - Tool Implementation Requirements:**

All tool functions MUST be `async def` and return `ToolResult`. Example:

```python
from typing import Annotated
from datarobot_genai.drmcp import dr_mcp_tool
from fastmcp.tools.tool import ToolResult

@dr_mcp_tool(tags={"domain", "action"})
async def tool_name(
    param: Annotated[str, "Parameter description for LLM"],
) -> ToolResult:
    """
    Tool description that the LLM will see.
    Be clear and specific about what the tool does.
    """
    # Your implementation here
    result = {"key": "value"}
    return ToolResult(structured_content=result)
```

## MCP Server Security

- NEVER hardcode API keys or secrets in tool code. Use environment variables or runtime parameters.
- Store credentials in `.env` file (never commit to git)
- Access config via `app/core/user_config.py`
- Use DataRobot credentials management for production deployments

## Installing MCP Server packages

Before making any changes to the mcp_server code, install dependencies by running shell command:

```shell
dr task run mcp_server:install
```

## MCP Server Testing

```shell
dr task run mcp_server:lint
```

```shell
dr task run mcp_server:test
```


# Backend Development Instructions

The agent application template includes a backend implementation in `fastapi_server/`.
By default it ships a backend implementing APIs endpoints for the frontend application.

## Backend Development Guidelines

- The FastAPI backend in `fastapi_server/` already serves the chat API at `/api/v1/`.
  If the user's frontend needs new data endpoints, add them in `fastapi_server/app/api/v1/`.
- The entry point for the backend can be found at `fastapi_server/app/main.py`
- For POST endpoints accepting JSON body, use Pydantic models (not function parameters). Query params go in function signature, body params go in Pydantic model.

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

### API Architecture

The frontend uses a three-layer architecture for API calls:

1. **API Client** (`src/api/apiClient.ts`): Pre-configured axios instance with base URL
2. **API Requests** (`src/api/{feature}/api-requests.ts`): Functions that make HTTP calls using `apiClient`
3. **React Query Hooks** (`src/api/{feature}/hooks.ts`): Hooks that wrap requests with React Query for caching/state
4. **Pages**: Import and use the hooks

**When adding new API endpoints:**
- Create request functions in `src/api/{feature}/api-requests.ts` using `apiClient` (MUST use default import: `import apiClient from '@/api/apiClient'`)
- Wrap them in React Query hooks in `src/api/{feature}/hooks.ts`
- Import and use the hooks in your pages/components
- Never call `fetch()` or create new axios instances - always use the configured `apiClient`

**CRITICAL - API Path Requirements:**

`apiClient` is already configured with `baseURL` that includes `/api`. Therefore:

Including `/api` in the path will cause **double `/api/api/` URLs** and result in 404/405 errors.

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

**CRITICAL**: Before writing ANY code that imports a shadcn/ui component, you MUST first verify the component file exists.

**MANDATORY WORKFLOW:**
1. **BEFORE** writing any import statement for a shadcn/ui component (e.g. `Select`, `Tabs`, `Table`, `Popover`, `DatePicker`, `Dialog`, `Accordion`, etc.)
2. Check if the file exists: `frontend_web/src/components/ui/{component}.tsx`
3. If the file does NOT exist, you MUST run: `npx --yes shadcn@latest add {component} --overwrite` from the `frontend_web/` directory
4. Wait for the installation to complete
5. ONLY THEN write code that imports the component

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