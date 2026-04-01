"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStrictPlanResponse = isStrictPlanResponse;
exports.isStrictBuildResponse = isStrictBuildResponse;
exports.isStrictConverseResponse = isStrictConverseResponse;
exports.isStrictErrorResponse = isStrictErrorResponse;
exports.isStrictSuccessResponse = isStrictSuccessResponse;
function isStrictPlanResponse(response) {
    return (response &&
        response.jsonrpc === '2.0' &&
        response.result &&
        response.result.mode === 'plan');
}
function isStrictBuildResponse(response) {
    return (response &&
        response.jsonrpc === '2.0' &&
        response.result &&
        response.result.mode === 'build');
}
function isStrictConverseResponse(response) {
    return (response &&
        response.jsonrpc === '2.0' &&
        response.result &&
        response.result.mode === 'converse');
}
function isStrictErrorResponse(response) {
    return (response &&
        response.jsonrpc === '2.0' &&
        'error' in response);
}
function isStrictSuccessResponse(response) {
    return (response &&
        response.jsonrpc === '2.0' &&
        'result' in response &&
        response.result.success === true);
}
//# sourceMappingURL=strict-aliases.js.map