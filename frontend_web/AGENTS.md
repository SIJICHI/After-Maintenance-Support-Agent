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

