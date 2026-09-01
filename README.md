# Jira MCP Server

A Model Context Protocol (MCP) server that connects AI assistants to your Jira instance. Exposes 30+ tools for issues, sprints, boards, worklogs, users, and more.

## Requirements

- Node.js 18 or later
- A Jira instance (Cloud or Server/Data Center)
- Jira API credentials (see [Authentication](#authentication))

## Installation

### Quick Start with npx (Recommended)

No installation required. Just run:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net \
JIRA_EMAIL=your-email@example.com \
JIRA_API_TOKEN=your-api-token \
npx jira-mcp-server
```

### Install Globally

```bash
npm install -g jira-mcp-server
```

Then run:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net \
JIRA_EMAIL=your-email@example.com \
JIRA_API_TOKEN=your-api-token \
jira-mcp-server
```

### Install as Project Dependency

```bash
npm install jira-mcp-server
```

Then run:

```bash
npx jira-mcp-server
```

## Authentication

### Jira Cloud

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

Get your API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### Jira Server / Data Center

```bash
JIRA_BASE_URL=http://your-jira-server:8080
JIRA_USERNAME=your-username
JIRA_API_TOKEN=your-password-or-personal-access-token
```

Generate a Personal Access Token (Jira Server 8.14+):
Profile → Personal Access Tokens → Create token

## MCP Client Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp-server"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP configuration:

```json
{
  "jira": {
    "command": "npx",
    "args": ["-y", "jira-mcp-server"],
    "env": {
      "JIRA_BASE_URL": "https://your-domain.atlassian.net",
      "JIRA_EMAIL": "your-email@example.com",
      "JIRA_API_TOKEN": "your-api-token"
    }
  }
}
```

### Local Development (from clone)

```bash
git clone https://github.com/your-username/jira-mcp-server.git
cd jira-mcp-server
npm install
npm start
```

## Available Tools

### Issues
| Tool | Description |
|------|-------------|
| `create_issue` | Create a single Jira issue with full field support |
| `bulk_create_issues` | Create multiple issues in one call |
| `get_issue` | Fetch full details of an issue |
| `update_issue` | Update summary, description, priority, assignee, labels |
| `transition_issue` | Move an issue to a new status |
| `clone_issue` | Clone an issue to same or different project |
| `link_issues` | Link two issues together |
| `delete_issue` | Delete an issue |
| `issue_changelog` | Get change history for an issue |

### Search & Analytics
| Tool | Description |
|------|-------------|
| `search_issues` | Search using JQL queries |
| `my_issues` | Get issues assigned to current user |
| `project_summary` | Get project analytics and statistics |
| `assignee_workload` | See workload distribution |
| `overdue_issues` | Find overdue issues |

### Comments & Worklogs
| Tool | Description |
|------|-------------|
| `add_comment` | Post a comment on an issue |
| `list_comments` | List comments on an issue |
| `log_work` | Log work time on an issue |
| `get_worklogs` | Get worklog entries |

### Sprints & Boards
| Tool | Description |
|------|-------------|
| `list_boards` | List all boards |
| `list_sprints` | List sprints for a board |
| `sprint_issues` | Get issues in a sprint |
| `move_to_sprint` | Move issues to a sprint |
| `active_sprint_summary` | Get active sprint progress |

### Projects & Configuration
| Tool | Description |
|------|-------------|
| `list_projects` | List all accessible projects |
| `manage_versions` | List, create, release, or archive versions |
| `manage_components` | List, create, or delete components |
| `get_issue_types` | Get issue types for a project |

### Users & Helpers
| Tool | Description |
|------|-------------|
| `search_users` | Search for users |
| `get_current_user` | Get current user info |
| `bulk_transition` | Transition multiple issues at once |
| `bulk_assign` | Assign multiple issues at once |

## Example Prompts

```
Create a high-priority bug in project PROJ titled "Login page crashes on Safari"
```

```
Search for all open tasks assigned to john.doe in the MOBILE project
```

```
Bulk create these tasks in BACKEND project:
- Set up CI pipeline
- Write API documentation
- Add rate limiting middleware
```

```
Transition PROJ-42 to "In Progress" with comment "Starting this now"
```

```
What's my current sprint progress?
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_BASE_URL` | Yes | Base URL of your Jira instance (no trailing slash) |
| `JIRA_API_TOKEN` | Yes | API token or password |
| `JIRA_EMAIL` | Conditional | Email for Jira Cloud (required if not using username) |
| `JIRA_USERNAME` | Conditional | Username for Jira Server/Data Center (required if not using email) |

## Development

### From Source

```bash
git clone https://github.com/your-username/jira-mcp-server.git
cd jira-mcp-server
npm install
```

### Running Locally

```bash
npm start
```

Or with environment variables:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net \
JIRA_EMAIL=your-email@example.com \
JIRA_API_TOKEN=your-api-token \
node index.js
```

### Testing Changes

After making changes, test the server:

```bash
# Test that the server starts
JIRA_BASE_URL=https://test.example.com \
JIRA_EMAIL=test@example.com \
JIRA_API_TOKEN=test \
node index.js

# Should show: [jira-mcp v2] 30 tools ready — https://test.example.com
```

## Building & Publishing

### Package for Testing

```bash
npm pack --dry-run  # Preview what will be included
npm pack            # Create .tgz file
```

### Publish to npm

```bash
npm login
npm publish
```

### Version Bumping

```bash
npm version patch  # 1.0.0 → 1.0.1
npm version minor  # 1.0.0 → 1.1.0
npm version major  # 1.0.0 → 2.0.0
```

## License

ISC
