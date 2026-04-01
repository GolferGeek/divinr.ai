"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityPlaneModule = exports.LLMPlaneModule = exports.RbacModule = exports.AuthModule = exports.ConfigProviderModule = exports.DatabaseModule = void 0;
/**
 * Provider Planes — infrastructure abstractions selected by env var at deploy time.
 *
 * Each plane is a @Global() NestJS module providing a Symbol-based injection token.
 * Import from the specific plane directory for full type access,
 * or import the module from here for AppModule registration.
 */
var database_1 = require("./database");
Object.defineProperty(exports, "DatabaseModule", { enumerable: true, get: function () { return database_1.DatabaseModule; } });
var config_1 = require("./config");
Object.defineProperty(exports, "ConfigProviderModule", { enumerable: true, get: function () { return config_1.ConfigProviderModule; } });
var auth_module_1 = require("./auth/auth.module");
Object.defineProperty(exports, "AuthModule", { enumerable: true, get: function () { return auth_module_1.AuthModule; } });
var rbac_1 = require("./rbac");
Object.defineProperty(exports, "RbacModule", { enumerable: true, get: function () { return rbac_1.RbacModule; } });
var llm_1 = require("./llm");
Object.defineProperty(exports, "LLMPlaneModule", { enumerable: true, get: function () { return llm_1.LLMPlaneModule; } });
var observability_1 = require("./observability");
Object.defineProperty(exports, "ObservabilityPlaneModule", { enumerable: true, get: function () { return observability_1.ObservabilityPlaneModule; } });
