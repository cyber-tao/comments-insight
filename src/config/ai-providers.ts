import type { AIProtocol } from '@/types';

interface AIProviderPreset {
  id: string;
  name: string;
  apiUrl: string;
  protocol: AIProtocol;
}

export const AI_PROVIDER_PRESETS: readonly AIProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiUrl: 'https://api.openai.com/v1',
    protocol: 'openai-responses',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic-messages',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'openai-chat-completions',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com',
    protocol: 'openai-chat-completions',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai-chat-completions',
  },
];
