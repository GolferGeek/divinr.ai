"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NullAdapter = void 0;
class NullAdapter {
    tier;
    constructor(tier) {
        this.tier = tier;
    }
    async listModels() {
        return [];
    }
    async chatCompletion(_params) {
        throw new Error(`LLM ${this.tier} tier is disabled (set to 'none'). ` +
            `Configure ${this.tier === 'commercial' ? 'COMMERCIAL_LLM_PROVIDER' : 'OPENSOURCE_LLM_PROVIDER'} ` +
            `to enable this tier.`);
    }
}
exports.NullAdapter = NullAdapter;
