"use strict";
/**
 * LLM Service Interfaces
 *
 * This file contains all standardized interfaces for LLM service implementations.
 * These interfaces ensure consistent behavior and metadata handling across all
 * provider-specific services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVideoGenerationResponse = exports.isImageGenerationResponse = exports.isLLMResponse = void 0;
const isLLMResponse = (value) => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.content === 'string' &&
        typeof candidate.metadata === 'object' &&
        candidate.metadata !== null);
};
exports.isLLMResponse = isLLMResponse;
/**
 * Type guard for ImageGenerationResponse
 */
const isImageGenerationResponse = (value) => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return (Array.isArray(candidate.images) &&
        typeof candidate.metadata === 'object' &&
        candidate.metadata !== null);
};
exports.isImageGenerationResponse = isImageGenerationResponse;
/**
 * Type guard for VideoGenerationResponse
 */
const isVideoGenerationResponse = (value) => {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.status === 'string' &&
        ['pending', 'processing', 'completed', 'failed'].includes(candidate.status) &&
        typeof candidate.metadata === 'object' &&
        candidate.metadata !== null);
};
exports.isVideoGenerationResponse = isVideoGenerationResponse;
