/**
 * Netlify Function: Health Check
 * Returns server status without exposing sensitive information.
 */

export default async (request, context) => {
  return Response.json({
    name: "jira-mcp-server",
    version: "1.0.0",
    status: "ok",
    transport: "streamable-http",
    endpoints: {
      mcp: "/mcp",
      health: "/health",
    },
  });
};
