/**
 * Netlify Function: Health Check
 */

export default async (request, context) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return Response.json(
    {
      name: "jira-mcp-server",
      version: "1.0.0",
      status: "ok",
      transport: "streamable-http",
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  );
};
