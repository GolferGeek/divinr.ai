"use strict";
/**
 * LLM Client Interface
 *
 * Common interface for all two-tier LLM backend clients.
 * Each adapter wraps a specific backend (OpenRouter, Ollama Cloud, local Ollama, etc.)
 * and implements this interface for uniform access from TwoTierLLMService.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENSOURCE_CLIENT = exports.COMMERCIAL_CLIENT = void 0;
exports.COMMERCIAL_CLIENT = Symbol('COMMERCIAL_CLIENT');
exports.OPENSOURCE_CLIENT = Symbol('OPENSOURCE_CLIENT');
