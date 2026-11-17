/**
 * STEP 1 — One Claude call: business info in, campaign plan out.
 *
 * This is NOT an agent yet. There are no tools and no loop. It is the single
 * building block every later step is made of: one request, one response.
 *
 * Run:
 *   npm run try:dry   -> prints the exact request we WOULD send (no key, no cost)
 *   npm run try       -> sends it for real (needs ANTHROPIC_API_KEY in .env)
 */
import Anthropic from "@anthropic-ai/sdk";

// --- 1. Load secrets ---------------------------------------------------------
// Node 22 can read a .env file natively. We wrap it because the file is
// optional in dry-run mode.
try {
  process.loadEnvFile(".env");
} catch {
  /* no .env file — fine for dry run */
}

const DRY_RUN = process.argv.includes("--dry-run");

// --- 2. The input --------------------------------------------------------------
// Later this comes from an HTTP request (Step 4) or the database (Step 5).
// Edit it freely to see how the output changes.
const business = {
  name: "GreenLeaf Café",
  industry: "Food & beverage",
  location: "Pune, India",
  product: "Organic coffee, vegan breakfast bowls, work-friendly seating",
  priceRange: "₹250–₹600 per order",
  goal: "Increase weekday morning footfall and online pre-orders",
  monthlyBudget: "₹30,000",
  currentPresence: "Instagram with 1,200 followers, no website ordering yet",
};

// --- 3. The system prompt -------------------------------------------------------
// This is the agent's job description. It is sent with EVERY request because
// Claude remembers nothing between calls.
const SYSTEM_PROMPT = `You are a senior Meta Ads strategist.

Rules:
- Use only Meta's current campaign objectives: Awareness, Traffic, Engagement, Leads, App Promotion, Sales.
- If the business falls into a Meta Special Ad Category (housing, employment, credit/financial, social issues/elections/politics), say so first and explain the targeting restrictions.
- Audience suggestions are hypotheses based on general knowledge, not measured data. Label them as such.
- Ad copy must respect Facebook and Instagram length norms: primary text ideally under 125 characters, headline under 40.
- Show budget arithmetic explicitly so a human can check it.`;

// --- 4. The user message -------------------------------------------------------
const userMessage = `Create a Meta Ads campaign plan for this business:

${JSON.stringify(business, null, 2)}

Structure your answer with these sections:
1. Business understanding (2–3 sentences)
2. Target audiences (2–3 personas, with interests and age ranges)
3. Recommended campaign objective and why
4. Ad copy: 3 variants, each with primary text, headline, and call-to-action button
5. Budget split (campaign / ad set level, daily amounts)
6. 30-day strategy (week by week)`;

// --- 5. The request -------------------------------------------------------------
const MODEL = "claude-opus-5-5";

const request: Anthropic.MessageCreateParamsNonStreaming = {
  model: MODEL,
  max_tokens: 16000, // ceiling on output length; we pay only for what's used
  output_config: { effort: "medium" }, // how hard Claude thinks: low|medium|high|xhigh|max
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: userMessage }],
};

async function main() {
  if (DRY_RUN || !process.env.ANTHROPIC_API_KEY) {
    if (!DRY_RUN) {
      console.log("⚠️  No ANTHROPIC_API_KEY found, so running in dry-run mode.\n");
    }
    console.log("This is the exact JSON body that would be POSTed to the Claude API:\n");
    console.log(JSON.stringify(request, null, 2));
    console.log("\nNo request was sent and no money was spent.");
    return;
  }

  // The client reads ANTHROPIC_API_KEY from the environment automatically.
  const client = new Anthropic();

  const started = Date.now();
  const response = await client.messages.create(request);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // --- 6. Read the response ------------------------------------------------------
  // stop_reason tells you WHY Claude stopped. Always check it before trusting content.
  if (response.stop_reason === "refusal") {
    console.error("Claude declined this request:", response.stop_details);
    return;
  }
  if (response.stop_reason === "max_tokens") {
    console.warn("⚠️  Output was cut off at max_tokens — raise it.\n");
  }

  // response.content is a list of blocks. We only print the "text" blocks
  // (thinking blocks also exist but are empty by default on this model).
  for (const block of response.content) {
    if (block.type === "text") console.log(block.text);
  }

  // --- 7. Cost awareness -----------------------------------------------------------
  // Prices for claude-opus-5-5: $4 per 1M input tokens, $20 per 1M output tokens.
  const { input_tokens, output_tokens } = response.usage;
  const cost = (input_tokens * 4 + output_tokens * 20) / 1_000_000;
  console.log("\n--------------------------------------------");
  console.log(`stop_reason: ${response.stop_reason} | ${seconds}s`);
  console.log(`tokens: ${input_tokens} in / ${output_tokens} out | ≈ $${cost.toFixed(4)}`);
}

main().catch((err) => {
  // Typed errors from the SDK — check the most specific first.
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("Invalid API key. Check ANTHROPIC_API_KEY in .env");
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error("Rate limited. Wait a moment and retry.");
  } else if (err instanceof Anthropic.APIError) {
    console.error(`API error ${err.status}:`, err.message);
  } else {
    throw err;
  }
  process.exitCode = 1;
});
