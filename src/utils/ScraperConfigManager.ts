import { ScraperConfig, ScraperConfigList } from '../types/scraper';

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
        console.log('[ScraperConfigManager] Initialized with default configs:', defaultConfigs.length);
      }
    } catch (error) {
      console.error('[ScraperConfigManager] Failed to initialize defaults:', error);
    }
  }

  /**
   * Load default configurations from bundled file
   */
  private static async loadDefaultConfigs(): Promise<ScraperConfig[]> {
    try {
      console.log('[ScraperConfigManager] Loading default configs...');
      const configUrl = chrome.runtime.getURL('src/config/default-scrapers.json');
      console.log('[ScraperConfigManager] Config URL:', configUrl);
      
      const response = await fetch(configUrl);
      console.log('[ScraperConfigManager] Fetch response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
      }
      
      const data: ScraperConfigList = await response.json();
      console.log('[ScraperConfigManager] Loaded configs:', data.configs?.length || 0);
      return data.configs || [];
    } catch (error) {
      console.error('[ScraperConfigManager] Failed to load default configs:', error);
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
      const data: ScraperConfigList = result[STORAGE_KEY] || { configs: [], version: CONFIG_VERSION };
      return data.configs;
    } catch (error) {
      console.error('[ScraperConfigManager] Failed to get configs:', error);
      return [];
    }
  }

  /**
   * Get a specific configuration by ID
   */
  static async getById(id: string): Promise<ScraperConfig | null> {
    const configs = await this.getAll();
    return configs.find(c => c.id === id) || null;
  }

  /**
   * Find matching configuration for current URL
   */
  static async findMatchingConfig(url: string): Promise<ScraperConfig | null> {
    try {
      console.log('[ScraperConfigManager] findMatchingConfig called with URL:', url);
      const configs = await this.getAll();
      console.log('[ScraperConfigManager] Finding config for URL:', url);
      console.log('[ScraperConfigManager] Available configs:', configs.length);
      
      if (configs.length === 0) {
        console.warn('[ScraperConfigManager] No configs available!');
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
        const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i);
        hostname = match ? match[1] : '';
      }
      
      if (!hostname) {
        console.warn('[ScraperConfigManager] Could not extract hostname from URL:', url);
        return null;
      }
      
      console.log('[ScraperConfigManager] Extracted hostname:', hostname);
      
      for (const config of configs) {
        console.log('[ScraperConfigManager] Checking config:', config.name, 'domains:', config.domains);
        
        // Check domain match
        const domainMatch = config.domains.some(domain => {
          const matches = hostname === domain || 
                         hostname.endsWith('.' + domain) || 
                         domain.endsWith('.' + hostname);
          console.log('[ScraperConfigManager] Domain check:', domain, 'vs', hostname, '=', matches);
          return matches;
        });
        
        if (!domainMatch) {
          console.log('[ScraperConfigManager] Domain not matched for config:', config.name);
          continue;
        }
        
        console.log('[ScraperConfigManager] Domain matched for config:', config.name);
        
        // Check URL pattern match
        // Filter out empty patterns
        const validPatterns = config.urlPatterns.filter(p => p && p.trim() !== '');
        
        if (validPatterns.length === 0) {
          console.log('[ScraperConfigManager] No URL patterns, returning config:', config.name);
          return config; // No pattern means match all URLs for this domain
        }
        
        console.log('[ScraperConfigManager] Testing URL patterns:', validPatterns);
        
        const patternMatch = validPatterns.some(pattern => {
          try {
            const regex = new RegExp(pattern);
            const matches = regex.test(url);
            console.log('[ScraperConfigManager] Pattern check:', pattern, 'vs', url, '=', matches);
            return matches;
          } catch (error) {
            console.error('[ScraperConfigManager] Invalid regex pattern:', pattern, error);
            return false;
          }
        });
        
        if (patternMatch) {
          console.log('[ScraperConfigManager] Pattern matched, returning config:', config.name);
          return config;
        } else {
          console.log('[ScraperConfigManager] Pattern not matched for config:', config.name);
          console.log('[ScraperConfigManager] Tried patterns:', validPatterns, 'against URL:', url);
        }
      }
      
      console.log('[ScraperConfigManager] No matching config found');
      return null;
    } catch (error) {
      console.error('[ScraperConfigManager] Error in findMatchingConfig:', error);
      return null;
    }
  }

  /**
   * Save a new configuration
   */
  static async create(config: Omit<ScraperConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScraperConfig> {
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
  static async update(id: string, updates: Partial<Omit<ScraperConfig, 'id' | 'createdAt'>>): Promise<ScraperConfig | null> {
    const configs = await this.getAll();
    const index = configs.findIndex(c => c.id === id);
    
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
    const filtered = configs.filter(c => c.id !== id);
    
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
      const idConflict = existing.find(e => e.id === imported.id);
      if (idConflict) {
        conflicts.push({
          imported,
          existing: idConflict,
          reason: 'duplicate_id',
        });
        continue;
      }

      // Check for domain conflict
      const domainConflict = existing.find(e =>
        e.domains.some(d => imported.domains.includes(d))
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
    conflictResolution: 'skip' | 'overwrite' | 'ask' = 'ask'
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
          const index = existing.findIndex(e => e.id === conflict.existing.id);
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
      toImport = toImport.map(c => ({
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
      console.error('[ScraperConfigManager] Failed to import configs:', error);
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
    decisions: Array<'skip' | 'overwrite'>
  ): Promise<number> {
    const existing = await this.getAll();
    let importedCount = 0;

    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      const decision = decisions[i];

      if (decision === 'overwrite') {
        // Remove existing config
        const index = existing.findIndex(e => e.id === conflict.existing.id);
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
    status: 'success' | 'failed'
  ): Promise<void> {
    const config = await this.getById(id);
    if (!config) {
      console.warn('[ScraperConfigManager] Config not found for validation update:', id);
      return;
    }

    const selectorValidation = config.selectorValidation || {};
    selectorValidation[selectorKey] = status;

    await this.update(id, { selectorValidation });
    console.log('[ScraperConfigManager] Updated selector validation:', id, selectorKey, status);
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
      const required = ['commentContainer', 'commentItem', 'username', 'content', 'timestamp', 'likes'];
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
