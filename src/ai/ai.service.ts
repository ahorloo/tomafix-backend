import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TemplateType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type DraftResult = {
  title: string;
  description: string;
  category: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  followUps: string[];
  usedAi: boolean;
};

const SYSTEM_PROMPT = `You are TomaFix's resident ticket assistant. A resident has just typed a short message describing a maintenance issue in their apartment.

Your job: turn their message into a clean, actionable maintenance request and ask a few short follow-up questions if they haven't given enough detail.

Output a single JSON object with these fields:
- "title" (string, max 80 chars): a short, action-oriented summary
- "description" (string): a clean rewrite of what they reported, no fluff
- "category" (string): pick one of the workspace's allowed categories listed below; if none clearly fits, pick "Other"
- "priority" ("LOW" | "NORMAL" | "HIGH" | "URGENT"): URGENT for safety/water-out/no-power, HIGH for blocking issues, NORMAL otherwise
- "followUps" (string[]): 0-4 short clarifying questions you'd ask before assigning a technician (skip if the message is already complete)

Return ONLY the JSON object, no markdown, no preamble.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly prisma: PrismaService) {}

  async draftResidentRequest(workspaceId: string, message: string): Promise<DraftResult> {
    const trimmed = String(message || '').trim();
    if (!trimmed) throw new BadRequestException('message is required');

    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (ws.templateType !== TemplateType.APARTMENT && ws.templateType !== TemplateType.ESTATE) {
      throw new BadRequestException('AI ticket assistant is only available on property templates');
    }

    const categories = await this.prisma.requestCategory.findMany({
      where: { workspaceId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    });
    const categoryNames = categories.map((c) => c.name);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        return await this.draftWithClaude(apiKey, trimmed, categoryNames);
      } catch (e: any) {
        this.logger.warn(`AI draft failed, falling back to heuristic: ${e?.message || e}`);
        // fall through to heuristic
      }
    }

    return this.heuristicDraft(trimmed, categoryNames);
  }

  private async draftWithClaude(apiKey: string, message: string, categoryNames: string[]): Promise<DraftResult> {
    const categoriesBlock = categoryNames.length
      ? `Allowed categories: ${categoryNames.map((n) => `"${n}"`).join(', ')}`
      : 'Allowed categories: "Plumbing", "Electrical", "Carpentry", "Security Light", "Cleaning", "Other"';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            // Cache the static system prompt so subsequent calls are cheaper.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `${categoriesBlock}\n\nResident message:\n"""${message}"""`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${body}`);
    }
    const json = (await res.json()) as any;
    const text = json?.content?.[0]?.text || '';
    if (!text) throw new Error('Empty response from Anthropic');

    const parsed = this.safeParseJson(text);
    if (!parsed) throw new Error('Could not parse JSON from model output');

    const title = String(parsed.title || '').trim().slice(0, 80) || message.slice(0, 80);
    const description = String(parsed.description || '').trim() || message;
    const rawCategory = String(parsed.category || '').trim();
    const category = rawCategory && categoryNames.length
      ? categoryNames.find((c) => c.toLowerCase() === rawCategory.toLowerCase()) || categoryNames.find((c) => c.toLowerCase() === 'other') || rawCategory
      : rawCategory || null;
    const priority = (['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).includes(parsed.priority)
      ? (parsed.priority as DraftResult['priority'])
      : 'NORMAL';
    const followUps = Array.isArray(parsed.followUps)
      ? parsed.followUps.map((q: any) => String(q || '').trim()).filter(Boolean).slice(0, 4)
      : [];

    return { title, description, category, priority, followUps, usedAi: true };
  }

  private safeParseJson(text: string): any | null {
    try {
      return JSON.parse(text);
    } catch {
      // Strip markdown fences and try again.
      const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try {
        return JSON.parse(stripped);
      } catch {
        return null;
      }
    }
  }

  // Last-ditch deterministic draft. Picks a category by keyword and a priority
  // by urgency cues — good enough for dev when no API key is set.
  private heuristicDraft(message: string, categoryNames: string[]): DraftResult {
    const lower = message.toLowerCase();
    const URGENT_WORDS = ['flood', 'fire', 'no water', 'no power', 'gas leak', 'electric shock', 'urgent', 'emergency'];
    const HIGH_WORDS = ['leak', 'broken', 'not working', 'blocked', 'overflow', 'sparking'];
    const priority: DraftResult['priority'] = URGENT_WORDS.some((w) => lower.includes(w))
      ? 'URGENT'
      : HIGH_WORDS.some((w) => lower.includes(w))
        ? 'HIGH'
        : 'NORMAL';

    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      Plumbing: ['water', 'leak', 'tap', 'pipe', 'sink', 'toilet', 'drain', 'shower'],
      Electrical: ['power', 'light', 'bulb', 'socket', 'outlet', 'wire', 'fuse', 'breaker'],
      Carpentry: ['door', 'window', 'cabinet', 'shelf', 'wood', 'lock'],
      'Security Light': ['security light', 'street light', 'compound light'],
      Cleaning: ['clean', 'dirty', 'rubbish', 'trash', 'litter'],
    };
    let category: string | null = null;
    for (const [name, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      if (kws.some((kw) => lower.includes(kw))) {
        category = categoryNames.find((c) => c.toLowerCase() === name.toLowerCase()) || name;
        break;
      }
    }
    if (!category) {
      category = categoryNames.find((c) => c.toLowerCase() === 'other') || categoryNames[0] || null;
    }

    const title = message.length > 80 ? `${message.slice(0, 77)}...` : message;
    const followUps: string[] = [];
    if (!/(\d|today|yesterday)/.test(lower)) followUps.push('When did you first notice this?');
    if (!/(bathroom|kitchen|bedroom|living|balcony|hallway)/.test(lower)) followUps.push('Which room or area?');
    if (priority === 'NORMAL' && message.length < 30) followUps.push('Is it getting worse, or stable for now?');

    return {
      title,
      description: message,
      category,
      priority,
      followUps: followUps.slice(0, 3),
      usedAi: false,
    };
  }
}
