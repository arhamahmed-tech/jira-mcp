# Jira MCP Server

A Model Context Protocol (MCP) server for Jira with Streamable HTTP transport. Exposes 30+ tools for issues, sprints, boards, worklogs, users, and more.

## Features

- **Streamable HTTP transport** — connect via HTTP/HTTPS
- **Per-request credentials** — users bring their own Jira credentials
- **30+ tools** — issues, sprints, boards, worklogs, analytics
- **CORS enabled** — works from any client
- **Auth modes** — open or API-key protected

## Requirements

- Node.js 18 or later
- A Jira instance (Cloud or Server/Data Center)

## Quick Start

### 1. Run the server

```bash
npx jira-mcp-server
```

Or install globally:

```bash
npm install -g jira-mcp-server
jira-mcp-server
```

### 2. Server starts on port 3000

```
[jira-mcp-server] HTTP server running on http://localhost:3000
[jira-mcp-server] MCP endpoint: http://localhost:3000/mcp
[jira-mcp-server] Auth mode: open
```

### 3. Connect from MCP client

Users connect and provide their own Jira credentials via HTTP headers.

## Authentication Modes

### Open Mode (default)

Anyone can connect. Users provide their Jira credentials in headers:

```json
{
  "mcpServers": {
    "jira": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "X-Jira-Base-Url": "https://your-domain.atlassian.net",
        "X-Jira-Email": "your-email@example.com",
        "X-Jira-Token": "your-api-token"
      }
    }
  }
}
```

### Authorized Mode

Requires an API key in addition to Jira credentials:

```bash
AUTH_MODE=authorized API_KEY=my-secret-key node cli.js
```

```json
{
  "mcpServers": {
    "jira": {
      "url": "https://your-server.com/mcp",
      "headers": {
        "X-Api-Key": "my-secret-key",
        "X-Jira-Base-Url": "https://your-domain.atlassian.net",
        "X-Jira-Email": "your-email@example.com",
        "X-Jira-Token": "your-api-token"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `AUTH_MODE` | `open` | `open` or `authorized` |
| `API_KEY` | — | Required when `AUTH_MODE=authorized` |

## HTTP Headers (User Credentials)

| Header | Required | Description |
|--------|----------|-------------|
| `X-Jira-Base-Url` | Yes | Jira instance URL (no trailing slash) |
| `X-Jira-Token` | Yes | API token or password |
| `X-Jira-Email` | Conditional | Email for Jira Cloud |
| `X-Jira-Username` | Conditional | Username for Jira Server/Data Center |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check / server info |
| `/mcp` | POST | MCP Streamable HTTP endpoint |

## Available Tools

### Issues
| Tool | Description |
|------|-------------|
| `create_issue` | Create a single Jira issue |
| `bulk_create_issues` | Create multiple issues |
| `get_issue` | Fetch issue details |
| `update_issue` | Update issue fields |
| `transition_issue` | Change issue status |
| `clone_issue` | Clone an issue |
| `link_issues` | Link two issues |
| `delete_issue` | Delete an issue |
| `issue_changelog` | Get change history |

### Search & Analytics
| Tool | Description |
|------|-------------|
| `search_issues` | JQL search |
| `my_issues` | Current user's issues |
| `project_summary` | Project statistics |
| `assignee_workload` | Workload distribution |
| `overdue_issues` | Find overdue issues |

### Comments & Worklogs
| Tool | Description |
|------|-------------|
| `add_comment` | Post a comment |
| `list_comments` | List comments |
| `log_work` | Log work time |
| `get_worklogs` | Get worklog entries |

### Sprints & Boards
| Tool | Description |
|------|-------------|
| `list_boards` | List boards |
| `list_sprints` | List sprints |
| `sprint_issues` | Sprint issue list |
| `move_to_sprint` | Move issues to sprint |
| `active_sprint_summary` | Sprint progress |

### Projects & Config
| Tool | Description |
|------|-------------|
| `list_projects` | List projects |
| `manage_versions` | Version management |
| `manage_components` | Component management |
| `get_issue_types` | Issue type list |

### Users & Helpers
| Tool | Description |
|------|-------------|
| `search_users` | Search users |
| `get_current_user` | Current user info |
| `bulk_transition` | Bulk status changes |
| `bulk_assign` | Bulk assignment |

## Deployment

### Netlify Functions

Create `netlify/functions/mcp.js`:

```javascript
export { handler } from "../cli.js";
```

Set environment variables in Netlify dashboard:
- `AUTH_MODE=open` or `AUTH_MODE=authorized`
- `API_KEY` (if using authorized mode)

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "cli.js"]
```

### Any Node.js Hosting

```bash
git clone https://github.com/your-username/jira-mcp-server.git
cd jira-mcp-server
npm install
PORT=8080 node cli.js
```

## Development

### From Source

```bash
git clone https://github.com/your-username/jira-mcp-server.git
cd jira-mcp-server
npm install
npm start
```

### Test Locally

```bash
# Health check
curl http://localhost:3000/

# MCP request (with credentials)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-Jira-Base-Url: https://your-domain.atlassian.net" \
  -H "X-Jira-Email: your-email@example.com" \
  -H "X-Jira-Token: your-api-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test","version":"1.0"},"capabilities":{}}}'
```

## License

ISC
