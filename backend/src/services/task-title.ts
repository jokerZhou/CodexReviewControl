import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

interface TaskTitleConfig {
  enabled: boolean;
  provider: 'openai';
  model: string;
  maxLength: number;
  temperature: number;
  systemPrompt: string;
}

const defaultConfig: TaskTitleConfig = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  maxLength: 24,
  temperature: 0.2,
  systemPrompt: '你是任务标题提取器。根据用户的一句话提取一个简短任务标题。只输出标题，不要解释，不要加引号。'
};

let cachedConfig: TaskTitleConfig | undefined;

const loadConfig = async () => {
  if (cachedConfig) return cachedConfig;

  try {
    const configPath = path.resolve(process.cwd(), 'config/task-title.json');
    const raw = await fs.readFile(configPath, 'utf8');
    cachedConfig = { ...defaultConfig, ...JSON.parse(raw) } as TaskTitleConfig;
  } catch {
    cachedConfig = defaultConfig;
  }

  return cachedConfig;
};

const fallbackTitle = (prompt: string, maxLength: number) => {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized || '新任务';
  return normalized.slice(0, maxLength);
};

const cleanTitle = (title: string, maxLength: number) => {
  const cleaned = title.replace(/^["'“”‘’]+|["'“”‘’。.!！?？]+$/g, '').trim();
  return fallbackTitle(cleaned, maxLength);
};

export const extractTaskTitle = async (prompt: string) => {
  const config = await loadConfig();
  if (!config.enabled) return fallbackTitle(prompt, config.maxLength);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackTitle(prompt, config.maxLength);

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined
  });

  try {
    const response = await client.responses.create({
      model: config.model,
      temperature: config.temperature,
      input: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: prompt }
      ]
    });

    return cleanTitle(response.output_text, config.maxLength);
  } catch {
    return fallbackTitle(prompt, config.maxLength);
  }
};
