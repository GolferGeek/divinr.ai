"use strict";
/**
 * DatabaseService — re-exported from transport-types for backward compatibility.
 *
 * The canonical definition lives in @orchestrator-ai/transport-types/database.
 * All apps should import from transport-types; this file re-exports so that
 * existing API imports (`from './database/database.interface'`) continue to work.
 *
 * Products that need LangGraph checkpoint support (Forge) should import
 * LangGraphDatabaseService from './database.langgraph' instead.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATABASE_SERVICE = void 0;
var transport_types_1 = require("@orchestrator-ai/transport-types");
Object.defineProperty(exports, "DATABASE_SERVICE", { enumerable: true, get: function () { return transport_types_1.DATABASE_SERVICE; } });
