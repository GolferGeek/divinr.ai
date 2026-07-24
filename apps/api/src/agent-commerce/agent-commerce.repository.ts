import { Injectable } from '@nestjs/common';
import type {
  DatabaseTransaction,
  QueryResult,
} from '@orchestratorai/planes/database';
import type {
  ArtifactReleaseInput,
  AuditEventInput,
  CounterReservationInput,
  OutboxInput,
  QuoteCreationInput,
  RefundCreationInput,
  SettlementCommitInput,
  TaskAdmissionInput,
  TaskAdmissionResult,
} from './agent-commerce.types';

export class AgentCommercePersistenceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'AgentCommercePersistenceError';
  }
}

function rows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) {
    throw new AgentCommercePersistenceError(
      `${operation} failed: ${result.error.message}`,
      result.error.code,
    );
  }
  return (result.data as T[] | null) ?? [];
}

@Injectable()
export class AgentCommerceRepository {
  async admitTask(
    transaction: DatabaseTransaction,
    input: TaskAdmissionInput,
  ): Promise<TaskAdmissionResult> {
    const reserved = rows<{ id: string }>(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.a2a_idempotency (
           user_id, scope_hash, idempotency_key, immutable_base_intent_hash,
           current_intent_hash, intent_phase, expires_at
         ) VALUES ($1,$2,$3,$4,$4,'request',$5)
         ON CONFLICT (scope_hash, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          input.userId,
          input.idempotencyScopeHash,
          input.idempotencyKey,
          input.baseIntentHash,
          input.expiresAt,
        ],
      ),
      'reserve task idempotency',
    );

    if (reserved.length === 0) {
      const existing = rows<{ task_id: string | null; immutable_base_intent_hash: string }>(
        await transaction.rawQuery(
          `SELECT task_id, immutable_base_intent_hash
             FROM agent_commerce.a2a_idempotency
            WHERE scope_hash = $1 AND idempotency_key = $2
            FOR UPDATE`,
          [input.idempotencyScopeHash, input.idempotencyKey],
        ),
        'read task idempotency',
      )[0];
      if (!existing || existing.immutable_base_intent_hash !== input.baseIntentHash) {
        throw new AgentCommercePersistenceError(
          'Idempotency key is already bound to a different base intent',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      if (!existing.task_id) {
        throw new AgentCommercePersistenceError(
          'Idempotency admission is still in progress',
          'IDEMPOTENCY_IN_PROGRESS',
        );
      }
      return { created: false, taskId: existing.task_id };
    }

    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.a2a_tasks (
           id, protocol_task_id, context_id, request_id, user_id,
           installation_id, grant_id, skill_id, product_id, product_version,
           scoped_idempotency_key, business_input_hash, base_intent_hash,
           current_intent_hash, intent_phase, a2a_state, payment_state,
           result_state, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
           'request','submitted','quote_required','none',$15
         ) RETURNING id`,
        [
          input.internalTaskId,
          input.protocolTaskId,
          input.contextId,
          input.requestId,
          input.userId,
          input.installationId,
          input.grantId,
          input.skillId,
          input.productId,
          input.productVersion,
          input.idempotencyKey,
          input.businessInputHash,
          input.baseIntentHash,
          input.currentIntentHash,
          input.expiresAt,
        ],
      ),
      'insert A2A task',
    );
    rows(
      await transaction.rawQuery(
        `UPDATE agent_commerce.a2a_idempotency
            SET task_id = $1, last_seen_at = now()
          WHERE scope_hash = $2 AND idempotency_key = $3
          RETURNING id`,
        [input.internalTaskId, input.idempotencyScopeHash, input.idempotencyKey],
      ),
      'bind task idempotency',
    );
    return { created: true, taskId: input.internalTaskId };
  }

  async createQuoteAndRequirement(
    transaction: DatabaseTransaction,
    input: QuoteCreationInput,
  ): Promise<void> {
    const task = rows<{ id: string }>(
      await transaction.rawQuery(
        `SELECT id FROM agent_commerce.a2a_tasks
          WHERE id = $1 AND user_id = $2 AND product_id = $3 AND product_version = $4
          FOR UPDATE`,
        [input.taskId, input.userId, input.productId, input.productVersion],
      ),
      'lock quote task',
    )[0];
    if (!task) {
      throw new AgentCommercePersistenceError('Task/product binding not found', 'PRODUCT_MISMATCH');
    }

    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.checkout_quotes (
           id, quote_id, task_id, user_id, installation_id, product_id,
           product_version, merchant_id, amount, asset, unit, network,
           payment_method, checkout_jwt_hash, checkout_nonce_hash,
           payment_nonce_hash, signed_quote, signed_quote_ref,
           canonical_quote_hash, selected_requirement_hash, status, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12,$13,$14,$15,
           $16,$17::jsonb,$18,$19,$20,'active',$21
         ) RETURNING id`,
        [
          input.internalQuoteId,
          input.quoteId,
          input.taskId,
          input.userId,
          input.installationId,
          input.productId,
          input.productVersion,
          input.merchantId,
          input.amount,
          input.asset,
          input.unit,
          input.network,
          input.paymentMethod,
          input.checkoutJwtHash,
          input.checkoutNonceHash,
          input.paymentNonceHash,
          JSON.stringify(input.signedQuote),
          input.signedQuoteRef ?? null,
          input.canonicalQuoteHash,
          input.canonicalRequirementHash,
          input.expiresAt,
        ],
      ),
      'insert checkout quote',
    );
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.payment_requirements (
           requirement_id, user_id, task_id, quote_id, compatibility_profile,
           extension_uri, canonical_requirement, canonical_requirement_hash,
           amount, asset, unit, network, payment_method,
           invoice_reference_hash, status, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::numeric,$10,$11,$12,$13,$14,
           'active',$15
         ) RETURNING id`,
        [
          input.requirementId,
          input.userId,
          input.taskId,
          input.internalQuoteId,
          input.compatibilityProfile,
          input.extensionUri,
          JSON.stringify(input.canonicalRequirement),
          input.canonicalRequirementHash,
          input.amount,
          input.asset,
          input.unit,
          input.network,
          input.paymentMethod,
          input.invoiceReferenceHash,
          input.expiresAt,
        ],
      ),
      'insert payment requirement',
    );
    rows(
      await transaction.rawQuery(
        `UPDATE agent_commerce.a2a_tasks
            SET quote_id = $2, payment_state = 'payment_required',
                intent_phase = 'quote', lock_version = lock_version + 1,
                updated_at = now()
          WHERE id = $1
          RETURNING id`,
        [input.taskId, input.internalQuoteId],
      ),
      'advance task to payment required',
    );
  }

  async reserveCounter(
    transaction: DatabaseTransaction,
    input: CounterReservationInput,
  ): Promise<void> {
    const updated = rows<{ id: string }>(
      await transaction.rawQuery(
        `UPDATE agent_commerce.ap2_counters
            SET reserved_amount = reserved_amount + $2::numeric,
                reserved_count = reserved_count + $3,
                lock_version = lock_version + 1,
                updated_at = now()
          WHERE id = $1
            AND user_id = $4
            AND window_start <= now() AND window_end > now()
            AND reserved_amount + committed_amount + $2::numeric <= limit_amount
            AND reserved_count + committed_count + $3 <= limit_count
          RETURNING id`,
        [input.counterId, input.amount, input.count, input.userId],
      ),
      'reserve AP2 counter',
    );
    if (!updated[0]) {
      throw new AgentCommercePersistenceError('AP2 counter limit exceeded', 'BUDGET_EXCEEDED');
    }
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.ap2_reservations (
           reservation_id, user_id, counter_id, task_id, quote_id, mandate_id,
           amount, reservation_count, state, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,'reserved',$9)
         RETURNING id`,
        [
          input.reservationId,
          input.userId,
          input.counterId,
          input.taskId,
          input.quoteId,
          input.mandateId,
          input.amount,
          input.count,
          input.expiresAt,
        ],
      ),
      'insert AP2 reservation',
    );
  }

  async commitSettlement(
    transaction: DatabaseTransaction,
    input: SettlementCommitInput,
  ): Promise<void> {
    const submission = rows<{ id: string }>(
      await transaction.rawQuery(
        `UPDATE agent_commerce.payment_submissions
            SET state = 'accepted', verified_at = $3,
                lock_version = lock_version + 1
          WHERE id = $1 AND task_id = $2 AND state IN ('submitted','verifying','unknown')
          RETURNING id`,
        [input.submissionId, input.taskId, input.confirmedAt],
      ),
      'accept payment submission',
    )[0];
    if (!submission) {
      throw new AgentCommercePersistenceError('Payment submission cannot settle', 'PAYMENT_STATE_INVALID');
    }
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.settlements (
           id, settlement_id, user_id, submission_id, merchant_observation_id,
           invoice_hash, payment_hash, amount, asset, unit, fee_amount, state,
           verification_evidence, verification_evidence_ref, observed_at, confirmed_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11::numeric,'verified',
           $12::jsonb,$13,$14,$15
         ) RETURNING id`,
        [
          input.internalSettlementId,
          input.settlementId,
          input.userId,
          input.submissionId,
          input.merchantObservationId,
          input.invoiceHash,
          input.paymentHash,
          input.amount,
          input.asset,
          input.unit,
          input.feeAmount,
          JSON.stringify(input.verificationEvidence),
          input.verificationEvidenceRef ?? null,
          input.observedAt,
          input.confirmedAt,
        ],
      ),
      'insert verified settlement',
    );
    rows(
      await transaction.rawQuery(
        `WITH committed AS (
           UPDATE agent_commerce.ap2_reservations
              SET state = 'committed', settlement_id = $2,
                  committed_at = $3, lock_version = lock_version + 1
            WHERE task_id = $1 AND state = 'reserved'
            RETURNING counter_id, amount, reservation_count
         )
         UPDATE agent_commerce.ap2_counters c
            SET reserved_amount = c.reserved_amount - committed.amount,
                committed_amount = c.committed_amount + committed.amount,
                reserved_count = c.reserved_count - committed.reservation_count,
                committed_count = c.committed_count + committed.reservation_count,
                lock_version = c.lock_version + 1,
                updated_at = now()
           FROM committed
          WHERE c.id = committed.counter_id
          RETURNING c.id`,
        [input.taskId, input.internalSettlementId, input.confirmedAt],
      ),
      'commit AP2 reservations',
    );
    rows(
      await transaction.rawQuery(
        `UPDATE agent_commerce.a2a_tasks
            SET payment_submission_id = $2, payment_state = 'settled',
                intent_phase = 'payment', lock_version = lock_version + 1,
                updated_at = now()
          WHERE id = $1
          RETURNING id`,
        [input.taskId, input.submissionId],
      ),
      'advance settled task',
    );
  }

  async releaseArtifact(
    transaction: DatabaseTransaction,
    input: ArtifactReleaseInput,
  ): Promise<void> {
    const released = rows<{ id: string }>(
      await transaction.rawQuery(
        `UPDATE agent_commerce.result_artifacts artifact
            SET release_state = 'released', release_settlement_id = $3,
                release_receipt_id = $4, released_at = $5,
                lock_version = artifact.lock_version + 1
           FROM agent_commerce.settlements settlement
          WHERE artifact.id = $2
            AND artifact.task_id = $1
            AND artifact.release_state IN ('held','authorized')
            AND settlement.id = $3
            AND settlement.state IN ('verified','reconciled')
          RETURNING artifact.id`,
        [
          input.taskId,
          input.artifactId,
          input.settlementId,
          input.receiptId,
          input.releasedAt,
        ],
      ),
      'release paid artifact',
    );
    if (!released[0]) {
      throw new AgentCommercePersistenceError(
        'Artifact release lacks a verified settlement',
        'PAYMENT_NOT_VERIFIED',
      );
    }
    rows(
      await transaction.rawQuery(
        `UPDATE agent_commerce.a2a_tasks
            SET result_artifact_id = $2, result_state = 'released',
                a2a_state = 'completed', intent_phase = 'result',
                terminal_at = $3, updated_at = $3,
                lock_version = lock_version + 1
          WHERE id = $1 AND payment_state = 'settled'
          RETURNING id`,
        [input.taskId, input.artifactId, input.releasedAt],
      ),
      'complete released task',
    );
  }

  async createRefund(
    transaction: DatabaseTransaction,
    input: RefundCreationInput,
  ): Promise<void> {
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.refund_cases (
           refund_id, user_id, task_id, original_submission_id,
           original_settlement_id, original_payment_hash, reason, amount,
           asset, unit, payer_observation_state, merchant_observation_state,
           state, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,'not_observed',
           'not_observed','requested',$11
         ) RETURNING id`,
        [
          input.refundId,
          input.userId,
          input.taskId,
          input.originalSubmissionId,
          input.originalSettlementId,
          input.originalPaymentHash,
          input.reason,
          input.amount,
          input.asset,
          input.unit,
          input.expiresAt,
        ],
      ),
      'create refund case',
    );
  }

  async enqueueOutbox(
    transaction: DatabaseTransaction,
    input: OutboxInput,
  ): Promise<void> {
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.transactional_outbox (
           outbox_id, user_id, aggregate_type, aggregate_id, aggregate_version,
           event_type, payload_hash, payload_ref, state
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
         ON CONFLICT (aggregate_type, aggregate_id, aggregate_version, event_type)
         DO NOTHING
         RETURNING id`,
        [
          input.outboxId,
          input.userId ?? null,
          input.aggregateType,
          input.aggregateId,
          input.aggregateVersion,
          input.eventType,
          input.payloadHash,
          input.payloadRef,
        ],
      ),
      'enqueue transactional outbox event',
    );
  }

  async appendAuditEvent(
    transaction: DatabaseTransaction,
    input: AuditEventInput,
  ): Promise<void> {
    const prior = rows<{ sequence: string; event_hash: string }>(
      await transaction.rawQuery(
        `SELECT sequence::text, event_hash
           FROM agent_commerce.security_audit_events
          WHERE ordering_key = $1
          ORDER BY sequence DESC
          LIMIT 1
          FOR UPDATE`,
        [input.orderingKey],
      ),
      'lock audit chain',
    )[0];
    const sequence = prior ? BigInt(prior.sequence) + 1n : 1n;
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.security_audit_events (
           event_id, ordering_key, sequence, actor_principal, user_id,
           installation_id, task_id, mandate_id, payment_submission_id,
           receipt_id, action, outcome, reason, redacted_detail,
           previous_event_hash, event_hash
         ) VALUES (
           $1,$2,$3::bigint,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16
         ) RETURNING id`,
        [
          input.eventId,
          input.orderingKey,
          sequence.toString(),
          input.actorPrincipal,
          input.userId ?? null,
          input.installationId ?? null,
          input.taskId ?? null,
          input.mandateId ?? null,
          input.paymentSubmissionId ?? null,
          input.receiptId ?? null,
          input.action,
          input.outcome,
          input.reason ?? null,
          JSON.stringify(input.redactedDetail),
          prior?.event_hash ?? null,
          input.eventHash,
        ],
      ),
      'append security audit event',
    );
  }
}
