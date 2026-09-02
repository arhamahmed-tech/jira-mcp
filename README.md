# Jira MCP Server

A Model Context Protocol (MCP) server for Jira with Streamable HTTP transport. Exposes 30+ tools for issues, sprints, boards, worklogs, users, and more.

## Features

- **Streamable HTTP transport** — connect via HTTP/HTTPS
- **Per-request credentials** — users bring their own Jira credentials
- **30+ tools** — issues, sprints, boards, worklogs, analytics
- **Netlify ready** — deploy as serverless function
- **CORS enabled** — works from any client
- **Auth modes** — open or API-key protected

## Requirements

- Node.js 18 or later
- A Jira instance (Cloud or Server/Data Center)

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start local server
npm start

# Or use Netlify CLI for local development
npm run dev
```

### Test Locally

```bash
# Health check
curl http://localhost:3000/

# MCP request (with credentials)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Jira-Base-Url: https://your-domain.atlassian.net" \
  -H "X-Jira-Email: your-email@example.com" \
  -H "X-Jira-Token: your-api-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test","version":"1.0"},"capabilities":{}}}'
```

## Deploy to Netlify

### Step 1: Push to Git

```bash
git add .
git commit -m "Prepare for Netlify deployment"
git push origin main
```

### Step 2: Connect to Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. Click "Add new site" → "Import an existing project"
3. Select your Git provider (GitHub, GitLab, etc.)
4. Select the `jira-mcp-server` repository

### Step 3: Configure Build Settings

In the Netlify UI, enter these exact values:

| Setting | Value |
|---------|-------|
| **Branch** | `main` |
| **Base directory** | (leave empty) |
| **Build command** | `npm install` |
| **Publish directory** | `.` |
| **Functions directory** | `netlify/functions` |

### Step 4: Set Environment Variables

Go to **Site Settings → Environment Variables** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `AUTH_MODE` | `open` | Set to `authorized` to require API key |
| `API_KEY` | (your secret key) | Required if `AUTH_MODE=authorized` |

### Step 5: Deploy

Click "Deploy site" and wait for the build to complete.

Your MCP endpoint will be available at:

```
https://YOUR-SITE-NAME.netlify.app/mcp
```

## MCP Client Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "jira": {
      "url": "https://YOUR-SITE-NAME.netlify.app/mcp",
      "headers": {
        "X-Jira-Base-Url": "https://your-domain.atlassian.net",
        "X-Jira-Email": "your-email@example.com",
        "X-Jira-Token": "your-api-token"
      }
    }
  }
}
```

### Cursor / Windsurf

```json
{
  "mcpServers": {
    "jira": {
      "url": "https://YOUR-SITE-NAME.netlify.app/mcp",
      "headers": {
        "X-Jira-Base-Url": "https://your-domain.atlassian.net",
        "X-Jira-Email": "your-email@example.com",
        "X-Jira-Token": "your-api-token"
      }
    }
  }
}
```

### With API Key (Authorized Mode)

If `AUTH_MODE=authorized`, add the API key to headers:

```json
{
  "mcpServers": {
    "jira": {
      "url": "https://YOUR-SITE-NAME.netlify.app/mcp",
      "headers": {
        "X-Api-Key": "your-api-key",
        "X-Jira-Base-Url": "https://your-domain.atlassian.net",
        "X-Jira-Email": "your-email@example.com",
        "X-Jira-Token": "your-api-token"
      }
    }
  }
}
```

## Authentication

### Open Mode (default)

Anyone can connect. Users provide their Jira credentials in headers:

| Header | Required | Description |
|--------|----------|-------------|
| `X-Jira-Base-Url` | Yes | Jira instance URL (no trailing slash) |
| `X-Jira-Token` | Yes | API token or password |
| `X-Jira-Email` | Conditional | Email for Jira Cloud |
| `X-Jira-Username` | Conditional | Username for Jira Server/Data Center |

### Authorized Mode

Requires an API key in addition to Jira credentials:

```bash
# Set in Netlify Dashboard
AUTH_MODE=authorized
API_KEY=your-secret-api-key
```

Users must include the API key in requests:

| Header | Required | Description |
|--------|----------|-------------|
| `X-Api-Key` | Yes | Your API key |

## Environment Variables

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (local only) |
| `AUTH_MODE` | `open` | `open` or `authorized` |
| `API_KEY` | — | Required when `AUTH_MODE=authorized` |

### User Credentials (via Headers)

Users provide Jira credentials via HTTP headers, not environment variables.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/mcp` | POST | MCP Streamable HTTP endpoint |
| `/health` | GET | Health check |

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

## Testing

```bash
# Run tests
npm test

# Test with coverage
npm run test:coverage
```

## Development

### Project Structure

```
jira-mcp-server/
├── cli.js                          # Local development server
├── netlify/
│   └── functions/
│       ├── mcp.js                  # Netlify Function (MCP endpoint)
│       └── health.js               # Netlify Function (health check)
├── test/
│   └── mcp.test.js                 # Tests
├── netlify.toml                    # Netlify configuration
├── package.json
└── README.md
```

### Local Development

```bash
# Install dependencies
npm install

# Start local server
npm start

# Or use Netlify CLI
npm run dev
```

### Testing the Deployment

```bash
# Health check
curl https://YOUR-SITE-NAME.netlify.app/health

# MCP endpoint
curl -X POST https://YOUR-SITE-NAME.netlify.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Jira-Base-Url: https://your-domain.atlassian.net" \
  -H "X-Jira-Email: your-email@example.com" \
  -H "X-Jira-Token: your-api-token" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"test","version":"1.0"},"capabilities":{}}}'
```

## Security

- **Never commit `.env` files** — they're gitignored
- **Use `AUTH_MODE=authorized`** in production to require API keys
- **Jira credentials stay with the user** — they're sent via headers, not stored on the server
- **No secrets in code** — all configuration is via environment variables

## License

ISC
