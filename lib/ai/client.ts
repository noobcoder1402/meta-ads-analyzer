import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export type AIProvider = "anthropic" | "gemini";

export type ImageInput = {
  source: { type: "base64"; mediaType: string; data: string } | { type: "url"; url: string };
};

export type GenerateParams<T> = {
  schema: z.ZodType<T>;
  prompt: string;
  staticPrompt?: string;
  images?: ImageInput[];
  model?: "haiku" | "sonnet";
  maxTokens?: number;
  toolName?: string;
  toolDescription?: string;
};

export interface AIClient {
  generate<T>(params: GenerateParams<T>): Promise<T>;
}

const ANTHROPIC_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
} as const;

class AnthropicClient implements AIClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate<T>(params: GenerateParams<T>): Promise<T> {
    const {
      schema,
      prompt,
      staticPrompt,
      images,
      model = "haiku",
      maxTokens = 4096,
      toolName = "record_result",
      toolDescription = "Record the structured result of the analysis.",
    } = params;

    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

    const userContent: Anthropic.ContentBlockParam[] = [];
    if (images) {
      for (const img of images) {
        if (img.source.type === "base64") {
          userContent.push({
            type: "image",
            source: { type: "base64", media_type: img.source.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: img.source.data },
          });
        } else {
          userContent.push({
            type: "image",
            source: { type: "url", url: img.source.url },
          });
        }
      }
    }
    userContent.push({ type: "text", text: prompt });

    const system: Anthropic.TextBlockParam[] = [];
    if (staticPrompt) {
      system.push({
        type: "text",
        text: staticPrompt,
        cache_control: { type: "ephemeral" },
      });
    }

    const response = await this.callWithRetry(() =>
      this.client.messages.create({
        model: ANTHROPIC_MODELS[model],
        max_tokens: maxTokens,
        // Low temperature for reproducibility: the whole product depends on the
        // same ad analyzing to the same angle/themes run-to-run. Not 0 — a little
        // headroom avoids degenerate repetition on the vision pass.
        temperature: 0.2,
        system: system.length > 0 ? system : undefined,
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content: userContent }],
      })
    );

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) {
      throw new Error("Model did not return a tool_use block");
    }

    const parsed = schema.safeParse(toolUse.input);
    if (parsed.success) {
      return parsed.data;
    }

    const retryPrompt = `${prompt}\n\nYour previous response failed schema validation with this error:\n${JSON.stringify(parsed.error.issues, null, 2)}\nReturn a corrected response that matches the schema.`;
    const retryResponse = await this.callWithRetry(() =>
      this.client.messages.create({
        model: ANTHROPIC_MODELS[model],
        max_tokens: maxTokens,
        temperature: 0.2,
        system: system.length > 0 ? system : undefined,
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: toolName },
        messages: [
          {
            role: "user",
            content: [...userContent.slice(0, -1), { type: "text", text: retryPrompt }],
          },
        ],
      })
    );

    const retryToolUse = retryResponse.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!retryToolUse) {
      throw new Error("Model did not return a tool_use block on retry");
    }
    return schema.parse(retryToolUse.input);
  }

  private async callWithRetry<R>(fn: () => Promise<R>, maxAttempts = 4): Promise<R> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isOverloaded = err instanceof Anthropic.APIError && err.status === 529;
        const isRateLimit = err instanceof Anthropic.APIError && err.status === 429;
        const isServerError =
          err instanceof Anthropic.APIError && err.status !== undefined && err.status >= 500;
        if (!isOverloaded && !isRateLimit && !isServerError) throw err;
        if (attempt === maxAttempts - 1) break;
        const delayMs = 1000 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (lastError instanceof Anthropic.APIError) {
      if (lastError.status === 529) {
        throw new Error("Claude is temporarily overloaded. Please try again in a moment.");
      }
      if (lastError.status === 429) {
        throw new Error("Rate limited by Claude. Wait a minute and try again.");
      }
      if (lastError.status !== undefined && lastError.status >= 500) {
        throw new Error("Claude API is having issues right now. Try again shortly.");
      }
    }
    throw lastError;
  }
}

class GeminiClient implements AIClient {
  async generate<T>(params: GenerateParams<T>): Promise<T> {
    void params;
    throw new Error(
      "Gemini provider is not yet implemented. Set MODEL_PROVIDER=anthropic in .env."
    );
  }
}

let cachedClient: AIClient | null = null;

export function getAIClient(): AIClient {
  if (cachedClient) return cachedClient;

  const provider = (process.env.MODEL_PROVIDER ?? "anthropic") as AIProvider;

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is missing or empty. Check .env, and if you launched the dev server from Claude Code, restart with: env -u ANTHROPIC_API_KEY pnpm dev"
      );
    }
    cachedClient = new AnthropicClient(apiKey);
    return cachedClient;
  }

  if (provider === "gemini") {
    cachedClient = new GeminiClient();
    return cachedClient;
  }

  throw new Error(`Unknown MODEL_PROVIDER: ${provider}`);
}
