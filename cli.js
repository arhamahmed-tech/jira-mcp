#!/usr/bin/env node
/**
 * Jira MCP Server — HTTP Edition
 * Streamable HTTP transport with per-request credentials.
 * 30+ tools covering issues, sprints, boards, worklogs,
 * watchers, attachments, dashboards, users, versions, components,
 * bulk ops, analytics, and smart helpers.
 */

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import axios from "axios";
import { z } from "zod";
import dayjs from "dayjs";

// ─── Server Config ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);
const AUTH_MODE = process.env.AUTH_MODE || "open"; // "open" or "authorized"
const API_KEY = process.env.API_KEY || "";

if (AUTH_MODE === "authorized" && !API_KEY) {
  console.error("Error: AUTH_MODE=authorized requires API_KEY to be set.");
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtError(err) {
  const r = err?.response;
  if (r) {
    const msgs = r.data?.errors
      ? Object.values(r.data.errors).join("; ")
      : r.data?.errorMessages?.join("; ") || JSON.stringify(r.data);
    return `Jira API ${r.status}: ${msgs}`;
  }
  return err?.message || String(err);
}

function ok(text) { return { content: [{ type: "text", text }] }; }
function err(text) { return { content: [{ type: "text", text: `❌ ${text}` }], isError: true }; }

function fmtIssue(issue, verbose = false, baseUrl = "") {
  const f = issue.fields;
  const lines = [
    `Key:         ${issue.key}`,
    `Summary:     ${f.summary}`,
    `Status:      ${f.status?.name}`,
    `Type:        ${f.issuetype?.name}`,
    `Priority:    ${f.priority?.name || "—"}`,
    `Assignee:    ${f.assignee?.displayName || "Unassigned"}`,
    `Reporter:    ${f.reporter?.displayName || "—"}`,
    `Created:     ${f.created?.slice(0, 10)}`,
    `Updated:     ${f.updated?.slice(0, 10)}`,
    `Due Date:    ${f.duedate || "—"}`,
    `Story Points:${f.story_points || f.customfield_10016 || f.customfield_10028 || "—"}`,
    `Sprint:      ${f.customfield_10020?.[0]?.name || "—"}`,
    `Labels:      ${f.labels?.join(", ") || "—"}`,
    `Components:  ${f.components?.map(c => c.name).join(", ") || "—"}`,
    `Fix Version: ${f.fixVersions?.map(v => v.name).join(", ") || "—"}`,
    `URL:         ${baseUrl}/browse/${issue.key}`,
  ];
  if (verbose && f.description) lines.push(`\nDescription:\n${f.description}`);
  if (verbose && f.comment?.comments?.length) {
    lines.push(`\nComments (${f.comment.total}):`);
    f.comment.comments.slice(-3).forEach(c => {
      lines.push(`  [${c.created?.slice(0, 10)} - ${c.author?.displayName}]: ${c.body?.slice(0, 200)}`);
    });
  }
  return lines.join("\n");
}

function fmtIssueRow(i) {
  const f = i.fields;
  return `• ${i.key.padEnd(12)} [${(f.status?.name || "").padEnd(12)}] [${(f.priority?.name || "—").padEnd(8)}] ${f.summary?.slice(0, 60)} — ${f.assignee?.displayName || "Unassigned"}`;
}

// ─── Create Jira Client from Headers ────────────────────────────────────────
function createJiraClient(headers) {
  const baseUrl = (headers["x-jira-base-url"] || "").replace(/\/$/, "");
  const email = headers["x-jira-email"] || "";
  const token = headers["x-jira-token"] || "";
  const username = headers["x-jira-username"] || "";

  if (!baseUrl || !token || (!email && !username)) {
    return null;
  }

  let authHeader = null;
  if (email && token) {
    authHeader = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  } else if (username && token) {
    authHeader = "Basic " + Buffer.from(`${username}:${token}`).toString("base64");
  }

  function client(version = 2) {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (authHeader) h["Authorization"] = authHeader;
    return axios.create({ baseURL: `${baseUrl}/rest/api/${version}`, headers: h, timeout: 20_000 });
  }

  function agileClient() {
    const h = { "Content-Type": "application/json", Accept: "application/json" };
    if (authHeader) h["Authorization"] = authHeader;
    return axios.create({ baseURL: `${baseUrl}/rest/agile/1.0`, headers: h, timeout: 20_000 });
  }

  return { client, agileClient, baseUrl };
}

// ─── Register Tools (per-request with jira context) ─────────────────────────
function registerTools(server, jira) {
  const { client, agileClient, baseUrl } = jira;

  // 1. Create Issue
  server.tool("create_issue", {
    project_key:   z.string().describe("Project key e.g. PROJ"),
    summary:       z.string().describe("Issue title"),
    description:   z.string().optional().describe("Detailed description"),
    issue_type:    z.string().default("Task").describe("Task | Bug | Story | Epic | Sub-task"),
    priority:      z.string().optional().describe("Highest | High | Medium | Low | Lowest"),
    assignee:      z.string().optional().describe("Username to assign"),
    reporter:      z.string().optional().describe("Username as reporter"),
    labels:        z.array(z.string()).optional(),
    components:    z.array(z.string()).optional(),
    fix_versions:  z.array(z.string()).optional(),
    parent_key:    z.string().optional().describe("Parent issue key for sub-tasks"),
    due_date:      z.string().optional().describe("Due date YYYY-MM-DD"),
    story_points:  z.number().optional().describe("Story points estimate"),
    epic_link:     z.string().optional().describe("Epic issue key to link to"),
    sprint_id:     z.number().optional().describe("Sprint ID to add issue to"),
  }, async (args) => {
    const c = client();
    const fields = {
      project:   { key: args.project_key },
      summary:   args.summary,
      issuetype: { name: args.issue_type },
    };
    if (args.description)    fields.description   = args.description;
    if (args.priority)       fields.priority      = { name: args.priority };
    if (args.assignee)       fields.assignee      = { name: args.assignee };
    if (args.reporter)       fields.reporter      = { name: args.reporter };
    if (args.labels?.length) fields.labels        = args.labels;
    if (args.components?.length) fields.components = args.components.map(n => ({ name: n }));
    if (args.fix_versions?.length) fields.fixVersions = args.fix_versions.map(n => ({ name: n }));
    if (args.parent_key)     fields.parent        = { key: args.parent_key };
    if (args.due_date)       fields.duedate       = args.due_date;
    if (args.story_points)   fields.customfield_10016 = args.story_points;
    if (args.epic_link)      fields.customfield_10014 = args.epic_link;

    try {
      const { data } = await c.post("/issue", { fields });
      if (args.sprint_id) {
        try { await agileClient().post(`/sprint/${args.sprint_id}/issue`, { issues: [data.key] }); }
        catch (_) { /* non-fatal */ }
      }
      return ok(`✅ Issue created!\nKey: ${data.key}\nURL: ${baseUrl}/browse/${data.key}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 2. Bulk Create Issues
  server.tool("bulk_create_issues", {
    project_key: z.string(),
    issues: z.array(z.object({
      summary:      z.string(),
      description:  z.string().optional(),
      issue_type:   z.string().default("Task"),
      priority:     z.string().optional(),
      assignee:     z.string().optional(),
      labels:       z.array(z.string()).optional(),
      due_date:     z.string().optional(),
      story_points: z.number().optional(),
    })).describe("List of issues to create"),
  }, async (args) => {
    const issueUpdates = args.issues.map(i => {
      const fields = {
        project:   { key: args.project_key },
        summary:   i.summary,
        issuetype: { name: i.issue_type },
      };
      if (i.description)    fields.description        = i.description;
      if (i.priority)       fields.priority           = { name: i.priority };
      if (i.assignee)       fields.assignee           = { name: i.assignee };
      if (i.labels?.length) fields.labels             = i.labels;
      if (i.due_date)       fields.duedate            = i.due_date;
      if (i.story_points)   fields.customfield_10016  = i.story_points;
      return { fields };
    });
    try {
      const { data } = await client().post("/issue/bulk", { issueUpdates });
      const keys = data.issues?.map(i => i.key).join(", ") || "—";
      const errs = data.errors?.length ? `\n⚠️  ${data.errors.length} failed.` : "";
      return ok(`✅ Bulk created ${data.issues?.length || 0} issue(s): ${keys}${errs}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 3. Get Issue (verbose)
  server.tool("get_issue", {
    issue_key: z.string().describe("e.g. PROJ-123"),
    verbose:   z.boolean().default(true).describe("Include description and recent comments"),
  }, async ({ issue_key, verbose }) => {
    try {
      const expand = verbose ? "renderedFields,names,changelog" : "";
      const { data } = await client().get(`/issue/${issue_key}`, {
        params: {
          fields: "summary,status,issuetype,priority,assignee,reporter,created,updated,duedate,labels,components,fixVersions,description,comment,customfield_10016,customfield_10020,customfield_10014,story_points",
          expand,
        }
      });
      return ok(fmtIssue(data, verbose, baseUrl));
    } catch (e) { return err(fmtError(e)); }
  });

  // 4. Update Issue
  server.tool("update_issue", {
    issue_key:    z.string(),
    summary:      z.string().optional(),
    description:  z.string().optional(),
    priority:     z.string().optional(),
    assignee:     z.string().optional().describe("Username or empty string to unassign"),
    labels:       z.array(z.string()).optional(),
    due_date:     z.string().optional().describe("YYYY-MM-DD or empty to clear"),
    story_points: z.number().optional(),
    components:   z.array(z.string()).optional(),
    fix_versions: z.array(z.string()).optional(),
  }, async (args) => {
    const fields = {};
    if (args.summary !== undefined)      fields.summary           = args.summary;
    if (args.description !== undefined)  fields.description       = args.description;
    if (args.priority !== undefined)     fields.priority          = { name: args.priority };
    if (args.assignee !== undefined)     fields.assignee          = args.assignee ? { name: args.assignee } : null;
    if (args.labels !== undefined)       fields.labels            = args.labels;
    if (args.due_date !== undefined)     fields.duedate           = args.due_date || null;
    if (args.story_points !== undefined) fields.customfield_10016 = args.story_points;
    if (args.components !== undefined)   fields.components        = args.components.map(n => ({ name: n }));
    if (args.fix_versions !== undefined) fields.fixVersions       = args.fix_versions.map(n => ({ name: n }));
    try {
      await client().put(`/issue/${args.issue_key}`, { fields });
      return ok(`✅ ${args.issue_key} updated.`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 5. Transition Issue
  server.tool("transition_issue", {
    issue_key:       z.string(),
    transition_name: z.string().describe("e.g. 'In Progress', 'Done', 'Resolve Issue'"),
    comment:         z.string().optional(),
    resolution:      z.string().optional().describe("Resolution name when closing e.g. 'Fixed', 'Won\\'t Fix'"),
  }, async ({ issue_key, transition_name, comment, resolution }) => {
    const c = client();
    try {
      const { data: tData } = await c.get(`/issue/${issue_key}/transitions`);
      const t = tData.transitions.find(t => t.name.toLowerCase() === transition_name.toLowerCase());
      if (!t) {
        const avail = tData.transitions.map(t => `"${t.name}"`).join(", ");
        return err(`Transition "${transition_name}" not found.\nAvailable: ${avail}`);
      }
      const body = { transition: { id: t.id } };
      if (comment)    body.update = { comment: [{ add: { body: comment } }] };
      if (resolution) body.fields = { resolution: { name: resolution } };
      await c.post(`/issue/${issue_key}/transitions`, body);
      return ok(`✅ ${issue_key} → "${t.name}"${comment ? " (with comment)" : ""}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 6. Clone Issue
  server.tool("clone_issue", {
    issue_key:       z.string().describe("Issue to clone"),
    new_summary:     z.string().optional().describe("Override summary (default: 'Clone of <original>')"),
    target_project:  z.string().optional().describe("Target project key (default: same project)"),
    assignee:        z.string().optional(),
  }, async ({ issue_key, new_summary, target_project, assignee }) => {
    const c = client();
    try {
      const { data: orig } = await c.get(`/issue/${issue_key}`);
      const f = orig.fields;
      const fields = {
        project:   { key: target_project || f.project?.key },
        summary:   new_summary || `Clone of ${f.summary}`,
        issuetype: { name: f.issuetype?.name || "Task" },
      };
      if (f.description)  fields.description = f.description;
      if (f.priority)     fields.priority    = { name: f.priority.name };
      if (assignee)       fields.assignee    = { name: assignee };
      else if (f.assignee) fields.assignee   = { name: f.assignee.name };
      if (f.labels?.length)    fields.labels     = f.labels;
      if (f.components?.length) fields.components = f.components.map(c => ({ name: c.name }));
      const { data } = await c.post("/issue", { fields });
      return ok(`✅ Cloned ${issue_key} → ${data.key}\nURL: ${baseUrl}/browse/${data.key}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 7. Link Issues
  server.tool("link_issues", {
    inward_key:   z.string().describe("Issue key (e.g. source issue)"),
    outward_key:  z.string().describe("Issue key (e.g. target issue)"),
    link_type:    z.string().default("Relates").describe("Relates | Blocks | Cloners | Duplicate | ..."),
    comment:      z.string().optional(),
  }, async ({ inward_key, outward_key, link_type, comment }) => {
    const body = {
      type:         { name: link_type },
      inwardIssue:  { key: inward_key },
      outwardIssue: { key: outward_key },
    };
    if (comment) body.comment = { body: comment };
    try {
      await client().post("/issueLink", body);
      return ok(`✅ Linked ${inward_key} ↔ ${outward_key} (${link_type})`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 8. Delete Issue
  server.tool("delete_issue", {
    issue_key:      z.string(),
    delete_subtasks: z.boolean().default(false),
  }, async ({ issue_key, delete_subtasks }) => {
    try {
      await client().delete(`/issue/${issue_key}`, { params: { deleteSubtasks: String(delete_subtasks) } });
      return ok(`✅ ${issue_key} deleted.`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 9. Search Issues
  server.tool("search_issues", {
    jql:         z.string().describe("JQL query"),
    max_results: z.number().int().min(1).max(100).default(25),
    start_at:    z.number().int().default(0).describe("Pagination offset"),
    fields:      z.array(z.string()).optional(),
  }, async ({ jql, max_results, start_at, fields }) => {
    try {
      const { data } = await client().post("/search", {
        jql,
        maxResults: max_results,
        startAt: start_at,
        fields: fields || ["summary", "status", "assignee", "priority", "issuetype", "created", "updated", "duedate", "labels", "customfield_10016"],
      });
      if (!data.issues?.length) return ok("No issues found.");
      const header = `Found ${data.total} issue(s) — showing ${start_at + 1}–${start_at + data.issues.length}:\n`;
      const rows = data.issues.map(fmtIssueRow).join("\n");
      return ok(header + "\n" + rows);
    } catch (e) { return err(fmtError(e)); }
  });

  // 10. My Open Issues
  server.tool("my_issues", {
    status:      z.string().optional().describe("Filter by status e.g. 'In Progress'"),
    project_key: z.string().optional(),
    max_results: z.number().int().default(20),
  }, async ({ status, project_key, max_results }) => {
    let jql = "assignee = currentUser()";
    if (status)      jql += ` AND status = "${status}"`;
    else             jql += ` AND status != Done`;
    if (project_key) jql += ` AND project = ${project_key}`;
    jql += " ORDER BY priority DESC, updated DESC";
    try {
      const { data } = await client().post("/search", {
        jql, maxResults: max_results,
        fields: ["summary", "status", "priority", "issuetype", "project", "duedate", "updated"],
      });
      if (!data.issues?.length) return ok("No issues assigned to you.");
      return ok(`Your issues (${data.total} total):\n\n` + data.issues.map(fmtIssueRow).join("\n"));
    } catch (e) { return err(fmtError(e)); }
  });

  // 11. Project Summary / Analytics
  server.tool("project_summary", {
    project_key: z.string().describe("Project key"),
  }, async ({ project_key }) => {
    const c = client();
    try {
      const jql = `project = ${project_key}`;
      const statuses = ["To Do", "In Progress", "In Review", "Done", "Blocked"];

      const [projRes, totalRes, ...statusResults] = await Promise.all([
        c.get(`/project/${project_key}`),
        c.post("/search", { jql, maxResults: 0 }),
        ...statuses.map(s =>
          c.post("/search", { jql: `${jql} AND status = "${s}"`, maxResults: 0 }).catch(() => ({ data: { total: 0 } }))
        ),
      ]);

      const proj = projRes.data;
      const total = totalRes.data.total;
      const counts = statuses.map((s, i) => `  ${s.padEnd(14)}: ${statusResults[i].data.total}`);

      const { data: recent } = await c.post("/search", {
        jql: `${jql} AND updated >= -7d ORDER BY updated DESC`,
        maxResults: 5,
        fields: ["summary", "status", "assignee", "updated"],
      });

      const recentLines = recent.issues?.map(i =>
        `  ${i.key} [${i.fields.status?.name}] ${i.fields.summary?.slice(0, 50)}`
      ).join("\n") || "  None";

      return ok([
        `📊 Project: ${proj.name} (${proj.key})`,
        `Lead:       ${proj.lead?.displayName || "—"}`,
        `Type:       ${proj.projectTypeKey}`,
        `URL:        ${baseUrl}/browse/${proj.key}`,
        ``,
        `── Issue Counts (${total} total) ──`,
        ...counts,
        ``,
        `── Updated in last 7 days ──`,
        recentLines,
      ].join("\n"));
    } catch (e) { return err(fmtError(e)); }
  });

  // 12. Assignee Workload
  server.tool("assignee_workload", {
    project_key: z.string().optional(),
    status:      z.string().optional().describe("Filter status (default: open issues only)"),
  }, async ({ project_key, status }) => {
    let jql = status ? `status = "${status}"` : `status not in (Done, Closed, Resolved)`;
    if (project_key) jql += ` AND project = ${project_key}`;
    try {
      const { data } = await client().post("/search", {
        jql, maxResults: 100,
        fields: ["assignee", "priority", "status"],
      });
      const map = {};
      for (const i of data.issues) {
        const name = i.fields.assignee?.displayName || "Unassigned";
        map[name] = (map[name] || 0) + 1;
      }
      const rows = Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `  ${n.padEnd(30)} ${c} issue(s)`)
        .join("\n");
      return ok(`Workload (${data.total} open issues):\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 13. Overdue Issues
  server.tool("overdue_issues", {
    project_key: z.string().optional(),
    max_results: z.number().int().default(20),
  }, async ({ project_key, max_results }) => {
    let jql = `duedate < now() AND status not in (Done, Closed, Resolved)`;
    if (project_key) jql += ` AND project = ${project_key}`;
    jql += " ORDER BY duedate ASC";
    try {
      const { data } = await client().post("/search", {
        jql, maxResults: max_results,
        fields: ["summary", "status", "priority", "assignee", "duedate"],
      });
      if (!data.issues?.length) return ok("🎉 No overdue issues!");
      const rows = data.issues.map(i => {
        const f = i.fields;
        const overby = dayjs().diff(dayjs(f.duedate), "day");
        return `• ${i.key.padEnd(12)} [${f.priority?.name?.padEnd(8)}] Due: ${f.duedate} (${overby}d overdue) ${f.summary?.slice(0, 40)} — ${f.assignee?.displayName || "Unassigned"}`;
      }).join("\n");
      return ok(`⚠️  Overdue Issues (${data.total}):\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 14. Add / List Comments
  server.tool("add_comment", {
    issue_key: z.string(),
    body:      z.string().describe("Comment text"),
  }, async ({ issue_key, body }) => {
    try {
      const { data } = await client().post(`/issue/${issue_key}/comment`, { body });
      return ok(`✅ Comment added (id: ${data.id}) on ${issue_key}`);
    } catch (e) { return err(fmtError(e)); }
  });

  server.tool("list_comments", {
    issue_key:   z.string(),
    max_results: z.number().int().default(10),
  }, async ({ issue_key, max_results }) => {
    try {
      const { data } = await client().get(`/issue/${issue_key}/comment`, {
        params: { maxResults: max_results, orderBy: "-created" }
      });
      if (!data.comments?.length) return ok("No comments.");
      const rows = data.comments.map(c =>
        `[${c.created?.slice(0, 16)} — ${c.author?.displayName}]\n${c.body}\n`
      ).join("\n---\n");
      return ok(`Comments on ${issue_key} (${data.total} total):\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 15. Log Work
  server.tool("log_work", {
    issue_key:        z.string(),
    time_spent:       z.string().describe("e.g. '2h 30m', '1d', '45m'"),
    comment:          z.string().optional(),
    started:          z.string().optional().describe("ISO datetime, default: now"),
    remaining_estimate: z.string().optional().describe("Override remaining e.g. '1h'"),
  }, async ({ issue_key, time_spent, comment, started, remaining_estimate }) => {
    const body = {
      timeSpent: time_spent,
      started: started || dayjs().format("YYYY-MM-DDTHH:mm:ss.SSSZZ"),
    };
    if (comment)             body.comment           = comment;
    if (remaining_estimate)  body.remainingEstimate = remaining_estimate;
    try {
      const { data } = await client().post(`/issue/${issue_key}/worklog`, body);
      return ok(`✅ Logged ${time_spent} on ${issue_key} (worklog id: ${data.id})`);
    } catch (e) { return err(fmtError(e)); }
  });

  server.tool("get_worklogs", {
    issue_key: z.string(),
  }, async ({ issue_key }) => {
    try {
      const { data } = await client().get(`/issue/${issue_key}/worklog`);
      if (!data.worklogs?.length) return ok("No worklogs.");
      let total = 0;
      const rows = data.worklogs.map(w => {
        total += w.timeSpentSeconds || 0;
        return `• ${w.started?.slice(0, 10)} — ${w.author?.displayName}: ${w.timeSpent}${w.comment ? ` — ${w.comment.slice(0, 60)}` : ""}`;
      }).join("\n");
      const totalH = (total / 3600).toFixed(1);
      return ok(`Worklogs for ${issue_key} — Total: ${totalH}h\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 16. Watchers
  server.tool("manage_watchers", {
    issue_key: z.string(),
    action:    z.enum(["list", "add", "remove"]).default("list"),
    username:  z.string().optional().describe("Required for add/remove"),
  }, async ({ issue_key, action, username }) => {
    const c = client();
    try {
      if (action === "list") {
        const { data } = await c.get(`/issue/${issue_key}/watchers`);
        const names = data.watchers?.map(w => w.displayName).join(", ") || "None";
        return ok(`Watchers on ${issue_key} (${data.watchCount}): ${names}`);
      }
      if (!username) return err("username required for add/remove");
      if (action === "add") {
        await c.post(`/issue/${issue_key}/watchers`, JSON.stringify(username));
        return ok(`✅ Added ${username} as watcher on ${issue_key}`);
      }
      if (action === "remove") {
        await c.delete(`/issue/${issue_key}/watchers`, { params: { username } });
        return ok(`✅ Removed ${username} from watchers on ${issue_key}`);
      }
    } catch (e) { return err(fmtError(e)); }
  });

  // 17. List Boards
  server.tool("list_boards", {
    project_key: z.string().optional(),
    type:        z.string().optional().describe("scrum | kanban"),
    max_results: z.number().int().default(20),
  }, async ({ project_key, type, max_results }) => {
    try {
      const params = { maxResults: max_results };
      if (project_key) params.projectKeyOrId = project_key;
      if (type)        params.type = type;
      const { data } = await agileClient().get("/board", { params });
      if (!data.values?.length) return ok("No boards found.");
      const rows = data.values.map(b => `• ${String(b.id).padEnd(6)} [${b.type}] ${b.name}`).join("\n");
      return ok(`Boards (${data.total}):\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 18. List Sprints
  server.tool("list_sprints", {
    board_id:   z.number().int().describe("Board ID from list_boards"),
    state:      z.string().optional().describe("active | closed | future"),
    max_results: z.number().int().default(10),
  }, async ({ board_id, state, max_results }) => {
    try {
      const params = { maxResults: max_results };
      if (state) params.state = state;
      const { data } = await agileClient().get(`/board/${board_id}/sprint`, { params });
      if (!data.values?.length) return ok("No sprints found.");
      const rows = data.values.map(s =>
        `• ID:${s.id} [${s.state}] ${s.name} | Start: ${s.startDate?.slice(0,10) || "—"} End: ${s.endDate?.slice(0,10) || "—"}`
      ).join("\n");
      return ok(`Sprints for board ${board_id}:\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 19. Sprint Issues
  server.tool("sprint_issues", {
    sprint_id:   z.number().int().describe("Sprint ID from list_sprints"),
    status:      z.string().optional(),
    max_results: z.number().int().default(50),
  }, async ({ sprint_id, status, max_results }) => {
    try {
      let jql = `sprint = ${sprint_id}`;
      if (status) jql += ` AND status = "${status}"`;
      const { data } = await client().post("/search", {
        jql, maxResults: max_results,
        fields: ["summary", "status", "assignee", "priority", "issuetype", "customfield_10016"],
      });
      if (!data.issues?.length) return ok("No issues in this sprint.");
      const rows = data.issues.map(fmtIssueRow).join("\n");
      return ok(`Sprint ${sprint_id} issues (${data.total}):\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 20. Move Issue to Sprint
  server.tool("move_to_sprint", {
    sprint_id: z.number().int(),
    issue_keys: z.array(z.string()).describe("Issue keys to move"),
  }, async ({ sprint_id, issue_keys }) => {
    try {
      await agileClient().post(`/sprint/${sprint_id}/issue`, { issues: issue_keys });
      return ok(`✅ Moved ${issue_keys.join(", ")} to sprint ${sprint_id}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 21. Active Sprint Summary
  server.tool("active_sprint_summary", {
    board_id: z.number().int(),
  }, async ({ board_id }) => {
    const ag = agileClient();
    const c = client();
    try {
      const { data: sprintData } = await ag.get(`/board/${board_id}/sprint`, { params: { state: "active" } });
      const sprint = sprintData.values?.[0];
      if (!sprint) return ok("No active sprint found.");

      const { data } = await c.post("/search", {
        jql: `sprint = ${sprint.id}`,
        maxResults: 100,
        fields: ["status", "assignee", "priority", "customfield_10016"],
      });

      const issues = data.issues || [];
      const done    = issues.filter(i => ["Done","Closed","Resolved"].includes(i.fields.status?.name));
      const inprog  = issues.filter(i => i.fields.status?.name === "In Progress");
      const todo    = issues.filter(i => ["To Do","Open","Backlog"].includes(i.fields.status?.name));
      const blocked = issues.filter(i => i.fields.status?.name === "Blocked");

      const totalSP = issues.reduce((s, i) => s + (i.fields.customfield_10016 || 0), 0);
      const doneSP  = done.reduce((s, i) => s + (i.fields.customfield_10016 || 0), 0);

      return ok([
        `🏃 Active Sprint: ${sprint.name}`,
        `   Start: ${sprint.startDate?.slice(0,10)} → End: ${sprint.endDate?.slice(0,10)}`,
        `   Days remaining: ${dayjs(sprint.endDate).diff(dayjs(), "day")}`,
        ``,
        `── Progress ──`,
        `   Total issues:  ${issues.length}`,
        `   ✅ Done:       ${done.length}`,
        `   🔄 In Progress:${inprog.length}`,
        `   📋 To Do:      ${todo.length}`,
        `   🚫 Blocked:    ${blocked.length}`,
        ``,
        `── Story Points ──`,
        `   Completed: ${doneSP} / ${totalSP} SP`,
        `   Progress:  ${totalSP ? Math.round(doneSP/totalSP*100) : 0}%`,
      ].join("\n"));
    } catch (e) { return err(fmtError(e)); }
  });

  // 22. List Projects
  server.tool("list_projects", {
    query:      z.string().optional().describe("Filter by name or key"),
    project_type: z.string().optional().describe("software | business | service_desk"),
  }, async ({ query, project_type }) => {
    try {
      const { data } = await client().get("/project", { params: { expand: "description,lead" } });
      let projects = data;
      if (query) { const q = query.toLowerCase(); projects = projects.filter(p => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)); }
      if (project_type) projects = projects.filter(p => p.projectTypeKey === project_type);
      const rows = projects.map(p =>
        `• ${p.key.padEnd(12)} [${p.projectTypeKey}] ${p.name} — Lead: ${p.lead?.displayName || "—"}`
      ).join("\n");
      return ok(projects.length ? `Projects (${projects.length}):\n\n${rows}` : "No projects found.");
    } catch (e) { return err(fmtError(e)); }
  });

  // 23. Manage Versions
  server.tool("manage_versions", {
    project_key: z.string(),
    action:      z.enum(["list", "create", "release", "archive"]).default("list"),
    name:        z.string().optional().describe("Version name for create/release/archive"),
    description: z.string().optional(),
    release_date: z.string().optional().describe("YYYY-MM-DD"),
  }, async ({ project_key, action, name, description, release_date }) => {
    const c = client();
    try {
      if (action === "list") {
        const { data } = await c.get(`/project/${project_key}/versions`);
        if (!data.length) return ok("No versions.");
        const rows = data.map(v =>
          `• ${v.name.padEnd(20)} [${v.released ? "Released" : v.archived ? "Archived" : "Unreleased"}] ${v.releaseDate || ""}`
        ).join("\n");
        return ok(`Versions for ${project_key}:\n\n${rows}`);
      }
      if (action === "create") {
        if (!name) return err("name required");
        const body = { name, project: project_key, released: false };
        if (description)  body.description = description;
        if (release_date) body.releaseDate = release_date;
        const { data } = await c.post("/version", body);
        return ok(`✅ Version "${data.name}" created (id: ${data.id})`);
      }
      const { data: versions } = await c.get(`/project/${project_key}/versions`);
      const v = versions.find(v => v.name === name);
      if (!v) return err(`Version "${name}" not found`);
      const patch = action === "release" ? { released: true, releaseDate: release_date || dayjs().format("YYYY-MM-DD") }
                                         : { archived: true };
      await c.put(`/version/${v.id}`, patch);
      return ok(`✅ Version "${name}" ${action}d.`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 24. Manage Components
  server.tool("manage_components", {
    project_key: z.string(),
    action:      z.enum(["list", "create", "delete"]).default("list"),
    name:        z.string().optional(),
    description: z.string().optional(),
    lead:        z.string().optional().describe("Component lead username"),
  }, async ({ project_key, action, name, description, lead }) => {
    const c = client();
    try {
      if (action === "list") {
        const { data } = await c.get(`/project/${project_key}/components`);
        const rows = data.map(comp =>
          `• ${comp.name.padEnd(20)} Lead: ${comp.lead?.displayName || "—"} — ${comp.description || ""}`
        ).join("\n");
        return ok(data.length ? `Components for ${project_key}:\n\n${rows}` : "No components.");
      }
      if (action === "create") {
        if (!name) return err("name required");
        const body = { name, project: project_key };
        if (description) body.description = description;
        if (lead)        body.leadUserName = lead;
        const { data } = await c.post("/component", body);
        return ok(`✅ Component "${data.name}" created (id: ${data.id})`);
      }
      if (action === "delete") {
        if (!name) return err("name required");
        const { data: comps } = await c.get(`/project/${project_key}/components`);
        const comp = comps.find(c => c.name === name);
        if (!comp) return err(`Component "${name}" not found`);
        await c.delete(`/component/${comp.id}`);
        return ok(`✅ Component "${name}" deleted.`);
      }
    } catch (e) { return err(fmtError(e)); }
  });

  // 25. Get Issue Types
  server.tool("get_issue_types", {
    project_key: z.string(),
  }, async ({ project_key }) => {
    try {
      const { data } = await client().get(`/project/${project_key}`);
      const rows = data.issueTypes?.map(t =>
        `• ${t.name.padEnd(15)} ${t.subtask ? "(sub-task)" : ""} — ${t.description || ""}`
      ).join("\n") || "None";
      return ok(`Issue types for ${project_key}:\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 26. Search Users
  server.tool("search_users", {
    query:       z.string().describe("Name, username or email fragment"),
    max_results: z.number().int().default(10),
  }, async ({ query, max_results }) => {
    try {
      const { data } = await client().get("/user/search", {
        params: { username: query, maxResults: max_results }
      });
      if (!data.length) return ok("No users found.");
      const rows = data.map(u =>
        `• ${u.name.padEnd(20)} ${u.displayName.padEnd(25)} ${u.emailAddress || ""}`
      ).join("\n");
      return ok(`Users matching "${query}":\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 27. Get Current User
  server.tool("get_current_user", {}, async () => {
    try {
      const { data } = await client().get("/myself");
      return ok([
        `Username:     ${data.name}`,
        `Display Name: ${data.displayName}`,
        `Email:        ${data.emailAddress}`,
        `Time Zone:    ${data.timeZone}`,
        `Active:       ${data.active}`,
      ].join("\n"));
    } catch (e) { return err(fmtError(e)); }
  });

  // 28. Bulk Transition Issues
  server.tool("bulk_transition", {
    jql:             z.string().describe("JQL to select issues"),
    transition_name: z.string().describe("Target transition name"),
    comment:         z.string().optional(),
    max_issues:      z.number().int().default(50),
  }, async ({ jql, transition_name, comment, max_issues }) => {
    const c = client();
    try {
      const { data } = await c.post("/search", { jql, maxResults: max_issues, fields: ["summary", "status"] });
      if (!data.issues?.length) return ok("No issues matched the JQL.");

      let success = 0; let failed = 0;
      for (const issue of data.issues) {
        try {
          const { data: tData } = await c.get(`/issue/${issue.key}/transitions`);
          const t = tData.transitions.find(t => t.name.toLowerCase() === transition_name.toLowerCase());
          if (!t) { failed++; continue; }
          const body = { transition: { id: t.id } };
          if (comment) body.update = { comment: [{ add: { body: comment } }] };
          await c.post(`/issue/${issue.key}/transitions`, body);
          success++;
        } catch (_) { failed++; }
      }
      return ok(`✅ Bulk transition complete.\nSuccess: ${success}  Failed: ${failed}  Total: ${data.issues.length}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 29. Bulk Assign Issues
  server.tool("bulk_assign", {
    jql:        z.string().describe("JQL to select issues"),
    assignee:   z.string().describe("Username to assign to"),
    max_issues: z.number().int().default(50),
  }, async ({ jql, assignee, max_issues }) => {
    const c = client();
    try {
      const { data } = await c.post("/search", { jql, maxResults: max_issues, fields: ["summary"] });
      if (!data.issues?.length) return ok("No issues matched.");
      let success = 0; let failed = 0;
      for (const issue of data.issues) {
        try {
          await c.put(`/issue/${issue.key}`, { fields: { assignee: { name: assignee } } });
          success++;
        } catch (_) { failed++; }
      }
      return ok(`✅ Bulk assign complete.\nAssigned to ${assignee}: ${success}  Failed: ${failed}`);
    } catch (e) { return err(fmtError(e)); }
  });

  // 30. Get Changelog / History
  server.tool("issue_changelog", {
    issue_key:   z.string(),
    max_results: z.number().int().default(20),
  }, async ({ issue_key, max_results }) => {
    try {
      const { data } = await client().get(`/issue/${issue_key}`, {
        params: { expand: "changelog", fields: "summary" }
      });
      const histories = data.changelog?.histories?.slice(-max_results) || [];
      if (!histories.length) return ok("No changelog entries.");
      const rows = histories.map(h => {
        const changes = h.items.map(i => `    ${i.field}: "${i.fromString || "—"}" → "${i.toString || "—"}"`).join("\n");
        return `[${h.created?.slice(0,16)} — ${h.author?.displayName}]\n${changes}`;
      }).join("\n\n");
      return ok(`Changelog for ${issue_key}:\n\n${rows}`);
    } catch (e) { return err(fmtError(e)); }
  });
}

// ─── HTTP Request Handler ───────────────────────────────────────────────────
async function handleRequest(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, X-Jira-Base-Url, X-Jira-Email, X-Jira-Token, X-Jira-Username, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: "jira-mcp-server",
      version: "1.0.0",
      status: "running",
      authMode: AUTH_MODE,
      transport: "streamable-http",
    }));
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && req.url === "/mcp") {
    // Auth check for authorized mode
    if (AUTH_MODE === "authorized") {
      const apiKey = req.headers["x-api-key"];
      if (!apiKey || apiKey !== API_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing X-Api-Key header" }));
        return;
      }
    }

    // Extract Jira credentials from headers
    const jira = createJiraClient(req.headers);
    if (!jira) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Missing Jira credentials",
        required: ["X-Jira-Base-Url", "X-Jira-Token", "X-Jira-Email or X-Jira-Username"],
      }));
      return;
    }

    // Create server and transport for this request
    const server = new McpServer({
      name: "jira-mcp-server",
      version: "1.0.0",
      description: `Jira MCP server — ${jira.baseUrl}`,
    });

    registerTools(server, jira);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

// ─── Start Server ───────────────────────────────────────────────────────────
const httpServer = createServer(handleRequest);

httpServer.listen(PORT, () => {
  console.log(`[jira-mcp-server] HTTP server running on http://localhost:${PORT}`);
  console.log(`[jira-mcp-server] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[jira-mcp-server] Auth mode: ${AUTH_MODE}`);
});
