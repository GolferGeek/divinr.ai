"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var DictionaryPseudonymizerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DictionaryPseudonymizerService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("../../../database");
/**
 * Dictionary-Based Pseudonymizer Service
 *
 * SECURITY: Implements reversible pseudonymization for PII protection.
 * Simple, fast pseudonymization using a predefined dictionary.
 * No hashing, no complex pattern matching - just direct string replacement.
 *
 * Flow:
 * 1. Load dictionary entries from database
 * 2. Case-insensitive search and replace original_value → pseudonym
 * 3. Track what was replaced for reversal
 * 4. Reverse pseudonym → original_value after LLM response
 *
 * Security considerations:
 * - Dictionary entries are cached for performance (5-minute TTL)
 * - Supports scoped dictionaries (agent > org > global)
 * - Regex special characters are properly escaped
 * - Reversal mappings must be stored securely by caller
 */
let DictionaryPseudonymizerService = DictionaryPseudonymizerService_1 = class DictionaryPseudonymizerService {
    db;
    logger = new common_1.Logger(DictionaryPseudonymizerService_1.name);
    // Cache dictionary entries to avoid repeated DB calls
    dictionaryCache = null;
    cacheExpiry = 0;
    CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    constructor(db) {
        this.db = db;
        this.logger.log('🎯 DictionaryPseudonymizerService initialized - simple dictionary-based pseudonymization');
    }
    /**
     * Load active dictionary entries from database, scoped by organization/agent when provided
     */
    async loadDictionary(options) {
        const now = Date.now();
        // Return cached entries if still valid
        if (this.dictionaryCache && now < this.cacheExpiry) {
            return this.dictionaryCache;
        }
        try {
            const { organizationSlug = null, agentSlug = null } = options || {};
            // Prefer agent-scoped -> org-scoped -> global
            const resultSets = [];
            if (organizationSlug && agentSlug) {
                const { data } = (await this.db
                    .from(null, 'pseudonym_dictionaries')
                    .select('original_value, pseudonym, data_type, category')
                    .eq('is_active', true)
                    .eq('organization_slug', organizationSlug)
                    .eq('agent_slug', agentSlug)
                    .not('original_value', 'is', null)
                    .not('pseudonym', 'is', null));
                if (data)
                    resultSets.push(data);
            }
            if (organizationSlug) {
                const { data } = (await this.db
                    .from(null, 'pseudonym_dictionaries')
                    .select('original_value, pseudonym, data_type, category')
                    .eq('is_active', true)
                    .eq('organization_slug', organizationSlug)
                    .is('agent_slug', null)
                    .not('original_value', 'is', null)
                    .not('pseudonym', 'is', null));
                if (data)
                    resultSets.push(data);
            }
            const { data: globalData, error } = (await this.db
                .from(null, 'pseudonym_dictionaries')
                .select('original_value, pseudonym, data_type, category')
                .eq('is_active', true)
                .is('organization_slug', null)
                .is('agent_slug', null)
                .not('original_value', 'is', null)
                .not('pseudonym', 'is', null));
            if (error) {
                this.logger.error('Failed to load pseudonym dictionary:', error);
                throw new Error('Failed to load pseudonym dictionary');
            }
            if (globalData)
                resultSets.push(globalData);
            // Merge with priority: agent > org > global, detect overrides/conflicts
            const merged = [].concat(...resultSets);
            const byOriginal = {};
            for (const row of merged) {
                const r = row;
                const src = r.agent_slug
                    ? 'agent'
                    : r.organization_slug
                        ? 'org'
                        : 'global';
                const key = `${String(r.original_value || '').toLowerCase()}::${String(r.data_type) || 'unknown'}`;
                if (!key.trim())
                    continue;
                const existing = byOriginal[key];
                if (!existing) {
                    byOriginal[key] = {
                        pseudonym: r.pseudonym,
                        src,
                        row: row,
                    };
                    continue;
                }
                // Only override when new source has higher priority
                const rank = (s) => s === 'agent' ? 3 : s === 'org' ? 2 : 1;
                if (rank(src) > rank(existing.src)) {
                    if (existing.pseudonym !== r.pseudonym) {
                        this.logger.warn(`📚 [PSEUDONYM-DICT] Override: ${key} (${existing.src} -> ${src}) '${existing.pseudonym}' -> '${String(r.pseudonym)}'`);
                    }
                    byOriginal[key] = {
                        pseudonym: r.pseudonym,
                        src,
                        row: row,
                    };
                }
            }
            const unique = Object.values(byOriginal).map((e) => e.row);
            const dictionary = (unique || []).map((row) => {
                const r = row;
                return {
                    originalValue: r.original_value,
                    pseudonym: r.pseudonym,
                    dataType: r.data_type,
                    category: r.category,
                };
            });
            // Cache the results
            this.dictionaryCache = dictionary;
            this.cacheExpiry = now + this.CACHE_TTL_MS;
            this.logger.log(`📚 Loaded ${dictionary.length} dictionary entries`);
            return dictionary;
        }
        catch (error) {
            this.logger.error('Failed to load dictionary:', error);
            throw error;
        }
    }
    /**
     * Pseudonymize text using dictionary entries
     */
    async pseudonymizeText(text, options) {
        const startTime = Date.now();
        let processedText = text;
        const mappings = [];
        try {
            // Load dictionary entries
            const dictionary = await this.loadDictionary(options);
            // Process each dictionary entry
            for (const entry of dictionary) {
                // Case-insensitive search for the original value
                const regex = new RegExp(this.escapeRegex(entry.originalValue), 'gi');
                const matches = processedText.match(regex);
                if (matches && matches.length > 0) {
                    // Replace all occurrences with the pseudonym
                    processedText = processedText.replace(regex, entry.pseudonym);
                    // Track this mapping for reversal
                    mappings.push(entry);
                    this.logger.log(`🎯 Replaced ${matches.length} occurrence(s) of ${entry.dataType}`);
                }
            }
            const processingTimeMs = Date.now() - startTime;
            return {
                originalText: text,
                pseudonymizedText: processedText,
                mappings,
                processingTimeMs,
            };
        }
        catch (error) {
            this.logger.error('Pseudonymization failed:', error);
            throw error;
        }
    }
    /**
     * Reverse pseudonyms back to original values
     */
    reversePseudonyms(text, mappings) {
        const startTime = Date.now();
        let processedText = text;
        let reversalCount = 0;
        try {
            // Process each mapping in reverse
            for (const mapping of mappings) {
                // Case-insensitive search for the pseudonym
                const regex = new RegExp(this.escapeRegex(mapping.pseudonym), 'gi');
                const matches = processedText.match(regex);
                if (matches && matches.length > 0) {
                    // Replace all occurrences with the original value
                    processedText = processedText.replace(regex, mapping.originalValue);
                    reversalCount += matches.length;
                    this.logger.log(`🔄 Reversed ${matches.length} occurrence(s) of ${mapping.dataType}`);
                }
            }
            const processingTimeMs = Date.now() - startTime;
            return Promise.resolve({
                originalText: processedText,
                reversalCount,
                processingTimeMs,
            });
        }
        catch (error) {
            this.logger.error('Reversal failed:', error);
            throw error;
        }
    }
    /**
     * Escape special regex characters in a string
     * SECURITY: Prevents regex injection by escaping all special characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Clear the dictionary cache (useful for testing or when dictionary is updated)
     */
    clearCache() {
        this.dictionaryCache = null;
        this.cacheExpiry = 0;
        this.logger.log('🗑️ Dictionary cache cleared');
    }
    /**
     * Get current dictionary entries (for debugging/testing)
     */
    async getDictionary() {
        return this.loadDictionary();
    }
};
exports.DictionaryPseudonymizerService = DictionaryPseudonymizerService;
exports.DictionaryPseudonymizerService = DictionaryPseudonymizerService = DictionaryPseudonymizerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object])
], DictionaryPseudonymizerService);
