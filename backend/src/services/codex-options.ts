import type { ModelReasoningEffort } from '@openai/codex-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodexOption {
  id: string;
  label: string;
}

export interface CodexOptionsConfig {
  models: CodexOption[];
  reasoningEfforts: Array<{ id: ModelReasoningEffort; label: string }>;
  defaults: {
    model: string;
    reasoningEffort: ModelReasoningEffort;
  };
}

const defaultConfig: CodexOptionsConfig = {
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' }
  ],
  reasoningEfforts: [
    { id: 'minimal', label: 'Minimal' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'XHigh' }
  ],
  defaults: {
    model: 'gpt-5.5',
    reasoningEffort: 'medium'
  }
};

let cachedConfig: CodexOptionsConfig | undefined;

const normalizeConfig = (raw: Partial<CodexOptionsConfig>) => {
  const models = Array.isArray(raw.models) && raw.models.length > 0 ? raw.models : defaultConfig.models;
  const reasoningEfforts = Array.isArray(raw.reasoningEfforts) && raw.reasoningEfforts.length > 0
    ? raw.reasoningEfforts
    : defaultConfig.reasoningEfforts;

  const defaultModel = raw.defaults?.model && models.some(option => option.id === raw.defaults?.model)
    ? raw.defaults.model
    : models[0].id;
  const defaultReasoningEffort = raw.defaults?.reasoningEffort && reasoningEfforts.some(option => option.id === raw.defaults?.reasoningEffort)
    ? raw.defaults.reasoningEffort
    : 'medium';

  return {
    models,
    reasoningEfforts,
    defaults: {
      model: defaultModel,
      reasoningEffort: defaultReasoningEffort
    }
  } satisfies CodexOptionsConfig;
};

export const loadCodexOptions = async () => {
  if (cachedConfig) return cachedConfig;

  try {
    const configPath = path.resolve(process.cwd(), 'config/codex-options.json');
    const raw = await fs.readFile(configPath, 'utf8');
    cachedConfig = normalizeConfig(JSON.parse(raw) as Partial<CodexOptionsConfig>);
  } catch {
    cachedConfig = defaultConfig;
  }

  return cachedConfig;
};

export const resolveCodexRunOptions = async (model?: string, reasoningEffort?: string) => {
  const config = await loadCodexOptions();
  const resolvedModel = model && config.models.some(option => option.id === model)
    ? model
    : config.defaults.model;
  const resolvedReasoningEffort = reasoningEffort && config.reasoningEfforts.some(option => option.id === reasoningEffort)
    ? reasoningEffort as ModelReasoningEffort
    : config.defaults.reasoningEffort;

  return {
    model: resolvedModel,
    modelReasoningEffort: resolvedReasoningEffort
  };
};
