"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVideoGenerationResponse = exports.isImageGenerationResponse = exports.isLLMResponse = void 0;
var llm_interfaces_1 = require("./fine-control/services/llm-interfaces");
Object.defineProperty(exports, "isLLMResponse", { enumerable: true, get: function () { return llm_interfaces_1.isLLMResponse; } });
Object.defineProperty(exports, "isImageGenerationResponse", { enumerable: true, get: function () { return llm_interfaces_1.isImageGenerationResponse; } });
Object.defineProperty(exports, "isVideoGenerationResponse", { enumerable: true, get: function () { return llm_interfaces_1.isVideoGenerationResponse; } });
