"use strict";
/**
 * Observability Plane Interface
 *
 * Defines the public contract for the observability provider plane.
 * Selected by OBSERVABILITY_PROVIDER env var at deploy time:
 *   - supabase (default): Supabase-backed event persistence + in-memory buffer
 *   - console: Console-only logging (development/testing)
 *
 * Consumers inject OBSERVABILITY_SERVICE and get the active implementation.
 *
 * Every method accepts ExecutionContext v2 for full attribution:
 * org, user, conversation, agent, provider, model.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBSERVABILITY_SERVICE = void 0;
exports.OBSERVABILITY_SERVICE = Symbol('OBSERVABILITY_SERVICE');
