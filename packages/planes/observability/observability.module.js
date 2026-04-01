"use strict";
/**
 * Observability Plane Module
 *
 * @Global() module providing OBSERVABILITY_SERVICE plus the full
 * observability implementation: events buffer, webhook forwarding,
 * SSE streaming, and legacy DB services.
 *
 * Selected by OBSERVABILITY_PROVIDER env var:
 *   - supabase (default): Supabase-backed persistence + in-memory buffer
 *   - console: Console-only logging for development/testing
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityPlaneModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("@nestjs/axios");
const observability_interface_1 = require("./observability.interface");
const supabase_observability_service_1 = require("./providers/supabase-observability.service");
const console_observability_service_1 = require("./providers/console-observability.service");
const observability_events_service_1 = require("./services/observability-events.service");
const observability_webhook_service_1 = require("./services/observability-webhook.service");
const observability_stream_controller_1 = require("./services/observability-stream.controller");
const observability_db_service_1 = require("./services/observability-db.service");
const logger = new common_1.Logger('ObservabilityPlaneModule');
let ObservabilityPlaneModule = class ObservabilityPlaneModule {
};
exports.ObservabilityPlaneModule = ObservabilityPlaneModule;
exports.ObservabilityPlaneModule = ObservabilityPlaneModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [config_1.ConfigModule, axios_1.HttpModule],
        controllers: [observability_stream_controller_1.ObservabilityStreamController],
        providers: [
            supabase_observability_service_1.SupabaseObservabilityService,
            console_observability_service_1.ConsoleObservabilityService,
            observability_events_service_1.ObservabilityEventsService,
            observability_webhook_service_1.ObservabilityWebhookService,
            observability_db_service_1.ObservabilityDbService,
            {
                provide: observability_interface_1.OBSERVABILITY_SERVICE,
                useFactory: (supabaseService, consoleService) => {
                    const provider = process.env.OBSERVABILITY_PROVIDER || 'supabase';
                    logger.log(`Observability plane provider: ${provider}`);
                    switch (provider) {
                        case 'supabase':
                            return supabaseService;
                        case 'console':
                            return consoleService;
                        default:
                            throw new Error(`Unsupported OBSERVABILITY_PROVIDER '${provider}'. Expected: supabase, console`);
                    }
                },
                inject: [supabase_observability_service_1.SupabaseObservabilityService, console_observability_service_1.ConsoleObservabilityService],
            },
        ],
        exports: [
            observability_interface_1.OBSERVABILITY_SERVICE,
            observability_events_service_1.ObservabilityEventsService,
            observability_webhook_service_1.ObservabilityWebhookService,
            observability_db_service_1.ObservabilityDbService,
        ],
    })
], ObservabilityPlaneModule);
