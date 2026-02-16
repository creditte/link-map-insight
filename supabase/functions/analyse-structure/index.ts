import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { entities, relationships, structureName } = await req.json();

    if (!entities || !relationships) {
      return new Response(
        JSON.stringify({ error: "Missing entities or relationships" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a compact representation for the prompt
    const entitySummary = entities.map((e: any) => {
      const flags: string[] = [];
      if (e.is_operating_entity) flags.push("operating");
      if (e.is_trustee_company) flags.push("trustee company");
      return `- ${e.name} (${e.entity_type}${flags.length ? ", " + flags.join(", ") : ""})`;
    }).join("\n");

    const relSummary = relationships.map((r: any) => {
      const from = entities.find((e: any) => e.id === r.from_entity_id)?.name ?? r.from_entity_id;
      const to = entities.find((e: any) => e.id === r.to_entity_id)?.name ?? r.to_entity_id;
      const details: string[] = [];
      if (r.ownership_percent != null) details.push(`${r.ownership_percent}%`);
      if (r.ownership_units != null) details.push(`${r.ownership_units} units`);
      if (r.ownership_class) details.push(`class: ${r.ownership_class}`);
      const detailStr = details.length ? ` (${details.join(", ")})` : "";
      return `- ${from} → [${r.relationship_type}] → ${to}${detailStr}`;
    }).join("\n");

    const systemPrompt = `You are an expert Australian tax and corporate structure analyst. You analyse entity structures (companies, trusts, individuals, partnerships) and their relationships.

Given a structure, produce a clear analysis with these exact sections using markdown headers:

## Summary
A 2-3 sentence plain English overview of the structure — what it is, how many entities, and the general purpose.

## Ownership Analysis
Explain the ownership chain: who owns what, percentages, unit holdings, and share classes. Identify the ultimate beneficial owners.

## Control Analysis  
Explain the control chain: who are the directors, trustees, appointers, and settlors. Identify who has effective control.

## Potential Issues
List any anomalies, red flags, or items worth reviewing:
- Missing ownership percentages
- Circular ownership
- Unclassified entities
- Entities with no relationships
- Unusual structures
- Missing trustee for trusts

If nothing notable, say "No significant issues identified."

Be concise, professional, and specific. Reference entity names directly. Do not speculate beyond the data provided.`;

    const userPrompt = `Analyse this structure called "${structureName ?? "Unnamed"}":

**Entities (${entities.length}):**
${entitySummary}

**Relationships (${relationships.length}):**
${relSummary}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyse-structure error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
