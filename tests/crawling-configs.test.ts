import { describe, it, expect } from 'vitest';
import { API } from '../src/config/constants';
import DEFAULT_CRAWLING_RULES from '../src/config/default_rules.json';

describe('Crawling Configs', () => {
    describe('default_rules.json structure', () => {
        it('should be an array', () => {
            expect(Array.isArray(DEFAULT_CRAWLING_RULES)).toBe(true);
        });

        it('should have at least one config', () => {
            expect(DEFAULT_CRAWLING_RULES.length).toBeGreaterThan(0);
        });

        it('each config should have required fields', () => {
            for (const config of DEFAULT_CRAWLING_RULES) {
                expect(config).toHaveProperty('id');
                expect(config).toHaveProperty('domain');
                expect(config).toHaveProperty('container');
                expect(config).toHaveProperty('item');
                expect(config).toHaveProperty('fields');
                expect(config).toHaveProperty('lastUpdated');
                expect(typeof config.id).toBe('string');
                expect(typeof config.domain).toBe('string');
                expect(typeof config.lastUpdated).toBe('number');
            }
        });

        it('each config container should have selector and type', () => {
            for (const config of DEFAULT_CRAWLING_RULES) {
                expect(config.container).toHaveProperty('selector');
                expect(config.container).toHaveProperty('type');
                expect(typeof config.container.selector).toBe('string');
                expect(['css', 'xpath']).toContain(config.container.type);
            }
        });

        it('each config item should have selector and type', () => {
            for (const config of DEFAULT_CRAWLING_RULES) {
                expect(config.item).toHaveProperty('selector');
                expect(config.item).toHaveProperty('type');
                expect(typeof config.item.selector).toBe('string');
                expect(['css', 'xpath']).toContain(config.item.type);
            }
        });

        it('each config should have required fields: username, content, timestamp, likes', () => {
            const requiredFieldNames = ['username', 'content', 'timestamp', 'likes'];
            for (const config of DEFAULT_CRAWLING_RULES) {
                expect(Array.isArray(config.fields)).toBe(true);
                const fieldNames = config.fields.map((f) => f.name);
                for (const name of requiredFieldNames) {
                    expect(fieldNames).toContain(name);
                }
            }
        });

        it('each field should have name and rule with selector and type', () => {
            for (const config of DEFAULT_CRAWLING_RULES) {
                for (const field of config.fields) {
                    expect(field).toHaveProperty('name');
                    expect(field).toHaveProperty('rule');
                    expect(field.rule).toHaveProperty('selector');
                    expect(field.rule).toHaveProperty('type');
                    expect(typeof field.name).toBe('string');
                    expect(typeof field.rule.selector).toBe('string');
                    expect(['css', 'xpath']).toContain(field.rule.type);
                }
            }
        });
    });

    describe('API constants', () => {
        it('should have CRAWLING_CONFIGS_RAW_URL defined', () => {
            expect(API.CRAWLING_CONFIGS_RAW_URL).toBeDefined();
            expect(typeof API.CRAWLING_CONFIGS_RAW_URL).toBe('string');
        });

        it('CRAWLING_CONFIGS_RAW_URL should point to raw.githubusercontent.com', () => {
            expect(API.CRAWLING_CONFIGS_RAW_URL).toContain('raw.githubusercontent.com');
            expect(API.CRAWLING_CONFIGS_RAW_URL).toContain('default_rules.json');
        });

        it('should have CRAWLING_CONFIGS_URL defined', () => {
            expect(API.CRAWLING_CONFIGS_URL).toBeDefined();
            expect(typeof API.CRAWLING_CONFIGS_URL).toBe('string');
        });

        it('CRAWLING_CONFIGS_URL should point to github.com', () => {
            expect(API.CRAWLING_CONFIGS_URL).toContain('github.com');
            expect(API.CRAWLING_CONFIGS_URL).toContain('default_rules.json');
        });
    });

    describe('Platform coverage', () => {
        const expectedPlatforms = ['youtube.com', 'bilibili.com', 'reddit.com', 'x.com', 'tiktok.com'];

        it('should have configs for all expected platforms', () => {
            const domains = DEFAULT_CRAWLING_RULES.map((c) => c.domain);
            for (const platform of expectedPlatforms) {
                expect(domains).toContain(platform);
            }
        });
    });
});
