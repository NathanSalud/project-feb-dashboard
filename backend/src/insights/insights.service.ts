import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class InsightsService {
  private client: Anthropic;

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async generateInsights(payload: any): Promise<string> {
    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a senior business analyst for Great Deals E-Commerce Corp (GDEC), a Philippine e-commerce enabler managing brand stores on Shopee, Lazada, and TikTok Shop.

Analyze this dashboard data and provide 5-6 concise, actionable business insights in plain English. Focus on what the numbers mean for the business, not just what they are. Flag risks, opportunities, and recommended next actions. Be direct and executive-ready.

Dashboard data:
${JSON.stringify(payload, null, 2)}

Format your response as a numbered list. Each insight should be 2-3 sentences maximum.`
      }]
    });

    const block = message.content[0];
    return block.type === 'text' ? block.text : 'Unable to generate insights.';
  }
}