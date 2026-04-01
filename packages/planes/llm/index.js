"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMPlaneModule = exports.LLM_SERVICE = void 0;
/**
 * LLM Plane — public API
 *
 * Usage:
 *   import { LLM_SERVICE, LLMServiceProvider } from '@orchestratorai/planes/llm';
 *
 *   @Inject(LLM_SERVICE) private readonly llm: LLMServiceProvider
 */
var llm_interface_1 = require("./llm.interface");
Object.defineProperty(exports, "LLM_SERVICE", { enumerable: true, get: function () { return llm_interface_1.LLM_SERVICE; } });
var llm_module_1 = require("./llm.module");
Object.defineProperty(exports, "LLMPlaneModule", { enumerable: true, get: function () { return llm_module_1.LLMPlaneModule; } });
