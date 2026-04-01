/**
 * Output Types V2
 *
 * Typed output model for the invoke contract. Replaces old mode-based
 * response semantics with explicit content typing.
 */

/**
 * Supported output types for invoke results.
 */
export type OutputType =
  | 'text'
  | 'markdown'
  | 'json'
  | 'image'
  | 'video'
  | 'audio'
  | 'artifact-ref';

/**
 * Supported input content types for invoke requests.
 */
export type ContentType =
  | 'text'
  | 'markdown'
  | 'json'
  | 'arguments'
  | 'binary-ref';
