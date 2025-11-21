import { ScraperConfig, ScraperConfigList } from '../types/scraper';
import { PATHS, REGEX } from '@/config/constants';

const STORAGE_KEY = 'scraperConfigs';
const CONFIG_VERSION = '1.0.0';
const INITIALIZED_KEY = 'scraperConfigsInitialized';

/**
 * ScraperConfigManager handles CRUD operations for scraper configurations
 */
export class ScraperConfigManager {
  /**
   * Initialize default configurations on first run
   */
  private static async initializeDefaults(): Promise<void> {
    try {
      // Check if already initialized
      const result = await chrome.storage.local.get(INITIALIZED_KEY);
      if (result[INITIALIZED_KEY]) {
        return;
      }

      // Load default configurations
      const defaultConfigs = await this.loadDefaultConfigs();
      if (defaultConfigs.length > 0) {
        await this.saveAll(defaultConfigs);
        await chrome.storage.local.set({ [INITIALIZED_KEY]: true });
        Logger.info('[ScraperConfigManager] Initialized with default configs', { count: defaultConfigs.length });
      }
    } catch (error) {
      Logger.error('[ScraperConfigManager] Failed to initialize defaults', { error });
    }
  }

  /**
   * Load default configurations from bundled file
   */
  private static async loadDefaultConfigs(): Promise<ScraperConfig[]> {
    try {
      Logger.debug('[ScraperConfigManager] Loading default configs');
      const configUrl = chrome.runtime.getURL(PATHS.DEFAULT_SCRAPERS_JSON);
      Logger.debug('[ScraperConfigManager] Config URL', { configUrl });

      const response = await fetch(configUrl);
      Logger.debug('[ScraperConfigManager] Fetch response status', { status: response.status });

      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
      }

      const data: ScraperConfigList = await response.json();
      Logger.debug('[ScraperConfigManager] Loaded configs', { count: data.configs?.length || 0 });
      return data.configs || [];
    } catch (error) {
      Logger.error('[ScraperConfigManager] Failed to load default configs', { error });
      return [];
    }
  }

  /**
   * Get all scraper configurations
   */
  static async getAll(): Promise<ScraperConfig[]> {
    try {
      // Initialize defaults on first access
      await this.initializeDefaults();

      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data: ScraperConfigList = result[STORAGE_KEY] || {
        configs: [],
        version: CONFIG_VERSION,
      };
      return data.configs;
    } catch (error) {
      Logger.error('[ScraperConfigManager] Failed to get configs', { error });
      return [];
    }
  }

  /**
   * Get a specific configuration by ID
   */
  static async getById(id: string): Promise<ScraperConfig | null> {
    const configs = await this.getAll();
    return configs.find((c) => c.id === id) || null;
  }

  /**
   * Find matching configuration for current URL
   */
  static async findMatchingConfig(url: string): Promise<ScraperConfig | null> {
    try {
      Logger.debug('[ScraperConfigManager] findMatchingConfig called', { url });
      const configs = await this.getAll();
      Logger.debug('[ScraperConfigManager] Finding config for URL', { url });
      Logger.debug('[ScraperConfigManager] Available configs', { count: configs.length });

      if (configs.length === 0) {
        Logger.warn('[ScraperConfigManager] No configs available');
        return null;
      }

      // Parse hostname from URL safely
      let hostname: string;
      try {
        // Try using URL constructor (works in most contexts)
        const urlObj = new URL(url);
        hostname = urlObj.hostname;
      } catch (e) {
        // Fallback: extract hostname manually
        const match = url.match(REGEX.DOMAIN_EXTRACT);
        hostname = match ? match[1] : '';
      }

      if (!hostname) {
        Logger.warn('[ScraperConfigManager] Could not extract hostname from URL', { url });
        return null;
      }

      Logger.debug('[ScraperConfigManager] Extracted hostname', { hostname });

      for (const config of configs) {
        Logger.debug('[ScraperConfigManager] Checking config', { name: config.name, domains: config.domains });

        // Check domain match
        const domainMatch = config.domains.some((domain) => {
          const matches =
            hostname === domain ||
            hostname.endsWith('.' + domain) ||
            domain.endsWith('.' + hostname);
          Logger.debug('[ScraperConfigManager] Domain check', { domain, hostname, matches });
          return matches;
        });

        if (!domainMatch) {
          Logger.debug('[ScraperConfigManager] Domain not matched for config', { name: config.name });
          continue;
        }

        Logger.debug('[ScraperConfigManager] Domain matched for config', { name: config.name });

        // Check URL pattern match
        // Filter out empty patterns
        const validPatterns = config.urlPatterns.filter((p) => p && p.trim() !== '');

        if (validPatterns.length === 0) {
          Logger.debug('[ScraperConfigManager] No URL patterns, returning config', { name: config.name });
          return config; // No pattern means match all URLs for this domain
        }

        Logger.debug('[ScraperConfigManager] Testing URL patterns', { validPatterns });

        const patternMatch = validPatterns.some((pattern) => {
          try {
            const regex = new RegExp(pattern);
            const matches = regex.test(url);
            Logger.debug('[ScraperConfigManager] Pattern check', { pattern, url, matches });
            return matches;
          } catch (error) {
            Logger.error('[ScraperConfigManager] Invalid regex pattern', { pattern, error });
            return false;
          }
        });

        if (patternMatch) {
          Logger.debug('[ScraperConfigManager] Pattern matched, returning config', { name: config.name });
          return config;
        } else {
          Logger.debug('[ScraperConfigManager] Pattern not matched for config', { name: config.name });
          Logger.debug('[ScraperConfigManager] Tried patterns against URL', { validPatterns, url });
        }
      }

      Logger.info('[ScraperConfigManager] No matching config found');
      return null;
    } catch (error) {
      Logger.error('[ScraperConfigManager] Error in findMatchingConfig', { error });
      return null;
    }
  }

  /**
   * Save a new configuration
   */
  static async create(
    config: Omit<ScraperConfig, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ScraperConfig> {
    const configs = await this.getAll();

    const newConfig: ScraperConfig = {
      ...config,
      id: this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    configs.push(newConfig);
    await this.saveAll(configs);

    return newConfig;
  }

  /**
   * Update an existing configuration
   */
  static async update(
    id: string,
    updates: Partial<Omit<ScraperConfig, 'id' | 'createdAt'>>,
  ): Promise<ScraperConfig | null> {
    const configs = await this.getAll();
    const index = configs.findIndex((c) => c.id === id);

    if (index === -1) {
      return null;
    }

    configs[index] = {
      ...configs[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveAll(configs);
    return configs[index];
  }

  /**
   * Delete a configuration
   */
  static async delete(id: string): Promise<boolean> {
    const configs = await this.getAll();
    const filtered = configs.filter((c) => c.id !== id);

    if (filtered.length === configs.length) {
      return false; // Config not found
    }

    await this.saveAll(filtered);
    return true;
  }

  /**
   * Save all configurations
   */
  private static async saveAll(configs: ScraperConfig[]): Promise<void> {
    const data: ScraperConfigList = {
      configs,
      version: CONFIG_VERSION,
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  /**
   * Export configurations as JSON string
   */
  static async exportConfigs(): Promise<string> {
    const configs = await this.getAll();
    const data: ScraperConfigList = {
      configs,
      version: CONFIG_VERSION,
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Check for conflicts when importing configurations
   */
  static async checkImportConflicts(importedConfigs: ScraperConfig[]): Promise<{
    conflicts: Array<{
      imported: ScraperConfig;
      existing: ScraperConfig;
      reason: string;
    }>;
    newConfigs: ScraperConfig[];
  }> {
    const existing = await this.getAll();
    const conflicts: Array<{
      imported: ScraperConfig;
      existing: ScraperConfig;
      reason: string;
    }> = [];
    const newConfigs: ScraperConfig[] = [];

    for (const imported of importedConfigs) {
      // Check for ID conflict
      const idConflict = existing.find((e) => e.id === imported.id);
      if (idConflict) {
        conflicts.push({
          imported,
          existing: idConflict,
          reason: 'duplicate_id',
        });
        continue;
      }

      // Check for domain conflict
      const domainConflict = existing.find((e) =>
        e.domains.some((d) => imported.domains.includes(d)),
      );
      if (domainConflict) {
        conflicts.push({
          imported,
          existing: domainConflict,
          reason: 'duplicate_domain',
        });
        continue;
      }

      newConfigs.push(imported);
    }

    return { conflicts, newConfigs };
  }

  /**
   * Import configurations from JSON string
   * @param jsonString - JSON string containing configurations
   * @param conflictResolution - How to handle conflicts: 'skip', 'overwrite', or 'ask'
   * @returns Object with imported count and conflicts
   */
  static async importConfigs(
    jsonString: string,
    conflictResolution: 'skip' | 'overwrite' | 'ask' = 'ask',
  ): Promise<{
    imported: number;
    skipped: number;
    overwritten: number;
    conflicts?: Array<{
      imported: ScraperConfig;
      existing: ScraperConfig;
      reason: string;
    }>;
  }> {
    try {
      const data: ScraperConfigList = JSON.parse(jsonString);

      if (!data.configs || !Array.isArray(data.configs)) {
        throw new Error('Invalid configuration format');
      }

      const existing = await this.getAll();
      const { conflicts, newConfigs } = await this.checkImportConflicts(data.configs);

      // If asking user, return conflicts for UI to handle
      if (conflictResolution === 'ask' && conflicts.length > 0) {
        return {
          imported: 0,
          skipped: 0,
          overwritten: 0,
          conflicts,
        };
      }

      let toImport: ScraperConfig[] = [...newConfigs];
      let overwrittenCount = 0;
      let skippedCount = conflicts.length;

      // Handle conflicts based on resolution strategy
      if (conflictResolution === 'overwrite') {
        for (const conflict of conflicts) {
          // Remove existing config
          const index = existing.findIndex((e) => e.id === conflict.existing.id);
          if (index !== -1) {
            existing.splice(index, 1);
          }
          // Add imported config with new ID
          toImport.push({
            ...conflict.imported,
            id: this.generateId(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          overwrittenCount++;
        }
        skippedCount = 0;
      }
      // If 'skip', conflicts are already excluded

      // Regenerate IDs and timestamps for new configs
      toImport = toImport.map((c) => ({
        ...c,
        id: this.generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      // Save all configs
      const finalConfigs = [...existing, ...toImport];
      await this.saveAll(finalConfigs);

      return {
        imported: toImport.length,
        skipped: skippedCount,
        overwritten: overwrittenCount,
      };
    } catch (error) {
      Logger.error('[ScraperConfigManager] Failed to import configs', { error });
      throw error;
    }
  }

  /**
   * Resolve import conflicts with user decisions
   */
  static async resolveImportConflicts(
    conflicts: Array<{
      imported: ScraperConfig;
      existing: ScraperConfig;
      reason: string;
    }>,
    decisions: Array<'skip' | 'overwrite'>,
  ): Promise<number> {
    const existing = await this.getAll();
    let importedCount = 0;

    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      const decision = decisions[i];

      if (decision === 'overwrite') {
        // Remove existing config
        const index = existing.findIndex((e) => e.id === conflict.existing.id);
        if (index !== -1) {
          existing.splice(index, 1);
        }
        // Add imported config with new ID
        existing.push({
          ...conflict.imported,
          id: this.generateId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        importedCount++;
      }
      // If 'skip', do nothing
    }

    await this.saveAll(existing);
    return importedCount;
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return `scraper_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update selector validation status for a configuration
   */
  static async updateSelectorValidation(
    id: string,
    selectorKey: string,
    status: 'success' | 'failed' | 'untested',
    count?: number,
  ): Promise<void> {
    const config = await this.getById(id);
    if (!config) {
      Logger.warn('[ScraperConfigManager] Config not found for validation update', { id });
      return;
    }

    const selectorValidation = config.selectorValidation || {};
    selectorValidation[selectorKey] = status;

    const updates: any = { selectorValidation };

    if (typeof count === 'number') {
      const selectorCounts = config.selectorCounts || {};
      selectorCounts[selectorKey] = count;
      updates.selectorCounts = selectorCounts;
    }

    await this.update(id, updates);
    Logger.info('[ScraperConfigManager] Updated selector validation', {
      id,
      selectorKey,
      status,
      count,
    });
  }

  /**
   * Validate a configuration
   */
  static validateConfig(config: Partial<ScraperConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.name || config.name.trim() === '') {
      errors.push('Name is required');
    }

    if (!config.domains || config.domains.length === 0) {
      errors.push('At least one domain is required');
    }

    if (!config.selectors) {
      errors.push('Selectors are required');
    } else {
      const required = [
        'commentContainer',
        'commentItem',
        'username',
        'content',
        'timestamp',
        'likes',
      ];
      for (const field of required) {
        if (!config.selectors[field as keyof typeof config.selectors]) {
          errors.push(`Selector '${field}' is required`);
        }
      }
    }

    // Validate URL patterns are valid regex
    if (config.urlPatterns) {
      for (const pattern of config.urlPatterns) {
        try {
          new RegExp(pattern);
        } catch (error) {
          errors.push(`Invalid regex pattern: ${pattern}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
import { Logger } from '@/utils/logger';
