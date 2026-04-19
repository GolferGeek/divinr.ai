# Chrome-MCP Exploratory Patterns

The `divinr-test-agent --interactive <facet>` path uses Chrome-MCP rather than Playwright — interactive investigation benefits from a live browser the founder can co-observe. Each deep skill's `tests.md` has a secondary section that layers facet-specific patterns on top of these generics.

## Startup protocol

1. Call `mcp__claude-in-chrome__tabs_context_mcp` first — this is a hard requirement at the top of any Chrome-MCP session. It tells you which tabs are open so you can reuse one the founder is already on, rather than cluttering the session with new tabs.
2. Only create a new tab with `mcp__claude-in-chrome__tabs_create_mcp` if the founder hasn't pointed you at an existing one.
3. Before any destructive-feeling click (delete buttons, destructive confirms), warn and read the page state first. Browser dialogs block the MCP bridge and can strand the session.

## Core patterns

### Navigate and wait for data

```
mcp__claude-in-chrome__navigate(url: "https://divinr.ai/predictions")
mcp__claude-in-chrome__read_page(selector: "table tbody", timeout: 10000)
```

Read the page's primary container text. If it is empty or matches an empty-state string ("No predictions yet") when the testing-team fixture should have data, file a finding.

### Find an element

```
mcp__claude-in-chrome__find(selector: "[data-testid='prediction-card']")
```

Returns an array of matches. Zero matches on a populated view = finding.

### Interact with controls

```
mcp__claude-in-chrome__form_input(selector: "ion-input[label='Ticker']", value: "AAPL")
mcp__claude-in-chrome__find(selector: "button:has-text('Submit')") then click
```

For Ionic-wrapped inputs, prefer the label match; the underlying `<input>` is in shadow DOM but MCP's selector engine pierces it.

### Inspect JS state

```
mcp__claude-in-chrome__javascript_tool(code: "return window.__divinrStore?.predictions?.length")
```

Useful when you suspect a Pinia store is populated but the view is not rendering.

### Console & network peek

```
mcp__claude-in-chrome__read_console_messages(pattern: "TypeError|500")
mcp__claude-in-chrome__read_network_requests(pattern: "/api/.*")
```

Run these after every interactive step. Silent 500s are the most common bug the interactive path catches.

## Loop-avoidance rule

If any Chrome-MCP call fails twice in a row, stop and report. Do not retry more than two times. If the page is unresponsive, the session may need a restart the agent cannot do on its own.
