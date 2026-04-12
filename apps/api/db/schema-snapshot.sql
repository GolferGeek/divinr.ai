--
-- PostgreSQL database dump
--

\restrict HigtdUG5uM1ciDC8X6vXmZm1LJ0XDOz5I2IrPWtOp3d6sBeSXRAvZkYTWVt4qJj

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: authz; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA authz;


--
-- Name: messaging; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA messaging;


--
-- Name: prediction; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA prediction;


--
-- Name: SCHEMA prediction; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA prediction IS 'Prediction System Redesign: signals, predictors, predictions, multi-analyst evaluation, learning loop';


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: rbac_has_permission(text, text, text, text); Type: FUNCTION; Schema: authz; Owner: -
--

CREATE FUNCTION authz.rbac_has_permission(p_user_id text, p_permission text, p_resource_type text DEFAULT NULL::text, p_resource_id text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
      select exists (
        select 1
        from authz.rbac_user_roles uor
        join authz.rbac_role_permissions rp on rp.role_id = uor.role_id
        join authz.rbac_permissions p on p.id = rp.permission_id
        where uor.user_id = p_user_id
          and p.name = p_permission
          and (uor.expires_at is null or uor.expires_at > now())
      );
    $$;


--
-- Name: rbac_has_permission(text, character varying, character varying, character varying, text); Type: FUNCTION; Schema: authz; Owner: -
--

CREATE FUNCTION authz.rbac_has_permission(p_user_id text, p_organization_slug character varying, p_permission character varying, p_resource_type character varying DEFAULT NULL::character varying, p_resource_id text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
      select exists (
        select 1
        from authz.rbac_user_org_roles uor
        join authz.rbac_role_permissions rp on rp.role_id = uor.role_id
        join authz.rbac_permissions p on p.id = rp.permission_id
        where uor.user_id = p_user_id
          and uor.organization_slug = p_organization_slug
          and p.name = p_permission
          and (uor.expires_at is null or uor.expires_at > now())
      );
    $$;


--
-- Name: secure_upsert_document(text, character varying, text, text, text); Type: FUNCTION; Schema: authz; Owner: -
--

CREATE FUNCTION authz.secure_upsert_document(p_user_id text, p_organization_slug character varying, p_document_id text, p_title text, p_body text) RETURNS text
    LANGUAGE plpgsql
    AS $$
    begin
      if not authz.rbac_has_permission(
        p_user_id,
        'compliance.documents.write',
        null,
        null
      ) then
        return null;
      end if;

      insert into authz.compliance_documents (id, organization_slug, user_id, title, body)
      values (p_document_id, p_organization_slug, p_user_id, p_title, p_body)
      on conflict (id) do update
      set title = excluded.title,
          body = excluded.body
      where authz.compliance_documents.organization_slug = excluded.organization_slug;

      if found then
        return p_document_id;
      end if;

      return null;
    end;
    $$;


--
-- Name: auto_create_test_mirror(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.auto_create_test_mirror() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  test_symbol TEXT;
  test_target_id UUID;
  mirror_exists BOOLEAN;
BEGIN
  -- Only create mirrors for non-test targets (symbols NOT starting with T_)
  IF NEW.symbol NOT LIKE 'T_%' THEN
    -- Check if mirror already exists
    SELECT EXISTS(
      SELECT 1 FROM prediction.test_target_mirrors
      WHERE real_target_id = NEW.id
    ) INTO mirror_exists;

    IF NOT mirror_exists THEN
      -- Generate test symbol
      test_symbol := 'T_' || NEW.symbol;

      -- Check if test target already exists (might have been created manually)
      SELECT id INTO test_target_id
      FROM prediction.targets
      WHERE symbol = test_symbol AND universe_id = NEW.universe_id;

      -- Create test target if it doesn't exist
      IF test_target_id IS NULL THEN
        INSERT INTO prediction.targets (
          universe_id,
          symbol,
          name,
          target_type,
          context,
          is_active,
          metadata
        ) VALUES (
          NEW.universe_id,
          test_symbol,
          'TEST: ' || COALESCE(NEW.name, NEW.symbol),
          NEW.target_type,
          'Test mirror of ' || NEW.symbol || '. ' || COALESCE(NEW.context, ''),
          COALESCE(NEW.is_active, true),
          jsonb_build_object(
            'is_test_mirror', true,
            'real_target_id', NEW.id,
            'real_symbol', NEW.symbol
          )
        )
        RETURNING id INTO test_target_id;
      END IF;

      -- Create the mirror mapping
      INSERT INTO prediction.test_target_mirrors (real_target_id, test_target_id)
      VALUES (NEW.id, test_target_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION auto_create_test_mirror(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.auto_create_test_mirror() IS 'Auto-creates T_ mirror for each new real target (INV-11). Fixed to use context instead of description column.';


--
-- Name: calculate_position_pnl(text, numeric, numeric, numeric); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.calculate_position_pnl(p_direction text, p_entry_price numeric, p_current_price numeric, p_quantity numeric) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_direction = 'long' THEN
    RETURN (p_current_price - p_entry_price) * p_quantity;
  ELSE  -- short
    RETURN (p_entry_price - p_current_price) * p_quantity;
  END IF;
END;
$$;


--
-- Name: cleanup_all_test_data(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.cleanup_all_test_data() RETURNS TABLE(table_name text, rows_deleted bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  tbl RECORD;
  deleted_count BIGINT;
BEGIN
  -- Delete from all tables that have is_test_data column
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'prediction'
      AND c.column_name = 'is_test_data'
      AND c.table_name != 'test_scenarios'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DELETE FROM prediction.%I WHERE is_test_data = TRUE',
      tbl.table_name
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    IF deleted_count > 0 THEN
      table_name := tbl.table_name;
      rows_deleted := deleted_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Delete all test scenarios
  DELETE FROM prediction.test_scenarios;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 0 THEN
    table_name := 'test_scenarios';
    rows_deleted := deleted_count;
    RETURN NEXT;
  END IF;
END;
$$;


--
-- Name: FUNCTION cleanup_all_test_data(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.cleanup_all_test_data() IS 'Cleans up ALL test data from the prediction schema - use with caution';


--
-- Name: cleanup_replay_test(uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.cleanup_replay_test(p_replay_test_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_count INTEGER;
BEGIN
  -- Delete results
  DELETE FROM prediction.replay_test_results
  WHERE replay_test_id = p_replay_test_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('table', 'replay_test_results', 'deleted', v_count);

  -- Delete snapshots
  DELETE FROM prediction.replay_test_snapshots
  WHERE replay_test_id = p_replay_test_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_results := v_results || jsonb_build_object('table', 'replay_test_snapshots', 'deleted', v_count);

  -- Note: We don't delete the replay_test itself, just mark it as cleaned
  UPDATE prediction.replay_tests
  SET status = 'restored'
  WHERE id = p_replay_test_id;

  RETURN v_results;
END;
$$;


--
-- Name: FUNCTION cleanup_replay_test(p_replay_test_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.cleanup_replay_test(p_replay_test_id uuid) IS 'Cleans up all data associated with a replay test';


--
-- Name: cleanup_test_scenario(uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.cleanup_test_scenario(p_scenario_id uuid) RETURNS TABLE(table_name text, rows_deleted bigint)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  tbl RECORD;
  deleted_count BIGINT;
BEGIN
  -- Delete from all tables that have test_scenario_id column
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'prediction'
      AND c.column_name = 'test_scenario_id'
      AND c.table_name != 'test_scenarios'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DELETE FROM prediction.%I WHERE test_scenario_id = $1',
      tbl.table_name
    ) USING p_scenario_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    IF deleted_count > 0 THEN
      table_name := tbl.table_name;
      rows_deleted := deleted_count;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Finally, delete the scenario itself
  DELETE FROM prediction.test_scenarios WHERE id = p_scenario_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 0 THEN
    table_name := 'test_scenarios';
    rows_deleted := deleted_count;
    RETURN NEXT;
  END IF;
END;
$_$;


--
-- Name: FUNCTION cleanup_test_scenario(p_scenario_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.cleanup_test_scenario(p_scenario_id uuid) IS 'Cleans up all test data for a specific scenario';


--
-- Name: create_analyst_context_version(uuid, text, text, jsonb, numeric, text, text, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.create_analyst_context_version(p_analyst_id uuid, p_fork_type text, p_perspective text, p_tier_instructions jsonb, p_default_weight numeric, p_agent_journal text DEFAULT NULL::text, p_change_reason text DEFAULT NULL::text, p_changed_by text DEFAULT 'system'::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_next_version INTEGER;
  v_new_id UUID;
BEGIN
  -- Mark previous version as not current
  UPDATE prediction.analyst_context_versions
  SET is_current = FALSE
  WHERE analyst_id = p_analyst_id
    AND fork_type = p_fork_type
    AND is_current = TRUE;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM prediction.analyst_context_versions
  WHERE analyst_id = p_analyst_id
    AND fork_type = p_fork_type;

  -- Insert new version
  INSERT INTO prediction.analyst_context_versions (
    analyst_id, fork_type, version_number,
    perspective, tier_instructions, default_weight,
    agent_journal, change_reason, changed_by, is_current
  ) VALUES (
    p_analyst_id, p_fork_type, v_next_version,
    p_perspective, p_tier_instructions, p_default_weight,
    p_agent_journal, p_change_reason, p_changed_by, TRUE
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


--
-- Name: create_replay_snapshot(uuid, text, uuid[]); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.create_replay_snapshot(p_replay_test_id uuid, p_table_name text, p_record_ids uuid[]) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_snapshot_id UUID;
  v_data JSONB;
  v_count INTEGER;
BEGIN
  -- Get the data based on table name
  IF p_table_name = 'predictions' THEN
    SELECT jsonb_agg(row_to_json(p)::jsonb), COUNT(*)
    INTO v_data, v_count
    FROM prediction.predictions p
    WHERE p.id = ANY(p_record_ids);

  ELSIF p_table_name = 'predictors' THEN
    SELECT jsonb_agg(row_to_json(p)::jsonb), COUNT(*)
    INTO v_data, v_count
    FROM prediction.predictors p
    WHERE p.id = ANY(p_record_ids);

  ELSIF p_table_name = 'signals' THEN
    SELECT jsonb_agg(row_to_json(s)::jsonb), COUNT(*)
    INTO v_data, v_count
    FROM prediction.signals s
    WHERE s.id = ANY(p_record_ids);

  ELSIF p_table_name = 'analyst_assessments' THEN
    SELECT jsonb_agg(row_to_json(a)::jsonb), COUNT(*)
    INTO v_data, v_count
    FROM prediction.analyst_assessments a
    WHERE a.id = ANY(p_record_ids);

  ELSE
    RAISE EXCEPTION 'Unknown table name: %', p_table_name;
  END IF;

  -- Insert snapshot
  INSERT INTO prediction.replay_test_snapshots (
    replay_test_id,
    table_name,
    original_data,
    record_ids,
    row_count
  ) VALUES (
    p_replay_test_id,
    p_table_name,
    COALESCE(v_data, '[]'::jsonb),
    p_record_ids,
    COALESCE(v_count, 0)
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;


--
-- Name: FUNCTION create_replay_snapshot(p_replay_test_id uuid, p_table_name text, p_record_ids uuid[]); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.create_replay_snapshot(p_replay_test_id uuid, p_table_name text, p_record_ids uuid[]) IS 'Creates a snapshot of records for a replay test';


--
-- Name: enforce_prediction_direction(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_prediction_direction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT prediction.validate_prediction_direction(NEW.direction, NEW.target_id) THEN
    RAISE EXCEPTION 'Invalid prediction direction "%" for target domain', NEW.direction;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_predictor_direction(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_predictor_direction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT prediction.validate_signal_direction(NEW.direction, NEW.target_id) THEN
    RAISE EXCEPTION 'Invalid predictor direction "%" for target domain', NEW.direction;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_predictor_is_test(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_predictor_is_test() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_is_test BOOLEAN;
BEGIN
  -- Check if the target is test data
  SELECT t.is_test_data INTO target_is_test
  FROM prediction.targets t
  WHERE t.id = NEW.target_id;

  -- If target is test, predictor must be test
  IF target_is_test = true AND NEW.is_test = false THEN
    RAISE EXCEPTION 'INV-03 Violation: Predictor must have is_test=true when target is test data. Target ID: %, Predictor is_test: %',
      NEW.target_id, NEW.is_test;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION enforce_predictor_is_test(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.enforce_predictor_is_test() IS 'INV-03: Predictors from is_test=true signals MUST have is_test=true';


--
-- Name: enforce_signal_direction(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_signal_direction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT prediction.validate_signal_direction(NEW.direction, NEW.target_id) THEN
    RAISE EXCEPTION 'Invalid signal direction "%" for target domain', NEW.direction;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_signal_is_test(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_signal_is_test() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  source_is_test BOOLEAN;
BEGIN
  -- Check source's is_test status from crawler.sources (migrated from prediction.sources)
  SELECT is_test INTO source_is_test
  FROM crawler.sources
  WHERE id = NEW.source_id;

  -- If source not found in crawler.sources, allow the insert (source may be optional)
  IF source_is_test IS NULL THEN
    RETURN NEW;
  END IF;

  -- If source is test, signal must be test
  IF source_is_test = true AND NEW.is_test = false THEN
    RAISE EXCEPTION 'INV-02 Violation: Signal must have is_test=true when source has is_test=true. Source ID: %, Signal is_test: %',
      NEW.source_id, NEW.is_test;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION enforce_signal_is_test(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.enforce_signal_is_test() IS 'Enforces that signals from test sources must be marked as test. Uses crawler.sources (migrated from prediction.sources).';


--
-- Name: enforce_target_domain_type(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_target_domain_type() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  universe_domain TEXT;
  expected_type TEXT;
BEGIN
  -- Get universe domain
  SELECT domain INTO universe_domain
  FROM prediction.universes
  WHERE id = NEW.universe_id;

  -- Map domain to expected target_type
  expected_type := CASE universe_domain
    WHEN 'stocks' THEN 'stock'
    WHEN 'crypto' THEN 'crypto'
    WHEN 'elections' THEN 'election'
    WHEN 'polymarket' THEN 'polymarket'
    ELSE NULL
  END;

  -- Validate
  IF NEW.target_type != expected_type THEN
    RAISE EXCEPTION 'target_type "%" does not match universe domain "%" (expected "%")',
      NEW.target_type, universe_domain, expected_type;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_test_target_isolation(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.enforce_test_target_isolation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_symbol TEXT;
BEGIN
  -- If predictor is test data, target must be T_ prefixed
  IF NEW.is_test = true THEN
    SELECT symbol INTO target_symbol
    FROM prediction.targets
    WHERE id = NEW.target_id;

    IF target_symbol IS NULL THEN
      RAISE EXCEPTION 'INV-04 Violation: Target not found for predictor. Target ID: %', NEW.target_id;
    END IF;

    IF target_symbol NOT LIKE 'T_%' THEN
      RAISE EXCEPTION 'INV-04 Violation: is_test=true predictor can only affect T_ prefixed targets. Target symbol: %. Expected: T_* prefix',
        target_symbol;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION enforce_test_target_isolation(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.enforce_test_target_isolation() IS 'INV-04: is_test=true predictors can ONLY affect T_ prefixed targets';


--
-- Name: get_active_analysts(uuid, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_active_analysts(p_target_id uuid, p_tier text DEFAULT NULL::text) RETURNS TABLE(analyst_id uuid, slug text, name text, perspective text, effective_weight numeric, effective_tier text, tier_instructions jsonb, learned_patterns jsonb, scope_level text)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_target RECORD;
BEGIN
  -- Get target and universe info
  SELECT t.id, t.universe_id, u.domain, u.id as universe_id
  INTO v_target
  FROM prediction.targets t
  JOIN prediction.universes u ON t.universe_id = u.id
  WHERE t.id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target not found: %', p_target_id;
  END IF;

  RETURN QUERY
  WITH analyst_candidates AS (
    -- Get all applicable analysts by scope hierarchy
    SELECT
      a.id,
      a.slug,
      a.name,
      a.perspective,
      a.default_weight,
      a.tier_instructions,
      a.learned_patterns,
      a.scope_level,
      a.is_enabled,
      -- Priority: target > universe > domain > runner
      CASE a.scope_level
        WHEN 'target' THEN 1
        WHEN 'universe' THEN 2
        WHEN 'domain' THEN 3
        WHEN 'runner' THEN 4
      END AS scope_priority
    FROM prediction.analysts a
    WHERE a.is_enabled = true
      AND (
        -- Runner-level (global)
        a.scope_level = 'runner'
        -- Domain-level
        OR (a.scope_level = 'domain' AND a.domain = v_target.domain)
        -- Universe-level
        OR (a.scope_level = 'universe' AND a.universe_id = v_target.universe_id)
        -- Target-level
        OR (a.scope_level = 'target' AND a.target_id = p_target_id)
      )
  ),
  with_overrides AS (
    -- Apply overrides (target > universe)
    -- Use DISTINCT ON to pick the most specific scope per analyst slug
    SELECT DISTINCT ON (ac.slug)
      ac.id AS analyst_id,
      ac.slug,
      ac.name,
      ac.perspective,
      COALESCE(
        tao.weight_override,
        uao.weight_override,
        ac.default_weight
      ) AS effective_weight,
      COALESCE(
        tao.tier_override,
        uao.tier_override,
        COALESCE(p_tier, 'silver')
      ) AS effective_tier,
      ac.tier_instructions,
      ac.learned_patterns,
      ac.scope_level,
      COALESCE(
        tao.is_enabled_override,
        uao.is_enabled_override,
        ac.is_enabled
      ) AS is_enabled
    FROM analyst_candidates ac
    LEFT JOIN prediction.analyst_overrides tao
      ON tao.analyst_id = ac.id AND tao.target_id = p_target_id
    LEFT JOIN prediction.analyst_overrides uao
      ON uao.analyst_id = ac.id AND uao.universe_id = v_target.universe_id AND uao.target_id IS NULL
    ORDER BY ac.slug, ac.scope_priority
  )
  SELECT
    wo.analyst_id,
    wo.slug,
    wo.name,
    wo.perspective,
    wo.effective_weight,
    wo.effective_tier,
    wo.tier_instructions,
    wo.learned_patterns,
    wo.scope_level
  FROM with_overrides wo
  WHERE wo.is_enabled = true
    AND wo.effective_weight > 0
  ORDER BY wo.effective_weight DESC;
END;
$$;


--
-- Name: FUNCTION get_active_analysts(p_target_id uuid, p_tier text); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_active_analysts(p_target_id uuid, p_tier text) IS 'Returns active analysts for a target with effective weights, respecting scope hierarchy and overrides';


--
-- Name: get_active_learnings(uuid, text, uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_active_learnings(p_target_id uuid, p_tier text DEFAULT NULL::text, p_analyst_id uuid DEFAULT NULL::uuid) RETURNS TABLE(learning_id uuid, learning_type text, title text, description text, config jsonb, scope_level text, times_applied integer, times_helpful integer)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_target RECORD;
BEGIN
  -- Get target info
  SELECT t.id, t.universe_id, u.domain
  INTO v_target
  FROM prediction.targets t
  JOIN prediction.universes u ON t.universe_id = u.id
  WHERE t.id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target not found: %', p_target_id;
  END IF;

  RETURN QUERY
  SELECT
    l.id AS learning_id,
    l.learning_type,
    l.title,
    l.description,
    l.config,
    l.scope_level,
    l.times_applied,
    l.times_helpful
  FROM prediction.learnings l
  WHERE l.status = 'active'
    AND (
      -- Runner-level (global)
      l.scope_level = 'runner'
      -- Domain-level
      OR (l.scope_level = 'domain' AND l.domain = v_target.domain)
      -- Universe-level
      OR (l.scope_level = 'universe' AND l.universe_id = v_target.universe_id)
      -- Target-level
      OR (l.scope_level = 'target' AND l.target_id = p_target_id)
    )
    -- Analyst filter (if specified)
    AND (p_analyst_id IS NULL OR l.analyst_id IS NULL OR l.analyst_id = p_analyst_id)
  ORDER BY
    -- Broader scope first (runner -> target)
    CASE l.scope_level
      WHEN 'runner' THEN 1
      WHEN 'domain' THEN 2
      WHEN 'universe' THEN 3
      WHEN 'target' THEN 4
    END,
    l.times_helpful DESC,
    l.created_at ASC;
END;
$$;


--
-- Name: FUNCTION get_active_learnings(p_target_id uuid, p_tier text, p_analyst_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_active_learnings(p_target_id uuid, p_tier text, p_analyst_id uuid) IS 'Returns active learnings for a target, respecting scope hierarchy, with optional analyst filter';


--
-- Name: get_analyst_effective_settings(uuid, uuid, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_analyst_effective_settings(p_analyst_id uuid, p_target_id uuid, p_tier text DEFAULT NULL::text) RETURNS TABLE(effective_weight numeric, effective_tier text, is_enabled boolean, tier_instructions jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_analyst RECORD;
  v_target RECORD;
  v_target_override RECORD;
  v_universe_override RECORD;
BEGIN
  -- Get analyst info
  SELECT a.*, a.default_weight, a.is_enabled, a.tier_instructions
  INTO v_analyst
  FROM prediction.analysts a
  WHERE a.id = p_analyst_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Analyst not found: %', p_analyst_id;
  END IF;

  -- Get target info
  SELECT t.id, t.universe_id
  INTO v_target
  FROM prediction.targets t
  WHERE t.id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target not found: %', p_target_id;
  END IF;

  -- Get target-level override (if exists)
  SELECT ao.*
  INTO v_target_override
  FROM prediction.analyst_overrides ao
  WHERE ao.analyst_id = p_analyst_id
    AND ao.target_id = p_target_id;

  -- Get universe-level override (if exists and no target override)
  SELECT ao.*
  INTO v_universe_override
  FROM prediction.analyst_overrides ao
  WHERE ao.analyst_id = p_analyst_id
    AND ao.universe_id = v_target.universe_id
    AND ao.target_id IS NULL;

  -- Return effective settings
  RETURN QUERY
  SELECT
    COALESCE(
      v_target_override.weight_override,
      v_universe_override.weight_override,
      v_analyst.default_weight
    ) AS effective_weight,
    COALESCE(
      v_target_override.tier_override,
      v_universe_override.tier_override,
      COALESCE(p_tier, 'silver')
    ) AS effective_tier,
    COALESCE(
      v_target_override.is_enabled_override,
      v_universe_override.is_enabled_override,
      v_analyst.is_enabled
    ) AS is_enabled,
    v_analyst.tier_instructions;
END;
$$;


--
-- Name: FUNCTION get_analyst_effective_settings(p_analyst_id uuid, p_target_id uuid, p_tier text); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_analyst_effective_settings(p_analyst_id uuid, p_target_id uuid, p_tier text) IS 'Returns effective settings for a specific analyst at a target, respecting overrides';


--
-- Name: get_context_for_target(uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_context_for_target(p_target_id uuid) RETURNS TABLE(scope_level text, slug text, name text, perspective text, tier_instructions jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_target RECORD;
BEGIN
  -- Get target and universe info
  SELECT t.id, t.universe_id, u.domain
  INTO v_target
  FROM prediction.targets t
  JOIN prediction.universes u ON t.universe_id = u.id
  WHERE t.id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target not found: %', p_target_id;
  END IF;

  -- Return context providers in scope order: runner -> domain -> universe -> target
  RETURN QUERY
  SELECT
    a.scope_level,
    a.slug,
    a.name,
    a.perspective,
    a.tier_instructions
  FROM prediction.analysts a
  WHERE a.analyst_type = 'context_provider'
    AND a.is_enabled = true
    AND (
      -- Runner-level (always included)
      a.scope_level = 'runner'
      -- Domain-level (if matches)
      OR (a.scope_level = 'domain' AND a.domain = v_target.domain)
      -- Universe-level (if matches)
      OR (a.scope_level = 'universe' AND a.universe_id = v_target.universe_id)
      -- Target-level (if matches)
      OR (a.scope_level = 'target' AND a.target_id = p_target_id)
    )
  ORDER BY
    CASE a.scope_level
      WHEN 'runner' THEN 1
      WHEN 'domain' THEN 2
      WHEN 'universe' THEN 3
      WHEN 'target' THEN 4
    END;
END;
$$;


--
-- Name: FUNCTION get_context_for_target(p_target_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_context_for_target(p_target_id uuid) IS 'Returns context providers applicable to a target in scope order (runner -> domain -> universe -> target)';


--
-- Name: get_default_model_for_tier(text, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_default_model_for_tier(p_tier text, p_provider text DEFAULT NULL::text) RETURNS TABLE(provider text, model text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT ltm.provider, ltm.model
  FROM prediction.llm_tier_mapping ltm
  WHERE ltm.prediction_tier = p_tier
    AND (p_provider IS NULL OR ltm.provider = p_provider)
  ORDER BY
    CASE ltm.provider
      WHEN 'anthropic' THEN 1
      WHEN 'openai' THEN 2
      ELSE 3
    END
  LIMIT 1;
END;
$$;


--
-- Name: FUNCTION get_default_model_for_tier(p_tier text, p_provider text); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_default_model_for_tier(p_tier text, p_provider text) IS 'Get default model for a prediction tier';


--
-- Name: get_models_for_tier(text, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_models_for_tier(p_tier text, p_provider text DEFAULT NULL::text) RETURNS TABLE(id uuid, provider text, model text, model_tier text, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ltm.id,
    ltm.provider,
    ltm.model,
    ltm.model_tier,
    ltm.metadata
  FROM prediction.llm_tier_mapping ltm
  WHERE ltm.prediction_tier = p_tier
    AND (p_provider IS NULL OR ltm.provider = p_provider)
  ORDER BY
    CASE ltm.model_tier
      WHEN 'flagship' THEN 1
      WHEN 'standard' THEN 2
      WHEN 'economy' THEN 3
      WHEN 'local' THEN 4
      ELSE 5
    END;
END;
$$;


--
-- Name: FUNCTION get_models_for_tier(p_tier text, p_provider text); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_models_for_tier(p_tier text, p_provider text) IS 'Get all enabled models for a prediction tier';


--
-- Name: get_new_articles_for_subscription(uuid, integer); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_new_articles_for_subscription(p_subscription_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(article_id uuid, source_id uuid, url text, title text, content text, summary text, content_hash text, title_normalized text, key_phrases text[], published_at timestamp with time zone, first_seen_at timestamp with time zone, raw_data jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_subscription RECORD;
BEGIN
  -- Get subscription details
  SELECT ps.source_id, ps.last_processed_at, ps.filter_config
  INTO v_subscription
  FROM prediction.source_subscriptions ps
  WHERE ps.id = p_subscription_id
    AND ps.is_active = true;

  IF v_subscription IS NULL THEN
    RETURN;
  END IF;

  -- Return new articles since last processed
  RETURN QUERY
  SELECT
    a.id,
    a.source_id,
    a.url,
    a.title,
    a.content,
    a.summary,
    a.content_hash,
    a.title_normalized,
    a.key_phrases,
    a.published_at,
    a.first_seen_at,
    a.raw_data
  FROM crawler.articles a
  WHERE a.source_id = v_subscription.source_id
    AND a.first_seen_at > v_subscription.last_processed_at
    AND a.is_test = false
  ORDER BY a.first_seen_at ASC
  LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_new_articles_for_subscription(p_subscription_id uuid, p_limit integer); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_new_articles_for_subscription(p_subscription_id uuid, p_limit integer) IS 'Get new articles for a prediction subscription since last processed';


--
-- Name: get_new_articles_for_target(uuid, integer); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_new_articles_for_target(p_target_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(article_id uuid, subscription_id uuid, source_id uuid, url text, title text, content text, summary text, content_hash text, title_normalized text, key_phrases text[], published_at timestamp with time zone, first_seen_at timestamp with time zone, raw_data jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    ps.id as subscription_id,
    a.source_id,
    a.url,
    a.title,
    a.content,
    a.summary,
    a.content_hash,
    a.title_normalized,
    a.key_phrases,
    a.published_at,
    a.first_seen_at,
    a.raw_data
  FROM prediction.source_subscriptions ps
  JOIN crawler.articles a ON a.source_id = ps.source_id
  WHERE ps.target_id = p_target_id
    AND ps.is_active = true
    AND a.first_seen_at > ps.last_processed_at
    AND a.is_test = false
  ORDER BY a.first_seen_at ASC
  LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_new_articles_for_target(p_target_id uuid, p_limit integer); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_new_articles_for_target(p_target_id uuid, p_limit integer) IS 'Get new articles across all subscriptions for a prediction target';


--
-- Name: get_personality_analysts(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_personality_analysts() RETURNS TABLE(analyst_id uuid, slug text, name text, perspective text, default_weight numeric, tier_instructions jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id AS analyst_id,
    a.slug,
    a.name,
    a.perspective,
    a.default_weight,
    a.tier_instructions
  FROM prediction.analysts a
  WHERE a.analyst_type = 'personality'
    AND a.is_enabled = true
  ORDER BY a.name;
END;
$$;


--
-- Name: FUNCTION get_personality_analysts(); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_personality_analysts() IS 'Returns all enabled personality analysts (decision-makers)';


--
-- Name: get_records_for_replay(text, timestamp with time zone, uuid, uuid[]); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.get_records_for_replay(p_rollback_depth text, p_rollback_to timestamp with time zone, p_universe_id uuid, p_target_ids uuid[] DEFAULT NULL::uuid[]) RETURNS TABLE(table_name text, record_ids uuid[], row_count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_target_ids UUID[];
BEGIN
  -- Get target IDs
  IF p_target_ids IS NOT NULL AND array_length(p_target_ids, 1) > 0 THEN
    v_target_ids := p_target_ids;
  ELSE
    SELECT array_agg(id) INTO v_target_ids
    FROM prediction.targets
    WHERE universe_id = p_universe_id;
  END IF;

  -- Always return predictions
  RETURN QUERY
  SELECT
    'predictions'::TEXT,
    array_agg(p.id),
    COUNT(*)::INTEGER
  FROM prediction.predictions p
  WHERE p.target_id = ANY(v_target_ids)
    AND p.predicted_at >= p_rollback_to
    AND (p.is_test_data IS NULL OR p.is_test_data = false);

  -- Return predictors if depth is 'predictors' or 'signals'
  IF p_rollback_depth IN ('predictors', 'signals') THEN
    RETURN QUERY
    SELECT
      'predictors'::TEXT,
      array_agg(pr.id),
      COUNT(*)::INTEGER
    FROM prediction.predictors pr
    WHERE pr.target_id = ANY(v_target_ids)
      AND pr.created_at >= p_rollback_to
      AND (pr.is_test_data IS NULL OR pr.is_test_data = false);

    RETURN QUERY
    SELECT
      'analyst_assessments'::TEXT,
      array_agg(aa.id),
      COUNT(*)::INTEGER
    FROM prediction.analyst_assessments aa
    JOIN prediction.predictors pr ON aa.predictor_id = pr.id
    WHERE pr.target_id = ANY(v_target_ids)
      AND pr.created_at >= p_rollback_to
      AND (pr.is_test_data IS NULL OR pr.is_test_data = false);
  END IF;

  -- Return signals if depth is 'signals'
  IF p_rollback_depth = 'signals' THEN
    RETURN QUERY
    SELECT
      'signals'::TEXT,
      array_agg(s.id),
      COUNT(*)::INTEGER
    FROM prediction.signals s
    WHERE s.target_id = ANY(v_target_ids)
      AND s.created_at >= p_rollback_to
      AND (s.is_test_data IS NULL OR s.is_test_data = false);
  END IF;
END;
$$;


--
-- Name: FUNCTION get_records_for_replay(p_rollback_depth text, p_rollback_to timestamp with time zone, p_universe_id uuid, p_target_ids uuid[]); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.get_records_for_replay(p_rollback_depth text, p_rollback_to timestamp with time zone, p_universe_id uuid, p_target_ids uuid[]) IS 'Gets record IDs that would be affected by a replay test';


--
-- Name: increment_learning_application(uuid, boolean); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.increment_learning_application(p_learning_id uuid, p_was_helpful boolean DEFAULT NULL::boolean) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE prediction.learnings
  SET
    times_applied = times_applied + 1,
    times_helpful = CASE
      WHEN p_was_helpful = true THEN times_helpful + 1
      ELSE times_helpful
    END,
    updated_at = NOW()
  WHERE id = p_learning_id;
END;
$$;


--
-- Name: FUNCTION increment_learning_application(p_learning_id uuid, p_was_helpful boolean); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.increment_learning_application(p_learning_id uuid, p_was_helpful boolean) IS 'Increments times_applied counter for a learning, optionally marking as helpful';


--
-- Name: log_test_audit(text, uuid, text, text, uuid, jsonb); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.log_test_audit(p_organization_slug text, p_user_id uuid, p_action text, p_resource_type text, p_resource_id uuid, p_details jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO prediction.test_audit_log (
    organization_slug, user_id, action, resource_type, resource_id, details
  ) VALUES (
    p_organization_slug, p_user_id, p_action, p_resource_type, p_resource_id, p_details
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;


--
-- Name: FUNCTION log_test_audit(p_organization_slug text, p_user_id uuid, p_action text, p_resource_type text, p_resource_id uuid, p_details jsonb); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.log_test_audit(p_organization_slug text, p_user_id uuid, p_action text, p_resource_type text, p_resource_id uuid, p_details jsonb) IS 'Helper function to create audit log entries';


--
-- Name: map_sentiment_to_outcome(text, text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.map_sentiment_to_outcome(p_sentiment text, p_domain text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_domain IN ('stocks', 'crypto') THEN
    RETURN CASE p_sentiment
      WHEN 'bullish' THEN 'up'
      WHEN 'bearish' THEN 'down'
      WHEN 'neutral' THEN 'flat'
      ELSE NULL
    END;
  ELSIF p_domain IN ('elections', 'polymarket') THEN
    -- For elections/polymarket, sentiment maps to yes/no
    RETURN CASE p_sentiment
      WHEN 'bullish' THEN 'yes'
      WHEN 'bearish' THEN 'no'
      WHEN 'neutral' THEN 'uncertain'
      WHEN 'yes' THEN 'yes'
      WHEN 'no' THEN 'no'
      ELSE NULL
    END;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: FUNCTION map_sentiment_to_outcome(p_sentiment text, p_domain text); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.map_sentiment_to_outcome(p_sentiment text, p_domain text) IS 'Maps sentiment vocabulary to outcome vocabulary';


--
-- Name: restore_replay_snapshot(uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.restore_replay_snapshot(p_snapshot_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_snapshot RECORD;
  v_item JSONB;
  v_restored INTEGER := 0;
BEGIN
  -- Get the snapshot
  SELECT * INTO v_snapshot
  FROM prediction.replay_test_snapshots
  WHERE id = p_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot not found: %', p_snapshot_id;
  END IF;

  -- Restore based on table name
  IF v_snapshot.table_name = 'predictions' THEN
    INSERT INTO prediction.predictions
    SELECT * FROM jsonb_populate_recordset(null::prediction.predictions, v_snapshot.original_data)
    ON CONFLICT (id) DO UPDATE SET
      target_id = EXCLUDED.target_id,
      direction = EXCLUDED.direction,
      confidence = EXCLUDED.confidence,
      magnitude = EXCLUDED.magnitude,
      reasoning = EXCLUDED.reasoning,
      status = EXCLUDED.status,
      predicted_at = EXCLUDED.predicted_at;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

  ELSIF v_snapshot.table_name = 'predictors' THEN
    INSERT INTO prediction.predictors
    SELECT * FROM jsonb_populate_recordset(null::prediction.predictors, v_snapshot.original_data)
    ON CONFLICT (id) DO UPDATE SET
      target_id = EXCLUDED.target_id,
      direction = EXCLUDED.direction,
      confidence = EXCLUDED.confidence,
      analysis = EXCLUDED.analysis,
      status = EXCLUDED.status;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

  ELSIF v_snapshot.table_name = 'signals' THEN
    INSERT INTO prediction.signals
    SELECT * FROM jsonb_populate_recordset(null::prediction.signals, v_snapshot.original_data)
    ON CONFLICT (id) DO UPDATE SET
      target_id = EXCLUDED.target_id,
      source_id = EXCLUDED.source_id,
      content = EXCLUDED.content,
      signal_type = EXCLUDED.signal_type,
      sentiment = EXCLUDED.sentiment;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

  ELSIF v_snapshot.table_name = 'analyst_assessments' THEN
    INSERT INTO prediction.analyst_assessments
    SELECT * FROM jsonb_populate_recordset(null::prediction.analyst_assessments, v_snapshot.original_data)
    ON CONFLICT (id) DO UPDATE SET
      analyst_id = EXCLUDED.analyst_id,
      predictor_id = EXCLUDED.predictor_id,
      direction = EXCLUDED.direction,
      confidence = EXCLUDED.confidence,
      analysis = EXCLUDED.analysis;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

  END IF;

  RETURN v_restored;
END;
$$;


--
-- Name: FUNCTION restore_replay_snapshot(p_snapshot_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.restore_replay_snapshot(p_snapshot_id uuid) IS 'Restores data from a snapshot';


--
-- Name: set_test_scenarios_updated_at(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.set_test_scenarios_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_analyst_portfolio_status(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.update_analyst_portfolio_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_balance_percent NUMERIC;
  v_new_status TEXT;
BEGIN
  -- Only applies to agent fork
  IF NEW.fork_type != 'agent' THEN
    RETURN NEW;
  END IF;

  -- Calculate balance as percentage of initial
  v_balance_percent := (NEW.current_balance / NEW.initial_balance) * 100;

  -- Determine new status based on thresholds
  IF v_balance_percent >= 80 THEN
    v_new_status := 'active';
  ELSIF v_balance_percent >= 60 THEN
    v_new_status := 'warning';
  ELSIF v_balance_percent >= 40 THEN
    v_new_status := 'probation';
  ELSE
    v_new_status := 'suspended';
  END IF;

  -- Update status if changed
  IF NEW.status != v_new_status THEN
    NEW.status := v_new_status;
    NEW.status_changed_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: update_daily_postmortem_recommendations_timestamp(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.update_daily_postmortem_recommendations_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_daily_postmortem_runs_timestamp(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.update_daily_postmortem_runs_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_subscription_watermark(uuid, timestamp with time zone); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.update_subscription_watermark(p_subscription_id uuid, p_last_processed_at timestamp with time zone DEFAULT now()) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE prediction.source_subscriptions
  SET last_processed_at = p_last_processed_at
  WHERE id = p_subscription_id;
END;
$$;


--
-- Name: FUNCTION update_subscription_watermark(p_subscription_id uuid, p_last_processed_at timestamp with time zone); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.update_subscription_watermark(p_subscription_id uuid, p_last_processed_at timestamp with time zone) IS 'Update the last_processed_at watermark for a subscription';


--
-- Name: user_has_org_access(text); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.user_has_org_access(p_org_slug text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'authz', 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM authz.rbac_get_user_organizations(auth.uid())
    WHERE organization_slug = p_org_slug
  );
END;
$$;


--
-- Name: validate_learning_lineage(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_learning_lineage() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  test_is_test BOOLEAN;
  prod_is_test BOOLEAN;
BEGIN
  -- Check test learning is_test flag
  SELECT is_test INTO test_is_test
  FROM prediction.learnings
  WHERE id = NEW.test_learning_id;

  -- Check production learning is_test flag
  SELECT is_test INTO prod_is_test
  FROM prediction.learnings
  WHERE id = NEW.production_learning_id;

  -- Validate test learning has is_test=true
  IF test_is_test != true THEN
    RAISE EXCEPTION 'INV-09 Violation: test_learning_id must reference a learning with is_test=true. Learning ID: %, is_test: %',
      NEW.test_learning_id, test_is_test;
  END IF;

  -- Validate production learning has is_test=false
  IF prod_is_test != false THEN
    RAISE EXCEPTION 'INV-09 Violation: production_learning_id must reference a learning with is_test=false. Learning ID: %, is_test: %',
      NEW.production_learning_id, prod_is_test;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: validate_prediction_direction(text, uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_prediction_direction(p_direction text, p_target_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_domain TEXT;
BEGIN
  -- Get target's domain via universe
  SELECT u.domain INTO v_domain
  FROM prediction.targets t
  JOIN prediction.universes u ON t.universe_id = u.id
  WHERE t.id = p_target_id;

  -- For stocks/crypto: up, down, flat (outcome vocabulary)
  IF v_domain IN ('stocks', 'crypto') THEN
    RETURN p_direction IN ('up', 'down', 'flat');
  END IF;

  -- For elections/polymarket: yes/no/uncertain
  IF v_domain IN ('elections', 'polymarket') THEN
    RETURN p_direction IN ('yes', 'no', 'uncertain');
  END IF;

  -- Unknown domain
  RETURN FALSE;
END;
$$;


--
-- Name: FUNCTION validate_prediction_direction(p_direction text, p_target_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.validate_prediction_direction(p_direction text, p_target_id uuid) IS 'Validates prediction direction against target domain';


--
-- Name: validate_prediction_status_transition(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_prediction_status_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only validate if status is changing
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Valid transitions
  IF OLD.status = 'active' AND NEW.status IN ('resolved', 'expired', 'cancelled') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid prediction status transition from "%" to "%"', OLD.status, NEW.status;
END;
$$;


--
-- Name: validate_signal_direction(text, uuid); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_signal_direction(p_direction text, p_target_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_domain TEXT;
BEGIN
  -- Get target's domain via universe
  SELECT u.domain INTO v_domain
  FROM prediction.targets t
  JOIN prediction.universes u ON t.universe_id = u.id
  WHERE t.id = p_target_id;

  -- For stocks/crypto: bullish, bearish, neutral
  IF v_domain IN ('stocks', 'crypto') THEN
    RETURN p_direction IN ('bullish', 'bearish', 'neutral');
  END IF;

  -- For elections/polymarket: can also use yes/no
  -- Allow bullish/bearish/neutral as fallback
  IF v_domain IN ('elections', 'polymarket') THEN
    RETURN p_direction IN ('bullish', 'bearish', 'neutral', 'yes', 'no');
  END IF;

  -- Unknown domain
  RETURN FALSE;
END;
$$;


--
-- Name: FUNCTION validate_signal_direction(p_direction text, p_target_id uuid); Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON FUNCTION prediction.validate_signal_direction(p_direction text, p_target_id uuid) IS 'Validates signal direction against target domain';


--
-- Name: validate_test_article_symbols(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_test_article_symbols() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check that all target_symbols start with T_
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.target_symbols) AS symbol
    WHERE symbol NOT LIKE 'T_%'
  ) THEN
    RAISE EXCEPTION 'All target_symbols must start with T_ prefix (INV-08)';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_test_target_symbols(); Type: FUNCTION; Schema: prediction; Owner: -
--

CREATE FUNCTION prediction.validate_test_target_symbols() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check that all target_symbols start with T_ (only if array is not empty)
  IF array_length(NEW.target_symbols, 1) > 0 AND EXISTS (
    SELECT 1 FROM unnest(NEW.target_symbols) AS symbol
    WHERE symbol NOT LIKE 'T_%'
  ) THEN
    RAISE EXCEPTION 'All target_symbols must start with T_ prefix (INV-08)';
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: compliance_documents; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.compliance_documents (
    id text NOT NULL,
    organization_slug text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text
);


--
-- Name: rbac_audit_log; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.rbac_audit_log (
    id bigint NOT NULL,
    action text NOT NULL,
    actor_id text NOT NULL,
    target_user_id text,
    target_role_id text,
    organization_slug text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rbac_audit_log_id_seq; Type: SEQUENCE; Schema: authz; Owner: -
--

CREATE SEQUENCE authz.rbac_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rbac_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: authz; Owner: -
--

ALTER SEQUENCE authz.rbac_audit_log_id_seq OWNED BY authz.rbac_audit_log.id;


--
-- Name: rbac_permissions; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.rbac_permissions (
    id text NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    category text
);


--
-- Name: rbac_role_permissions; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.rbac_role_permissions (
    role_id text NOT NULL,
    permission_id text NOT NULL
);


--
-- Name: rbac_roles; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.rbac_roles (
    id text NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL
);


--
-- Name: rbac_user_roles; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.rbac_user_roles (
    user_id text NOT NULL,
    organization_slug text,
    role_id text NOT NULL,
    assigned_by text,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: authz; Owner: -
--

CREATE TABLE authz.users (
    id text NOT NULL,
    email text NOT NULL,
    display_name text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: channel_members; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.channel_members (
    channel_id text NOT NULL,
    user_id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    last_read_at timestamp with time zone DEFAULT now(),
    is_blocked boolean DEFAULT false,
    CONSTRAINT channel_members_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text])))
);


--
-- Name: channels; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.channels (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    scope text NOT NULL,
    scope_id text,
    name text,
    is_archived boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT channels_scope_check CHECK ((scope = ANY (ARRAY['dm'::text, 'club'::text, 'tournament'::text, 'system'::text])))
);


--
-- Name: message_reactions; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.message_reactions (
    message_id text NOT NULL,
    user_id text NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.messages (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    channel_id text NOT NULL,
    sender_id text NOT NULL,
    body text NOT NULL,
    parent_message_id text,
    attached_entity_type text,
    attached_entity_id text,
    is_pinned boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT messages_attached_entity_type_check CHECK (((attached_entity_type IS NULL) OR (attached_entity_type = ANY (ARRAY['prediction'::text, 'instrument'::text, 'tournament'::text, 'analyst'::text, 'position'::text]))))
);


--
-- Name: user_blocks; Type: TABLE; Schema: messaging; Owner: -
--

CREATE TABLE messaging.user_blocks (
    blocker_id text NOT NULL,
    blocked_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_self_modification_log; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.agent_self_modification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analyst_id uuid NOT NULL,
    modification_type text NOT NULL,
    summary text NOT NULL,
    details jsonb NOT NULL,
    trigger_reason text,
    performance_context jsonb,
    acknowledged boolean DEFAULT false NOT NULL,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_self_modification_log_modification_type_check CHECK ((modification_type = ANY (ARRAY['rule_added'::text, 'rule_removed'::text, 'rule_modified'::text, 'weight_changed'::text, 'journal_entry'::text, 'status_change'::text])))
);


--
-- Name: TABLE agent_self_modification_log; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.agent_self_modification_log IS 'Audit trail for agent self-modifications (HITL informational)';


--
-- Name: COLUMN agent_self_modification_log.modification_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.agent_self_modification_log.modification_type IS 'Type of modification: rule_added, rule_removed, rule_modified, weight_changed, journal_entry, status_change';


--
-- Name: COLUMN agent_self_modification_log.acknowledged; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.agent_self_modification_log.acknowledged IS 'Whether user has seen this notification';


--
-- Name: analyst_adaptation_diffs; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_adaptation_diffs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analyst_id uuid NOT NULL,
    user_version_id uuid NOT NULL,
    agent_version_id uuid NOT NULL,
    diff_summary text NOT NULL,
    performance_comparison jsonb NOT NULL,
    adoption_status text DEFAULT 'pending'::text NOT NULL,
    adopted_changes jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_adaptation_diffs_adoption_status_check CHECK ((adoption_status = ANY (ARRAY['pending'::text, 'adopted'::text, 'rejected'::text, 'partial'::text])))
);


--
-- Name: TABLE analyst_adaptation_diffs; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_adaptation_diffs IS 'Track differences between user and agent forks for comparison';


--
-- Name: analyst_assessments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    predictor_id uuid,
    prediction_id uuid,
    analyst_id uuid NOT NULL,
    llm_tier text NOT NULL,
    direction text NOT NULL,
    confidence numeric(3,2) NOT NULL,
    reasoning text NOT NULL,
    learnings_applied jsonb DEFAULT '[]'::jsonb,
    llm_usage_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fork_type text DEFAULT 'user'::text,
    context_version_id uuid,
    CONSTRAINT analyst_assessments_check CHECK (((predictor_id IS NOT NULL) OR (prediction_id IS NOT NULL))),
    CONSTRAINT analyst_assessments_confidence_check CHECK (((confidence >= 0.00) AND (confidence <= 1.00))),
    CONSTRAINT analyst_assessments_llm_tier_check CHECK ((llm_tier = ANY (ARRAY['gold'::text, 'silver'::text, 'bronze'::text]))),
    CONSTRAINT chk_analyst_assessments_fork_type CHECK (((fork_type IS NULL) OR (fork_type = ANY (ARRAY['user'::text, 'agent'::text]))))
);


--
-- Name: TABLE analyst_assessments; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_assessments IS 'Individual assessment records from analysts';


--
-- Name: COLUMN analyst_assessments.predictor_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.predictor_id IS 'Link to predictor (for signal assessment)';


--
-- Name: COLUMN analyst_assessments.prediction_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.prediction_id IS 'Link to prediction (for re-evaluation)';


--
-- Name: COLUMN analyst_assessments.llm_tier; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.llm_tier IS 'LLM tier used for this assessment';


--
-- Name: COLUMN analyst_assessments.direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.direction IS 'Assessment direction (bullish/bearish/neutral or yes/no)';


--
-- Name: COLUMN analyst_assessments.confidence; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.confidence IS 'Confidence level (0.00-1.00)';


--
-- Name: COLUMN analyst_assessments.learnings_applied; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.learnings_applied IS 'Array of learning IDs that were injected into this assessment';


--
-- Name: COLUMN analyst_assessments.llm_usage_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.llm_usage_id IS 'Reference to public.llm_usage for cost tracking';


--
-- Name: COLUMN analyst_assessments.fork_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.fork_type IS 'Which fork made this assessment: user or agent';


--
-- Name: COLUMN analyst_assessments.context_version_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_assessments.context_version_id IS 'Context version used for this assessment';


--
-- Name: analyst_config_versions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_config_versions (
    id text NOT NULL,
    analyst_id text NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    persona_prompt text NOT NULL,
    tier_instructions jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_weight numeric DEFAULT 1.0 NOT NULL,
    config_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    change_reason text,
    parent_version_id text,
    canonical_test_score integer,
    is_active boolean DEFAULT true NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_usage_id uuid,
    context_markdown text,
    CONSTRAINT analyst_config_versions_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'tier1_auto'::text, 'tier2_approved'::text, 'tier3_strategic'::text])))
);


--
-- Name: analyst_contribution_scores; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_contribution_scores (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    analyst_id text NOT NULL,
    instrument_id text,
    period text NOT NULL,
    composite_accuracy_with numeric NOT NULL,
    composite_accuracy_without numeric NOT NULL,
    marginal_contribution numeric NOT NULL,
    prediction_count integer NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_contribution_scores_period_check CHECK ((period = ANY (ARRAY['30d'::text, '90d'::text, 'all'::text])))
);


--
-- Name: analyst_coverage_gaps; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_coverage_gaps (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    instrument_id text NOT NULL,
    horizon_window integer,
    period text NOT NULL,
    best_analyst_id text,
    best_accuracy numeric,
    analyst_count integer NOT NULL,
    avg_accuracy numeric NOT NULL,
    is_gap boolean NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_coverage_gaps_period_check CHECK ((period = ANY (ARRAY['30d'::text, '90d'::text, 'all'::text])))
);


--
-- Name: analyst_overrides; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analyst_id uuid NOT NULL,
    universe_id uuid,
    target_id uuid,
    weight_override numeric(3,2),
    tier_override text,
    is_enabled_override boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_overrides_check CHECK (((universe_id IS NOT NULL) OR (target_id IS NOT NULL))),
    CONSTRAINT analyst_overrides_tier_override_check CHECK (((tier_override IS NULL) OR (tier_override = ANY (ARRAY['gold'::text, 'silver'::text, 'bronze'::text])))),
    CONSTRAINT analyst_overrides_weight_override_check CHECK (((weight_override IS NULL) OR ((weight_override >= 0.00) AND (weight_override <= 2.00))))
);


--
-- Name: TABLE analyst_overrides; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_overrides IS 'Per-universe/target weight and tier overrides for analysts';


--
-- Name: COLUMN analyst_overrides.weight_override; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_overrides.weight_override IS 'Override default weight (NULL = use default)';


--
-- Name: COLUMN analyst_overrides.tier_override; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_overrides.tier_override IS 'Override LLM tier (NULL = use default)';


--
-- Name: COLUMN analyst_overrides.is_enabled_override; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_overrides.is_enabled_override IS 'Override enabled status (NULL = use default)';


--
-- Name: analyst_pair_correlations; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_pair_correlations (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    analyst_a_id text NOT NULL,
    analyst_b_id text NOT NULL,
    instrument_id text,
    horizon_window integer,
    period text NOT NULL,
    agreement_rate numeric NOT NULL,
    sample_size integer NOT NULL,
    flag text,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_pair_correlations_flag_check CHECK ((flag = ANY (ARRAY['redundant'::text, 'adversarial'::text]))),
    CONSTRAINT analyst_pair_correlations_period_check CHECK ((period = ANY (ARRAY['30d'::text, '90d'::text, 'all'::text])))
);


--
-- Name: analyst_performance_metrics; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_performance_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analyst_id uuid NOT NULL,
    fork_type text NOT NULL,
    metric_date date NOT NULL,
    solo_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    contribution_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    dissent_accuracy numeric(5,4),
    dissent_count integer DEFAULT 0 NOT NULL,
    rank_in_portfolio integer,
    total_analysts integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_performance_metrics_fork_type_check CHECK ((fork_type = ANY (ARRAY['user'::text, 'agent'::text])))
);


--
-- Name: TABLE analyst_performance_metrics; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_performance_metrics IS 'Daily performance metrics for analyst tracking';


--
-- Name: COLUMN analyst_performance_metrics.solo_pnl; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_performance_metrics.solo_pnl IS 'P&L if only this analyst picks were used';


--
-- Name: COLUMN analyst_performance_metrics.contribution_pnl; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_performance_metrics.contribution_pnl IS 'Weighted contribution to ensemble P&L';


--
-- Name: COLUMN analyst_performance_metrics.dissent_accuracy; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_performance_metrics.dissent_accuracy IS 'Accuracy when disagreeing with ensemble';


--
-- Name: analyst_performance_profiles; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_performance_profiles (
    id text NOT NULL,
    analyst_id text NOT NULL,
    instrument_id text,
    horizon_window integer NOT NULL,
    period text NOT NULL,
    accuracy_rate numeric,
    avg_confidence numeric,
    calibration_score numeric,
    systematic_biases jsonb DEFAULT '{}'::jsonb NOT NULL,
    sample_size integer DEFAULT 0 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT analyst_performance_profiles_period_check CHECK ((period = ANY (ARRAY['7d'::text, '30d'::text, 'all'::text])))
);


--
-- Name: analyst_portfolios; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_portfolios (
    id text DEFAULT gen_random_uuid() NOT NULL,
    analyst_id text NOT NULL,
    fork_type text DEFAULT 'user'::text NOT NULL,
    initial_balance numeric(20,8) DEFAULT 1000000.00 NOT NULL,
    current_balance numeric(20,8) DEFAULT 1000000.00 NOT NULL,
    total_realized_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    total_unrealized_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    win_count integer DEFAULT 0 NOT NULL,
    loss_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    status_changed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'analyst'::text NOT NULL,
    strategy_name text,
    strategy_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id text,
    CONSTRAINT analyst_portfolios_fork_type_check CHECK ((fork_type = ANY (ARRAY['user'::text, 'ai'::text, 'arbitrator'::text]))),
    CONSTRAINT analyst_portfolios_kind_check CHECK ((kind = ANY (ARRAY['analyst'::text, 'arbitrator'::text, 'day_trader'::text]))),
    CONSTRAINT analyst_portfolios_status_check CHECK ((status = ANY (ARRAY['active'::text, 'warning'::text, 'probation'::text, 'suspended'::text])))
);


--
-- Name: TABLE analyst_portfolios; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_portfolios IS 'Portfolio tracking for analysts with dual user/agent forks';


--
-- Name: COLUMN analyst_portfolios.fork_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_portfolios.fork_type IS 'user = learning loop controlled, agent = self-improving';


--
-- Name: COLUMN analyst_portfolios.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_portfolios.status IS 'Agent fork status: active, warning, probation, suspended';


--
-- Name: analyst_positions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_positions (
    id text DEFAULT gen_random_uuid() NOT NULL,
    portfolio_id text NOT NULL,
    analyst_assessment_id text,
    prediction_id text,
    target_id text,
    symbol text NOT NULL,
    direction text NOT NULL,
    quantity numeric(20,8) NOT NULL,
    entry_price numeric(20,8) NOT NULL,
    current_price numeric(20,8) NOT NULL,
    exit_price numeric(20,8),
    unrealized_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    realized_pnl numeric(20,8),
    is_paper_only boolean DEFAULT false NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fork_type text DEFAULT 'user'::text,
    analyst_id text,
    instrument_id text,
    trigger_reason text DEFAULT 'manual'::text NOT NULL,
    trigger_prediction_id text,
    trigger_conviction numeric,
    trigger_strategy text,
    high_water_mark numeric,
    notes text,
    CONSTRAINT analyst_positions_direction_check CHECK ((direction = ANY (ARRAY['long'::text, 'short'::text]))),
    CONSTRAINT analyst_positions_fork_type_check CHECK ((fork_type = ANY (ARRAY['user'::text, 'ai'::text, 'arbitrator'::text]))),
    CONSTRAINT analyst_positions_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT analyst_positions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    CONSTRAINT analyst_positions_trigger_reason_check CHECK ((trigger_reason = ANY (ARRAY['signal_cross'::text, 'eod_sweep'::text, 'eod_backfill'::text, 'stop_loss'::text, 'take_profit'::text, 'trailing_stop'::text, 'manual'::text, 'strategy'::text])))
);


--
-- Name: TABLE analyst_positions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.analyst_positions IS 'Individual positions for analyst portfolios';


--
-- Name: COLUMN analyst_positions.is_paper_only; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.analyst_positions.is_paper_only IS 'Paper trading for suspended analyst recovery';


--
-- Name: analyst_risk_assessments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_risk_assessments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    analyst_id text NOT NULL,
    score integer NOT NULL,
    confidence numeric NOT NULL,
    reasoning text,
    evidence jsonb DEFAULT '[]'::jsonb,
    source_data jsonb DEFAULT '{}'::jsonb,
    model_provider text,
    model_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_usage_id uuid,
    user_id text,
    CONSTRAINT analyst_risk_assessments_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT analyst_risk_assessments_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: analyst_source_assignments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.analyst_source_assignments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    analyst_id text NOT NULL,
    source_id text NOT NULL,
    data_types text[] DEFAULT '{}'::text[] NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: audit_findings; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.audit_findings (
    id text NOT NULL,
    analyst_id text NOT NULL,
    prediction_id text NOT NULL,
    config_version_id text,
    contract_excerpt text NOT NULL,
    output_excerpt text NOT NULL,
    discrepancy text NOT NULL,
    hypothesis text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    review_text text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    llm_usage_id uuid,
    audit_model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    CONSTRAINT audit_findings_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT audit_findings_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'accepted'::text, 'rejected'::text, 'noted'::text])))
);


--
-- Name: bailout_ledger; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.bailout_ledger (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    portfolio_kind text NOT NULL,
    portfolio_id text NOT NULL,
    reset_date date NOT NULL,
    balance_before numeric NOT NULL,
    topup_amount numeric NOT NULL,
    cumulative_bailouts numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bailout_ledger_portfolio_kind_check CHECK ((portfolio_kind = ANY (ARRAY['user'::text, 'analyst'::text])))
);


--
-- Name: benchmark_series; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.benchmark_series (
    symbol text NOT NULL,
    trading_date date NOT NULL,
    close_price numeric NOT NULL,
    source text NOT NULL
);


--
-- Name: canonical_test_days; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.canonical_test_days (
    id text NOT NULL,
    instrument_id text NOT NULL,
    universe_slug text DEFAULT 'stocks'::text NOT NULL,
    canonical_date date NOT NULL,
    failure_classification text NOT NULL,
    articles_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    predictor_state_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_analysis_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    risk_config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    analyst_config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    original_prediction jsonb DEFAULT '{}'::jsonb NOT NULL,
    original_risk_assessment jsonb DEFAULT '{}'::jsonb NOT NULL,
    actual_outcome jsonb DEFAULT '{}'::jsonb NOT NULL,
    test_scope text DEFAULT 'both'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    added_by text NOT NULL,
    user_id text,
    CONSTRAINT canonical_test_days_test_scope_check CHECK ((test_scope = ANY (ARRAY['prediction'::text, 'risk'::text, 'both'::text])))
);


--
-- Name: daily_pnl_snapshot; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.daily_pnl_snapshot (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    portfolio_kind text NOT NULL,
    portfolio_id text NOT NULL,
    snapshot_date date NOT NULL,
    starting_balance numeric NOT NULL,
    ending_balance numeric NOT NULL,
    realized_pnl numeric NOT NULL,
    unrealized_pnl numeric NOT NULL,
    open_position_count integer NOT NULL,
    trades_today integer NOT NULL,
    CONSTRAINT daily_pnl_snapshot_portfolio_kind_check CHECK ((portfolio_kind = ANY (ARRAY['user'::text, 'analyst'::text])))
);


--
-- Name: daily_postmortem_recommendations; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.daily_postmortem_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    recommendation_type text NOT NULL,
    scope_level text NOT NULL,
    target_id uuid,
    target_symbol text,
    title text NOT NULL,
    rationale text NOT NULL,
    proposed_change jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence numeric(4,3) DEFAULT 0.5 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    action_source text,
    action_note text,
    actioned_by text,
    actioned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_postmortem_runs; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.daily_postmortem_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_slug text NOT NULL,
    agent_slug text NOT NULL,
    run_date date NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    report_markdown text DEFAULT ''::text NOT NULL,
    report_html text DEFAULT ''::text NOT NULL,
    report_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: data_source_registry; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.data_source_registry (
    id text NOT NULL,
    name text NOT NULL,
    provider_type text DEFAULT 'api'::text NOT NULL,
    base_url text,
    api_key_env_var text,
    tier text DEFAULT 'free'::text NOT NULL,
    rate_limit_per_minute integer DEFAULT 60 NOT NULL,
    cache_ttl_seconds integer DEFAULT 900 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_source_registry_provider_type_check CHECK ((provider_type = ANY (ARRAY['api'::text, 'crawler'::text, 'computed'::text]))),
    CONSTRAINT data_source_registry_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'paid'::text])))
);


--
-- Name: domains; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.domains (
    slug text NOT NULL,
    display_name text NOT NULL,
    description text,
    prediction_plane text DEFAULT 'stocks'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: eod_settlement_log; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.eod_settlement_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settlement_date date NOT NULL,
    queued_trades_executed integer DEFAULT 0 NOT NULL,
    analyst_positions_created integer DEFAULT 0 NOT NULL,
    predictions_resolved integer DEFAULT 0 NOT NULL,
    positions_closed integer DEFAULT 0 NOT NULL,
    unrealized_pnl_updated integer DEFAULT 0 NOT NULL,
    total_realized_pnl numeric(20,8) DEFAULT 0 NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evaluations; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prediction_id uuid NOT NULL,
    direction_correct boolean NOT NULL,
    direction_score numeric(3,2) NOT NULL,
    magnitude_accuracy numeric(3,2),
    actual_magnitude text,
    timing_score numeric(3,2),
    analyst_scores jsonb NOT NULL,
    llm_tier_scores jsonb NOT NULL,
    overall_score numeric(3,2) NOT NULL,
    analysis text,
    suggested_learnings jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE evaluations; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.evaluations IS 'Prediction outcome evaluations';


--
-- Name: COLUMN evaluations.direction_correct; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.evaluations.direction_correct IS 'Whether direction prediction was correct';


--
-- Name: COLUMN evaluations.analyst_scores; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.evaluations.analyst_scores IS 'Per-analyst accuracy scores';


--
-- Name: COLUMN evaluations.llm_tier_scores; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.evaluations.llm_tier_scores IS 'Per-LLM tier accuracy scores';


--
-- Name: COLUMN evaluations.suggested_learnings; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.evaluations.suggested_learnings IS 'AI-suggested learnings from this evaluation';


--
-- Name: COLUMN evaluations.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.evaluations.is_test IS 'Flag indicating whether this evaluation is from test data';


--
-- Name: fear_greed_alerts; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.fear_greed_alerts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    predictor_id text NOT NULL,
    instrument_id text NOT NULL,
    symbol text NOT NULL,
    crowd_reaction text NOT NULL,
    crowd_reaction_confidence numeric NOT NULL,
    estimated_reaction_window_minutes integer,
    trade_action text,
    entry_price numeric,
    stop_loss numeric,
    take_profit numeric,
    notification_id text,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fear_greed_alerts_crowd_reaction_check CHECK ((crowd_reaction = ANY (ARRAY['fear_trigger'::text, 'greed_trigger'::text])))
);


--
-- Name: fork_learning_exchanges; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.fork_learning_exchanges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analyst_id uuid NOT NULL,
    initiated_by text NOT NULL,
    question text NOT NULL,
    response text,
    context_diff jsonb,
    performance_evidence jsonb,
    outcome text DEFAULT 'pending'::text NOT NULL,
    adoption_details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fork_learning_exchanges_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['user'::text, 'agent'::text]))),
    CONSTRAINT fork_learning_exchanges_outcome_check CHECK ((outcome = ANY (ARRAY['adopted'::text, 'rejected'::text, 'noted'::text, 'pending'::text])))
);


--
-- Name: TABLE fork_learning_exchanges; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.fork_learning_exchanges IS 'Bidirectional learning dialogues between user and agent forks';


--
-- Name: instrument_analyst_assignments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.instrument_analyst_assignments (
    instrument_id text NOT NULL,
    analyst_id text NOT NULL,
    assigned_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: instruments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.instruments (
    id text NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    asset_type text DEFAULT 'stock'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    universe_slug text DEFAULT 'stocks'::text NOT NULL,
    current_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id text
);


--
-- Name: learning_config; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.learning_config (
    max_confidence_shift numeric DEFAULT 15 NOT NULL,
    max_weight_shift numeric DEFAULT 0.2 NOT NULL,
    paper_mode_duration_days integer DEFAULT 3 NOT NULL,
    locked_persona_aspects jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text
);


--
-- Name: learning_proposals; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.learning_proposals (
    id text NOT NULL,
    tier integer NOT NULL,
    analyst_id text,
    instrument_id text,
    proposal_type text NOT NULL,
    description text NOT NULL,
    rationale text NOT NULL,
    proposed_change jsonb DEFAULT '{}'::jsonb NOT NULL,
    canonical_test_results jsonb,
    net_score integer,
    has_severity_regression boolean,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_at timestamp with time zone DEFAULT now() NOT NULL,
    tested_at timestamp with time zone,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    applied_at timestamp with time zone,
    llm_usage_id uuid,
    user_id text,
    evidence_summary jsonb,
    proposed_context_markdown text,
    current_context_markdown text,
    CONSTRAINT learning_proposals_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'testing'::text, 'passed'::text, 'failed'::text, 'approved'::text, 'rejected'::text, 'applied'::text, 'reverted'::text]))),
    CONSTRAINT learning_proposals_tier_check CHECK ((tier = ANY (ARRAY[1, 2, 3])))
);


--
-- Name: learning_queue; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.learning_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    suggested_scope_level text NOT NULL,
    suggested_domain text,
    suggested_universe_id uuid,
    suggested_target_id uuid,
    suggested_analyst_id uuid,
    suggested_learning_type text NOT NULL,
    suggested_title text NOT NULL,
    suggested_description text NOT NULL,
    suggested_config jsonb DEFAULT '{}'::jsonb,
    source_evaluation_id uuid,
    source_missed_opportunity_id uuid,
    ai_reasoning text NOT NULL,
    ai_confidence numeric(3,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by_user_id uuid,
    reviewer_notes text,
    final_scope_level text,
    final_domain text,
    final_universe_id uuid,
    final_target_id uuid,
    final_analyst_id uuid,
    learning_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT learning_queue_ai_confidence_check CHECK (((ai_confidence >= 0.00) AND (ai_confidence <= 1.00))),
    CONSTRAINT learning_queue_check CHECK (((status <> 'approved'::text) OR (learning_id IS NOT NULL))),
    CONSTRAINT learning_queue_final_scope_level_check CHECK (((final_scope_level IS NULL) OR (final_scope_level = ANY (ARRAY['runner'::text, 'domain'::text, 'universe'::text, 'target'::text])))),
    CONSTRAINT learning_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'modified'::text]))),
    CONSTRAINT learning_queue_suggested_learning_type_check CHECK ((suggested_learning_type = ANY (ARRAY['rule'::text, 'pattern'::text, 'weight_adjustment'::text, 'threshold'::text, 'avoid'::text]))),
    CONSTRAINT learning_queue_suggested_scope_level_check CHECK ((suggested_scope_level = ANY (ARRAY['runner'::text, 'domain'::text, 'universe'::text, 'target'::text])))
);


--
-- Name: TABLE learning_queue; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.learning_queue IS 'AI-suggested learnings pending human review (HITL)';


--
-- Name: COLUMN learning_queue.suggested_scope_level; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.suggested_scope_level IS 'AI-suggested scope level';


--
-- Name: COLUMN learning_queue.suggested_learning_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.suggested_learning_type IS 'AI-suggested learning type';


--
-- Name: COLUMN learning_queue.ai_reasoning; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.ai_reasoning IS 'AI explanation for why this learning is suggested';


--
-- Name: COLUMN learning_queue.ai_confidence; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.ai_confidence IS 'AI confidence in this suggestion (0.00-1.00)';


--
-- Name: COLUMN learning_queue.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.status IS 'Review status: pending, approved, rejected, modified';


--
-- Name: COLUMN learning_queue.reviewed_by_user_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.reviewed_by_user_id IS 'User who reviewed this suggestion';


--
-- Name: COLUMN learning_queue.final_scope_level; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.final_scope_level IS 'Final scope after human review (may differ from suggested)';


--
-- Name: COLUMN learning_queue.learning_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.learning_id IS 'Created learning if approved';


--
-- Name: COLUMN learning_queue.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learning_queue.is_test IS 'Flag indicating whether this learning suggestion is from test data';


--
-- Name: learning_reports; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.learning_reports (
    id text NOT NULL,
    report_type text NOT NULL,
    report_date date DEFAULT CURRENT_DATE NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_usage_id uuid,
    CONSTRAINT learning_reports_report_type_check CHECK ((report_type = ANY (ARRAY['nightly_evaluation'::text, 'learning_cycle'::text, 'audit_policy'::text])))
);


--
-- Name: learnings; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.learnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_level text DEFAULT 'runner'::text NOT NULL,
    domain text,
    universe_id uuid,
    target_id uuid,
    analyst_id uuid,
    learning_type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    source_type text DEFAULT 'human'::text NOT NULL,
    source_evaluation_id uuid,
    source_missed_opportunity_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    superseded_by uuid,
    version integer DEFAULT 1 NOT NULL,
    times_applied integer DEFAULT 0 NOT NULL,
    times_helpful integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT learnings_check CHECK (((scope_level = 'runner'::text) OR (domain IS NOT NULL))),
    CONSTRAINT learnings_check1 CHECK (((scope_level = ANY (ARRAY['runner'::text, 'domain'::text])) OR (universe_id IS NOT NULL))),
    CONSTRAINT learnings_check2 CHECK (((scope_level <> 'target'::text) OR (target_id IS NOT NULL))),
    CONSTRAINT learnings_check3 CHECK (((status <> 'superseded'::text) OR (superseded_by IS NOT NULL))),
    CONSTRAINT learnings_check4 CHECK ((times_helpful <= times_applied)),
    CONSTRAINT learnings_learning_type_check CHECK ((learning_type = ANY (ARRAY['rule'::text, 'pattern'::text, 'weight_adjustment'::text, 'threshold'::text, 'avoid'::text]))),
    CONSTRAINT learnings_scope_level_check CHECK ((scope_level = ANY (ARRAY['runner'::text, 'domain'::text, 'universe'::text, 'target'::text]))),
    CONSTRAINT learnings_source_type_check CHECK ((source_type = ANY (ARRAY['human'::text, 'ai_suggested'::text, 'ai_approved'::text]))),
    CONSTRAINT learnings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'disabled'::text])))
);


--
-- Name: TABLE learnings; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.learnings IS 'Accumulated insights and patterns from evaluations';


--
-- Name: COLUMN learnings.scope_level; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.scope_level IS 'Scope hierarchy level: runner (global) -> domain -> universe -> target';


--
-- Name: COLUMN learnings.domain; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.domain IS 'Domain (stocks, crypto, elections, polymarket) - required for domain+';


--
-- Name: COLUMN learnings.analyst_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.analyst_id IS 'Optional analyst-specific learning';


--
-- Name: COLUMN learnings.learning_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.learning_type IS 'Type: rule, pattern, weight_adjustment, threshold, avoid';


--
-- Name: COLUMN learnings.config; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.config IS 'Type-specific configuration (see examples in schema)';


--
-- Name: COLUMN learnings.source_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.source_type IS 'Origin: human, ai_suggested, ai_approved';


--
-- Name: COLUMN learnings.source_evaluation_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.source_evaluation_id IS 'Source evaluation if derived from evaluation';


--
-- Name: COLUMN learnings.source_missed_opportunity_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.source_missed_opportunity_id IS 'Source missed opportunity if derived from that';


--
-- Name: COLUMN learnings.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.status IS 'Status: active, superseded, disabled';


--
-- Name: COLUMN learnings.superseded_by; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.superseded_by IS 'Link to newer version if superseded';


--
-- Name: COLUMN learnings.version; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.version IS 'Version number for tracking iterations';


--
-- Name: COLUMN learnings.times_applied; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.times_applied IS 'Number of times this learning was applied';


--
-- Name: COLUMN learnings.times_helpful; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.times_helpful IS 'Number of times this learning was marked as helpful';


--
-- Name: COLUMN learnings.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.learnings.is_test IS 'Flag indicating whether this learning originated from test data (requires promotion to become production)';


--
-- Name: market_analysts; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_analysts (
    id text NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    persona_prompt text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text,
    analyst_type text DEFAULT 'personality'::text NOT NULL,
    default_weight numeric DEFAULT 1.0 NOT NULL,
    tier_instructions jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_system_default boolean DEFAULT false NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    workflow_scope text DEFAULT 'both'::text NOT NULL,
    domain_slug text DEFAULT 'financial'::text NOT NULL,
    universe_slug text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    current_config_version_id text,
    paper_config_version_id text,
    learning_enabled boolean DEFAULT true NOT NULL,
    memory_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
    memory_corrections jsonb DEFAULT '[]'::jsonb NOT NULL,
    memory_instrument_notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    memory_calibration jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id text
);


--
-- Name: market_articles; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_articles (
    id text NOT NULL,
    external_article_id text NOT NULL,
    external_source_id text NOT NULL,
    source_id text NOT NULL,
    source_origin text DEFAULT 'orchestrator_crawler'::text NOT NULL,
    external_source_slug text DEFAULT '__base__'::text,
    title text,
    url text NOT NULL,
    summary text,
    author text,
    content text,
    content_hash text,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_instrument_analyst_assignments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_instrument_analyst_assignments (
    instrument_id text NOT NULL,
    analyst_id text NOT NULL,
    assigned_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    weight_override numeric
);


--
-- Name: market_predictions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_predictions (
    id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    predicted_direction text NOT NULL,
    confidence numeric NOT NULL,
    horizon_minutes integer NOT NULL,
    rationale text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    analyst_id text,
    role text DEFAULT 'analyst'::text NOT NULL,
    lineage_json jsonb,
    key_factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    risks jsonb DEFAULT '[]'::jsonb NOT NULL,
    config_version_id text,
    is_paper boolean DEFAULT false NOT NULL,
    source_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    settled_at timestamp with time zone,
    trade_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    llm_usage_id uuid,
    CONSTRAINT market_predictions_predicted_direction_check CHECK ((predicted_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: market_predictors; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_predictors (
    id text NOT NULL,
    instrument_id text NOT NULL,
    article_id text NOT NULL,
    relevance_score numeric NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    rationale text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scored_by_analyst_id text,
    llm_usage_id uuid,
    crowd_reaction text,
    crowd_reaction_confidence numeric,
    crowd_reaction_rationale text,
    estimated_reaction_window_minutes integer,
    CONSTRAINT market_predictors_relevance_score_check CHECK (((relevance_score >= (0)::numeric) AND (relevance_score <= (1)::numeric))),
    CONSTRAINT market_predictors_status_check CHECK ((status = ANY (ARRAY['active'::text, 'dismissed'::text, 'expired'::text])))
);


--
-- Name: market_risk_assessments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_risk_assessments (
    id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    risk_score numeric NOT NULL,
    verdict text NOT NULL,
    rationale text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    analyst_id text,
    role text DEFAULT 'composite'::text NOT NULL,
    CONSTRAINT market_risk_assessments_verdict_check CHECK ((verdict = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: market_run_artifacts; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_run_artifacts (
    id text NOT NULL,
    run_id text NOT NULL,
    run_type text NOT NULL,
    analyst_id text,
    model_provider text NOT NULL,
    model_name text NOT NULL,
    prompt text NOT NULL,
    output_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'analyst'::text NOT NULL,
    CONSTRAINT market_run_artifacts_run_type_check CHECK ((run_type = ANY (ARRAY['risk'::text, 'prediction'::text])))
);


--
-- Name: market_run_evaluations; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_run_evaluations (
    id text NOT NULL,
    run_id text NOT NULL,
    actual_direction text NOT NULL,
    predicted_direction text,
    was_correct boolean,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_run_evaluations_actual_direction_check CHECK ((actual_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text]))),
    CONSTRAINT market_run_evaluations_predicted_direction_check CHECK ((predicted_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: market_run_replays; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.market_run_replays (
    id text NOT NULL,
    run_id text NOT NULL,
    scenario text NOT NULL,
    replay_output text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: missed_opportunities; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.missed_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    move_type text NOT NULL,
    move_start_at timestamp with time zone NOT NULL,
    move_end_at timestamp with time zone NOT NULL,
    start_value numeric(20,8) NOT NULL,
    end_value numeric(20,8) NOT NULL,
    percent_change numeric(10,4) NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    detection_method text NOT NULL,
    discovered_drivers jsonb DEFAULT '[]'::jsonb,
    signals_we_had jsonb DEFAULT '[]'::jsonb,
    signals_we_missed jsonb DEFAULT '[]'::jsonb,
    source_gaps jsonb DEFAULT '[]'::jsonb,
    suggested_learnings jsonb DEFAULT '[]'::jsonb,
    analysis_status text DEFAULT 'pending'::text NOT NULL,
    analysis_error text,
    llm_usage_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    CONSTRAINT missed_opportunities_analysis_status_check CHECK ((analysis_status = ANY (ARRAY['pending'::text, 'analyzing'::text, 'complete'::text, 'failed'::text]))),
    CONSTRAINT missed_opportunities_move_type_check CHECK ((move_type = ANY (ARRAY['significant_up'::text, 'significant_down'::text, 'breakout'::text, 'breakdown'::text])))
);


--
-- Name: TABLE missed_opportunities; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.missed_opportunities IS 'Significant moves without predictions';


--
-- Name: COLUMN missed_opportunities.move_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.missed_opportunities.move_type IS 'Type of price/value movement';


--
-- Name: COLUMN missed_opportunities.discovered_drivers; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.missed_opportunities.discovered_drivers IS 'What caused this move (AI analysis)';


--
-- Name: COLUMN missed_opportunities.source_gaps; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.missed_opportunities.source_gaps IS 'Missing data sources identified';


--
-- Name: COLUMN missed_opportunities.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.missed_opportunities.is_test IS 'Flag indicating whether this missed opportunity is from test scenario';


--
-- Name: notifications; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.notifications (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    event_type text NOT NULL,
    urgency text NOT NULL,
    title text NOT NULL,
    summary text,
    link_to text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_urgency_check CHECK ((urgency = ANY (ARRAY['immediate'::text, 'actionable'::text, 'informational'::text])))
);


--
-- Name: orchestration_runs; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.orchestration_runs (
    id text NOT NULL,
    instrument_id text NOT NULL,
    run_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    requested_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_error text,
    CONSTRAINT orchestration_runs_run_type_check CHECK ((run_type = ANY (ARRAY['risk'::text, 'prediction'::text]))),
    CONSTRAINT orchestration_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: position_sizing_config; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.position_sizing_config (
    id text NOT NULL,
    tier_name text NOT NULL,
    min_confidence numeric NOT NULL,
    max_confidence numeric NOT NULL,
    position_percent numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prediction_challenges; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.prediction_challenges (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    prediction_id text NOT NULL,
    challenged_analyst_id text NOT NULL,
    challenger_analyst_id text NOT NULL,
    instrument_id text NOT NULL,
    counter_argument text NOT NULL,
    counter_direction text,
    counter_confidence numeric,
    evidence jsonb DEFAULT '[]'::jsonb,
    model_provider text,
    model_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_usage_id uuid,
    user_id text,
    CONSTRAINT prediction_challenges_counter_direction_check CHECK ((counter_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: prediction_horizon_evaluations; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.prediction_horizon_evaluations (
    id text NOT NULL,
    prediction_id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    analyst_id text,
    horizon_window integer NOT NULL,
    prediction_date timestamp with time zone NOT NULL,
    evaluation_date timestamp with time zone NOT NULL,
    predicted_direction text NOT NULL,
    actual_direction text NOT NULL,
    actual_outcome_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    was_correct boolean NOT NULL,
    confidence_at_prediction numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prediction_horizon_evaluations_actual_direction_check CHECK ((actual_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text]))),
    CONSTRAINT prediction_horizon_evaluations_predicted_direction_check CHECK ((predicted_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: predictions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    task_id uuid,
    direction text NOT NULL,
    confidence numeric(3,2) NOT NULL,
    magnitude text,
    reasoning text NOT NULL,
    timeframe_hours integer NOT NULL,
    predicted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    entry_price numeric(20,8),
    target_price numeric(20,8),
    stop_loss numeric(20,8),
    analyst_ensemble jsonb NOT NULL,
    llm_ensemble jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    outcome_value numeric(20,8),
    outcome_captured_at timestamp with time zone,
    resolution_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    scenario_run_id uuid,
    recommended_quantity numeric(20,8),
    quantity_reasoning text,
    runner_context_version_id uuid,
    analyst_context_version_ids jsonb DEFAULT '{}'::jsonb,
    universe_context_version_id uuid,
    target_context_version_id uuid,
    analyst_slug text,
    is_arbitrator boolean DEFAULT false,
    context_mode text DEFAULT 'combined'::text,
    CONSTRAINT predictions_confidence_check CHECK (((confidence >= 0.00) AND (confidence <= 1.00))),
    CONSTRAINT predictions_context_mode_check CHECK ((context_mode = ANY (ARRAY['user'::text, 'ai'::text, 'arbitrator'::text, 'combined'::text]))),
    CONSTRAINT predictions_magnitude_check CHECK (((magnitude IS NULL) OR (magnitude = ANY (ARRAY['small'::text, 'medium'::text, 'large'::text])))),
    CONSTRAINT predictions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: TABLE predictions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.predictions IS 'Final predictions generated from predictor ensemble';


--
-- Name: COLUMN predictions.task_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.task_id IS 'ExecutionContext task ID for observability';


--
-- Name: COLUMN predictions.direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.direction IS 'Outcome: up, down, flat (stocks/crypto) or yes, no, uncertain (elections)';


--
-- Name: COLUMN predictions.analyst_ensemble; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.analyst_ensemble IS 'All analyst assessments';


--
-- Name: COLUMN predictions.llm_ensemble; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.llm_ensemble IS 'All LLM tier results';


--
-- Name: COLUMN predictions.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.status IS 'Lifecycle: active, resolved, expired, cancelled';


--
-- Name: COLUMN predictions.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.is_test IS 'Flag indicating this is test data, excluded from production analytics';


--
-- Name: COLUMN predictions.scenario_run_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.scenario_run_id IS 'Links to test scenario run (prediction.scenario_runs), nullable until FK added';


--
-- Name: COLUMN predictions.recommended_quantity; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.recommended_quantity IS 'System-recommended position size based on confidence and risk';


--
-- Name: COLUMN predictions.quantity_reasoning; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.quantity_reasoning IS 'Explanation for recommended position size';


--
-- Name: COLUMN predictions.analyst_context_version_ids; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.analyst_context_version_ids IS 'Map of analyst_id to context version used for this prediction';


--
-- Name: COLUMN predictions.analyst_slug; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.analyst_slug IS 'Slug of the analyst who made this prediction (null for aggregated/legacy predictions)';


--
-- Name: COLUMN predictions.is_arbitrator; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.is_arbitrator IS 'True if this is a synthesized arbitrator prediction combining all analyst opinions';


--
-- Name: COLUMN predictions.context_mode; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictions.context_mode IS 'Which context produced this prediction: user (user section only), ai (ai section only), arbitrator (combined with arbitration), combined (legacy)';


--
-- Name: predictors; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.predictors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    direction text NOT NULL,
    strength integer NOT NULL,
    confidence numeric(3,2) NOT NULL,
    reasoning text NOT NULL,
    analyst_slug text NOT NULL,
    analyst_assessment jsonb NOT NULL,
    llm_usage_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    consumed_at timestamp with time zone,
    consumed_by_prediction_id uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    scenario_run_id uuid,
    article_id uuid,
    fork_type text,
    CONSTRAINT predictors_check CHECK (((status <> 'consumed'::text) OR ((consumed_at IS NOT NULL) AND (consumed_by_prediction_id IS NOT NULL)))),
    CONSTRAINT predictors_confidence_check CHECK (((confidence >= 0.00) AND (confidence <= 1.00))),
    CONSTRAINT predictors_status_check CHECK ((status = ANY (ARRAY['active'::text, 'consumed'::text, 'expired'::text, 'invalidated'::text]))),
    CONSTRAINT predictors_strength_check CHECK (((strength >= 1) AND (strength <= 10)))
);


--
-- Name: TABLE predictors; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.predictors IS 'Evaluated signals that may contribute to predictions';


--
-- Name: COLUMN predictors.direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.direction IS 'Sentiment: bullish, bearish, neutral';


--
-- Name: COLUMN predictors.strength; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.strength IS 'Strength 1-10';


--
-- Name: COLUMN predictors.analyst_assessment; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.analyst_assessment IS 'Full analyst evaluation details';


--
-- Name: COLUMN predictors.llm_usage_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.llm_usage_id IS 'FK to public.llm_usage for cost tracking';


--
-- Name: COLUMN predictors.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.status IS 'Lifecycle: active, consumed, expired, invalidated';


--
-- Name: COLUMN predictors.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.is_test IS 'Flag to distinguish test/synthetic data from production data';


--
-- Name: COLUMN predictors.scenario_run_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.scenario_run_id IS 'Links to specific test scenario run (FK to prediction.scenario_runs, added later)';


--
-- Name: COLUMN predictors.article_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.article_id IS 'Direct reference to crawler.articles - new flow creates predictors from articles without signals intermediate';


--
-- Name: COLUMN predictors.fork_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.predictors.fork_type IS 'Fork type for per-analyst predictors: user, ai, or arbitrator';


--
-- Name: replay_test_results; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.replay_test_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    replay_test_id uuid NOT NULL,
    target_id uuid,
    original_prediction_id uuid,
    original_direction text,
    original_confidence numeric(5,4),
    original_magnitude text,
    original_predicted_at timestamp with time zone,
    replay_prediction_id uuid,
    replay_direction text,
    replay_confidence numeric(5,4),
    replay_magnitude text,
    replay_predicted_at timestamp with time zone,
    direction_match boolean,
    confidence_diff numeric(5,4),
    evaluation_id uuid,
    actual_outcome text,
    actual_outcome_value numeric(20,8),
    original_correct boolean,
    replay_correct boolean,
    improvement boolean,
    pnl_original numeric(20,8),
    pnl_replay numeric(20,8),
    pnl_diff numeric(20,8),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE replay_test_results; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.replay_test_results IS 'Stores per-prediction comparison results from replay tests';


--
-- Name: replay_test_snapshots; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.replay_test_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    replay_test_id uuid NOT NULL,
    table_name text NOT NULL,
    original_data jsonb NOT NULL,
    record_ids uuid[] NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT replay_test_snapshots_table_name_check CHECK ((table_name = ANY (ARRAY['signals'::text, 'predictors'::text, 'predictions'::text, 'analyst_assessments'::text])))
);


--
-- Name: TABLE replay_test_snapshots; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.replay_test_snapshots IS 'Stores snapshots of original data before replay test deletion';


--
-- Name: review_queue; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_id uuid NOT NULL,
    original_direction text NOT NULL,
    original_confidence numeric(3,2) NOT NULL,
    original_reasoning text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by_user_id uuid,
    response_direction text,
    response_strength integer,
    response_notes text,
    create_learning boolean DEFAULT false,
    predictor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    CONSTRAINT review_queue_original_confidence_check CHECK (((original_confidence >= 0.00) AND (original_confidence <= 1.00))),
    CONSTRAINT review_queue_response_strength_check CHECK (((response_strength IS NULL) OR ((response_strength >= 1) AND (response_strength <= 10)))),
    CONSTRAINT review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'modified'::text])))
);


--
-- Name: TABLE review_queue; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.review_queue IS 'HITL review queue for signals with moderate confidence';


--
-- Name: COLUMN review_queue.signal_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.signal_id IS 'Signal requiring human review';


--
-- Name: COLUMN review_queue.original_direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.original_direction IS 'AI-assessed direction';


--
-- Name: COLUMN review_queue.original_confidence; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.original_confidence IS 'AI confidence level (0.00-1.00)';


--
-- Name: COLUMN review_queue.original_reasoning; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.original_reasoning IS 'AI reasoning for the assessment';


--
-- Name: COLUMN review_queue.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.status IS 'Review status: pending, approved, rejected, modified';


--
-- Name: COLUMN review_queue.response_direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.response_direction IS 'Human-override direction (if modified)';


--
-- Name: COLUMN review_queue.response_strength; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.response_strength IS 'Human-override strength 1-10 (if modified)';


--
-- Name: COLUMN review_queue.create_learning; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.create_learning IS 'Whether to create a learning from this review';


--
-- Name: COLUMN review_queue.predictor_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.review_queue.predictor_id IS 'Created predictor if approved';


--
-- Name: risk_composite_scores; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.risk_composite_scores (
    id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    overall_score integer NOT NULL,
    dimension_scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    debate_id text,
    debate_adjustment integer DEFAULT 0 NOT NULL,
    pre_debate_score integer,
    confidence numeric(3,2) NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_composite_scores_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT risk_composite_scores_overall_score_check CHECK (((overall_score >= 0) AND (overall_score <= 100))),
    CONSTRAINT risk_composite_scores_pre_debate_score_check CHECK (((pre_debate_score >= 0) AND (pre_debate_score <= 100))),
    CONSTRAINT risk_composite_scores_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text])))
);


--
-- Name: risk_debate_contexts; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.risk_debate_contexts (
    id text NOT NULL,
    domain_slug text DEFAULT 'financial'::text NOT NULL,
    role text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    system_prompt text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    CONSTRAINT risk_debate_contexts_role_check CHECK ((role = ANY (ARRAY['blue'::text, 'red'::text, 'arbiter'::text])))
);


--
-- Name: risk_debates; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.risk_debates (
    id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    composite_score_id text,
    blue_assessment jsonb DEFAULT '{}'::jsonb NOT NULL,
    red_challenges jsonb DEFAULT '{}'::jsonb NOT NULL,
    arbiter_synthesis jsonb DEFAULT '{}'::jsonb NOT NULL,
    original_score integer,
    final_score integer,
    score_adjustment integer DEFAULT 0 NOT NULL,
    transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    llm_usage_id uuid,
    CONSTRAINT risk_debates_final_score_check CHECK (((final_score >= 0) AND (final_score <= 100))),
    CONSTRAINT risk_debates_original_score_check CHECK (((original_score >= 0) AND (original_score <= 100))),
    CONSTRAINT risk_debates_score_adjustment_check CHECK (((score_adjustment >= '-30'::integer) AND (score_adjustment <= 30))),
    CONSTRAINT risk_debates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: risk_dimension_assessments; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.risk_dimension_assessments (
    id text NOT NULL,
    run_id text NOT NULL,
    instrument_id text NOT NULL,
    dimension_id text NOT NULL,
    score integer NOT NULL,
    confidence numeric(3,2) NOT NULL,
    reasoning text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    model_provider text,
    model_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    llm_usage_id uuid,
    CONSTRAINT risk_dimension_assessments_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT risk_dimension_assessments_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: risk_dimensions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.risk_dimensions (
    id text NOT NULL,
    domain_slug text DEFAULT 'financial'::text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    weight numeric(3,2) DEFAULT 0.25 NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    system_prompt text,
    output_schema jsonb DEFAULT '{"type": "object", "required": ["score", "confidence", "reasoning"], "properties": {"score": {"type": "integer", "maximum": 100, "minimum": 0}, "evidence": {"type": "array", "items": {"type": "string"}}, "reasoning": {"type": "string"}, "confidence": {"type": "number", "maximum": 1, "minimum": 0}}}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text,
    CONSTRAINT risk_dimensions_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (2)::numeric)))
);


--
-- Name: runner_context_versions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.runner_context_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    runner_type text NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    context text,
    model_config jsonb DEFAULT '{}'::jsonb,
    learning_config jsonb DEFAULT '{}'::jsonb,
    risk_profile text DEFAULT 'moderate'::text,
    change_reason text,
    changed_by text DEFAULT 'system'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runner_context_versions_changed_by_check CHECK ((changed_by = ANY (ARRAY['system'::text, 'user'::text, 'learning_loop'::text])))
);


--
-- Name: TABLE runner_context_versions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.runner_context_versions IS 'Version history for prediction runner configurations';


--
-- Name: COLUMN runner_context_versions.runner_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.runner_context_versions.runner_type IS 'Runner type identifier (stock-predictor, crypto-predictor, etc.)';


--
-- Name: COLUMN runner_context_versions.is_current; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.runner_context_versions.is_current IS 'Whether this is the current active version';


--
-- Name: service_api_keys; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.service_api_keys (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    label text NOT NULL,
    allowed_machine_identities text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{*}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone
);


--
-- Name: signals; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    source_id uuid NOT NULL,
    content text NOT NULL,
    direction text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    disposition text DEFAULT 'pending'::text NOT NULL,
    urgency text,
    processing_worker uuid,
    processing_started_at timestamp with time zone,
    evaluation_result jsonb,
    review_queue_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expired_at timestamp with time zone,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    scenario_run_id uuid,
    CONSTRAINT signals_disposition_check CHECK ((disposition = ANY (ARRAY['pending'::text, 'processing'::text, 'predictor_created'::text, 'rejected'::text, 'review_pending'::text, 'expired'::text]))),
    CONSTRAINT signals_urgency_check CHECK (((urgency IS NULL) OR (urgency = ANY (ARRAY['urgent'::text, 'notable'::text, 'routine'::text]))))
);


--
-- Name: TABLE signals; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.signals IS 'Raw signals from sources awaiting evaluation';


--
-- Name: COLUMN signals.direction; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.direction IS 'Sentiment: bullish, bearish, neutral';


--
-- Name: COLUMN signals.disposition; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.disposition IS 'Processing state';


--
-- Name: COLUMN signals.urgency; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.urgency IS 'Urgency level after evaluation';


--
-- Name: COLUMN signals.processing_worker; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.processing_worker IS 'Worker ID for race condition handling';


--
-- Name: COLUMN signals.evaluation_result; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.evaluation_result IS 'Analyst evaluation results';


--
-- Name: COLUMN signals.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.is_test IS 'True for test/synthetic signals, false for production signals';


--
-- Name: COLUMN signals.scenario_run_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.signals.scenario_run_id IS 'Links test signals to specific scenario runs (FK to prediction.scenario_runs - will be added when that table exists)';


--
-- Name: snapshots; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prediction_id uuid NOT NULL,
    predictors jsonb NOT NULL,
    rejected_signals jsonb DEFAULT '[]'::jsonb,
    analyst_predictions jsonb NOT NULL,
    llm_ensemble jsonb NOT NULL,
    learnings_applied jsonb DEFAULT '[]'::jsonb,
    threshold_evaluation jsonb NOT NULL,
    timeline jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid
);


--
-- Name: TABLE snapshots; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.snapshots IS 'Full state capture for prediction explainability';


--
-- Name: COLUMN snapshots.predictors; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.predictors IS 'All predictors that contributed to this prediction';


--
-- Name: COLUMN snapshots.rejected_signals; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.rejected_signals IS 'Signals considered but rejected (with reasons)';


--
-- Name: COLUMN snapshots.analyst_predictions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.analyst_predictions IS 'Each analyst individual assessment';


--
-- Name: COLUMN snapshots.llm_ensemble; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.llm_ensemble IS 'Each LLM tier assessment';


--
-- Name: COLUMN snapshots.learnings_applied; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.learnings_applied IS 'Learnings that influenced this prediction';


--
-- Name: COLUMN snapshots.threshold_evaluation; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.threshold_evaluation IS 'Details of threshold evaluation';


--
-- Name: COLUMN snapshots.timeline; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.snapshots.timeline IS 'Complete timeline of prediction generation';


--
-- Name: source_catalog; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.source_catalog (
    id text NOT NULL,
    source_key text NOT NULL,
    display_name text NOT NULL,
    base_url text,
    tier text DEFAULT 'standard'::text NOT NULL,
    is_global_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_origin text DEFAULT 'divinr'::text NOT NULL,
    external_source_id text,
    domain_slug text DEFAULT 'financial'::text NOT NULL,
    universe_slug text,
    source_type text DEFAULT 'rss'::text,
    crawl_frequency_minutes integer DEFAULT 60,
    last_crawled_at timestamp with time zone,
    last_crawl_error text
);


--
-- Name: source_subscriptions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.source_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    target_id uuid NOT NULL,
    universe_id uuid NOT NULL,
    filter_config jsonb DEFAULT '{"keywords_exclude": [], "keywords_include": [], "min_relevance_score": 0.5}'::jsonb,
    last_processed_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE source_subscriptions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.source_subscriptions IS 'Links prediction targets to crawler sources';


--
-- Name: COLUMN source_subscriptions.source_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.source_subscriptions.source_id IS 'Reference to crawler.sources';


--
-- Name: COLUMN source_subscriptions.target_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.source_subscriptions.target_id IS 'Prediction target this subscription is for';


--
-- Name: COLUMN source_subscriptions.filter_config; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.source_subscriptions.filter_config IS 'Keywords and filters for article relevance';


--
-- Name: COLUMN source_subscriptions.last_processed_at; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.source_subscriptions.last_processed_at IS 'Watermark for pull model - articles newer than this are pending';


--
-- Name: strategies; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.strategies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    risk_level text NOT NULL,
    thresholds jsonb DEFAULT '{"min_predictors": 3, "signal_ttl_hours": 48, "predictor_ttl_hours": 72, "min_combined_strength": 15, "review_confidence_max": 0.70, "review_confidence_min": 0.40, "min_direction_consensus": 0.7, "urgent_confidence_threshold": 0.90, "notable_confidence_threshold": 0.70}'::jsonb NOT NULL,
    analyst_weights jsonb DEFAULT '{}'::jsonb,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    CONSTRAINT strategies_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: TABLE strategies; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.strategies IS 'Pre-defined investment strategies controlling prediction behavior';


--
-- Name: COLUMN strategies.slug; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.strategies.slug IS 'URL-friendly unique identifier';


--
-- Name: COLUMN strategies.risk_level; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.strategies.risk_level IS 'Risk level: low, medium, high';


--
-- Name: COLUMN strategies.thresholds; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.strategies.thresholds IS 'Threshold configuration for prediction generation';


--
-- Name: COLUMN strategies.analyst_weights; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.strategies.analyst_weights IS 'Per-analyst weight adjustments for this strategy';


--
-- Name: COLUMN strategies.is_system; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.strategies.is_system IS 'System strategies cannot be deleted';


--
-- Name: target_context_versions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.target_context_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    context text,
    metadata jsonb DEFAULT '{}'::jsonb,
    llm_config_override jsonb,
    change_reason text,
    changed_by text DEFAULT 'system'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT target_context_versions_changed_by_check CHECK ((changed_by = ANY (ARRAY['system'::text, 'user'::text, 'learning_loop'::text])))
);


--
-- Name: TABLE target_context_versions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.target_context_versions IS 'Version history for target configurations';


--
-- Name: target_snapshots; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.target_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_id uuid NOT NULL,
    value numeric(20,8) NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    value_type text DEFAULT 'price'::text NOT NULL,
    source text DEFAULT 'other'::text NOT NULL,
    CONSTRAINT chk_target_snapshots_source CHECK ((source = ANY (ARRAY['polygon'::text, 'coingecko'::text, 'coinmarketcap'::text, 'polymarket'::text, 'manual'::text, 'other'::text]))),
    CONSTRAINT chk_target_snapshots_value_type CHECK ((value_type = ANY (ARRAY['price'::text, 'probability'::text, 'index'::text, 'other'::text])))
);


--
-- Name: TABLE target_snapshots; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.target_snapshots IS 'Price/value history for targets';


--
-- Name: COLUMN target_snapshots.value; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.target_snapshots.value IS 'Price or probability value';


--
-- Name: COLUMN target_snapshots.is_test; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.target_snapshots.is_test IS 'Flag indicating whether this snapshot is from test data';


--
-- Name: COLUMN target_snapshots.value_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.target_snapshots.value_type IS 'Type of value: price, probability, index, or other';


--
-- Name: COLUMN target_snapshots.source; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.target_snapshots.source IS 'Data source: polygon, coingecko, polymarket, manual, or other';


--
-- Name: targets; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    universe_id uuid NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    target_type text NOT NULL,
    context text,
    metadata jsonb DEFAULT '{}'::jsonb,
    llm_config_override jsonb,
    is_active boolean DEFAULT true NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    current_price numeric,
    price_updated_at timestamp with time zone
);


--
-- Name: TABLE targets; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.targets IS 'Individual prediction targets within universes';


--
-- Name: COLUMN targets.universe_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.universe_id IS 'Parent universe ID';


--
-- Name: COLUMN targets.symbol; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.symbol IS 'Target symbol (AAPL, BTC-USD, etc.)';


--
-- Name: COLUMN targets.target_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.target_type IS 'Target type: stock, crypto, election, polymarket (must match universe.domain)';


--
-- Name: COLUMN targets.context; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.context IS 'Additional LLM context about this target';


--
-- Name: COLUMN targets.llm_config_override; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.llm_config_override IS 'LLM config override (highest priority)';


--
-- Name: COLUMN targets.current_price; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.current_price IS 'Cached current price, updated when snapshots are captured';


--
-- Name: COLUMN targets.price_updated_at; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.targets.price_updated_at IS 'Timestamp when current_price was last updated';


--
-- Name: tenant_source_entitlements; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.tenant_source_entitlements (
    source_id text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    override_notes text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: test_target_mirrors; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.test_target_mirrors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    real_target_id uuid NOT NULL,
    test_target_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_different_targets CHECK ((real_target_id <> test_target_id))
);


--
-- Name: TABLE test_target_mirrors; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.test_target_mirrors IS 'Maps real targets to their T_ prefixed test mirrors (INV-11)';


--
-- Name: COLUMN test_target_mirrors.real_target_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.test_target_mirrors.real_target_id IS 'Reference to the real (production) target';


--
-- Name: COLUMN test_target_mirrors.test_target_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.test_target_mirrors.test_target_id IS 'Reference to the T_ prefixed test mirror target';


--
-- Name: tool_requests; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.tool_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    universe_id uuid NOT NULL,
    tool_type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    source_type text,
    suggested_config jsonb,
    missed_opportunity_id uuid,
    status text DEFAULT 'wishlist'::text NOT NULL,
    user_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_test_data boolean DEFAULT false,
    test_scenario_id uuid,
    priority text DEFAULT 'medium'::text NOT NULL,
    rationale text,
    resolved_at timestamp with time zone,
    resolved_by_user_id uuid,
    resolution_notes text,
    name text NOT NULL,
    CONSTRAINT tool_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT tool_requests_status_check CHECK ((status = ANY (ARRAY['wishlist'::text, 'planned'::text, 'in_progress'::text, 'done'::text, 'rejected'::text]))),
    CONSTRAINT tool_requests_tool_type_check CHECK ((tool_type = ANY (ARRAY['source'::text, 'integration'::text, 'analyst'::text, 'other'::text])))
);


--
-- Name: TABLE tool_requests; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.tool_requests IS 'Source/tool wishlist from analysis';


--
-- Name: COLUMN tool_requests.tool_type; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.tool_type IS 'Type: source, integration, analyst, other';


--
-- Name: COLUMN tool_requests.status; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.status IS 'Status: wishlist, planned, in_progress, done, rejected';


--
-- Name: COLUMN tool_requests.priority; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.priority IS 'Request priority: low, medium, high, critical';


--
-- Name: COLUMN tool_requests.rationale; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.rationale IS 'Reason/justification for this tool request';


--
-- Name: COLUMN tool_requests.resolved_at; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.resolved_at IS 'Timestamp when request was resolved (done/rejected)';


--
-- Name: COLUMN tool_requests.resolved_by_user_id; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.resolved_by_user_id IS 'User who resolved this request';


--
-- Name: COLUMN tool_requests.resolution_notes; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON COLUMN prediction.tool_requests.resolution_notes IS 'Notes about the resolution';


--
-- Name: universe_context_versions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.universe_context_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    universe_id uuid NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    description text,
    llm_config jsonb DEFAULT '{}'::jsonb,
    thresholds jsonb DEFAULT '{}'::jsonb,
    change_reason text,
    changed_by text DEFAULT 'system'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT universe_context_versions_changed_by_check CHECK ((changed_by = ANY (ARRAY['system'::text, 'user'::text, 'learning_loop'::text])))
);


--
-- Name: TABLE universe_context_versions; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON TABLE prediction.universe_context_versions IS 'Version history for universe configurations';


--
-- Name: universes; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.universes (
    slug text NOT NULL,
    domain_slug text NOT NULL,
    display_name text NOT NULL,
    description text,
    default_evaluation_horizons jsonb DEFAULT '[1, 3, 5]'::jsonb NOT NULL,
    horizon_unit text DEFAULT 'days'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT universes_horizon_unit_check CHECK ((horizon_unit = ANY (ARRAY['hours'::text, 'days'::text, 'weeks'::text])))
);


--
-- Name: user_affinity_signals; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_affinity_signals (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    analyst_id text NOT NULL,
    signal_type text NOT NULL,
    prediction_id text,
    instrument_id text,
    weight numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_affinity_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['buy_agreement'::text, 'sell_agreement'::text, 'skip_disagreement'::text, 'challenge_accept'::text, 'challenge_reject'::text, 'browse_interest'::text])))
);


--
-- Name: user_analyst_affinity; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_analyst_affinity (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    analyst_id text NOT NULL,
    affinity_score numeric DEFAULT 0.5 NOT NULL,
    signal_count integer DEFAULT 0 NOT NULL,
    buy_agreement integer DEFAULT 0 NOT NULL,
    skip_disagreement integer DEFAULT 0 NOT NULL,
    challenge_accept integer DEFAULT 0 NOT NULL,
    challenge_reject integer DEFAULT 0 NOT NULL,
    browse_signals integer DEFAULT 0 NOT NULL,
    last_signal_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_contrarian_alerts; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_contrarian_alerts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    analyst_id text NOT NULL,
    prediction_id text NOT NULL,
    instrument_id text NOT NULL,
    symbol text NOT NULL,
    user_weighted_direction text NOT NULL,
    contrarian_direction text NOT NULL,
    contrarian_confidence numeric NOT NULL,
    affinity_score_at_alert numeric NOT NULL,
    rationale text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_contrarian_alerts_contrarian_direction_check CHECK ((contrarian_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text]))),
    CONSTRAINT user_contrarian_alerts_user_weighted_direction_check CHECK ((user_weighted_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: user_decision_outcomes; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_decision_outcomes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    decision_id text NOT NULL,
    horizon_days integer NOT NULL,
    price_at_decision numeric NOT NULL,
    price_at_horizon numeric,
    actual_direction text,
    pnl_if_taken numeric,
    pnl_actual numeric,
    evaluated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_decision_outcomes_actual_direction_check CHECK ((actual_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))
);


--
-- Name: user_portfolios; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_portfolios (
    id text NOT NULL,
    user_id text NOT NULL,
    initial_balance numeric DEFAULT 1000000 NOT NULL,
    current_balance numeric DEFAULT 1000000 NOT NULL,
    total_realized_pnl numeric DEFAULT 0 NOT NULL,
    total_unrealized_pnl numeric DEFAULT 0 NOT NULL,
    disclaimer_acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_positions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_positions (
    id text NOT NULL,
    portfolio_id text NOT NULL,
    user_id text NOT NULL,
    prediction_id text,
    instrument_id text NOT NULL,
    symbol text NOT NULL,
    direction text NOT NULL,
    quantity integer NOT NULL,
    entry_price numeric NOT NULL,
    current_price numeric NOT NULL,
    exit_price numeric,
    unrealized_pnl numeric DEFAULT 0 NOT NULL,
    realized_pnl numeric,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trigger_reason text DEFAULT 'manual'::text NOT NULL,
    trigger_prediction_id text,
    CONSTRAINT user_positions_direction_check CHECK ((direction = ANY (ARRAY['long'::text, 'short'::text]))),
    CONSTRAINT user_positions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    CONSTRAINT user_positions_trigger_reason_check CHECK ((trigger_reason = ANY (ARRAY['manual'::text, 'eod_sweep'::text])))
);


--
-- Name: user_trade_decisions; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_trade_decisions (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    prediction_id text NOT NULL,
    instrument_id text NOT NULL,
    symbol text NOT NULL,
    decision text NOT NULL,
    based_on_analyst_id text,
    trade_queue_id text,
    confidence_at_decision numeric,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_trade_decisions_decision_check CHECK ((decision = ANY (ARRAY['buy'::text, 'sell'::text, 'skip'::text])))
);


--
-- Name: user_trade_queue; Type: TABLE; Schema: prediction; Owner: -
--

CREATE TABLE prediction.user_trade_queue (
    id text NOT NULL,
    user_id text NOT NULL,
    portfolio_id text NOT NULL,
    prediction_id text NOT NULL,
    instrument_id text NOT NULL,
    symbol text NOT NULL,
    direction text NOT NULL,
    quantity integer NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    executed_position_id text,
    execution_price numeric,
    executed_at timestamp with time zone,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_trade_queue_direction_check CHECK ((direction = ANY (ARRAY['long'::text, 'short'::text]))),
    CONSTRAINT user_trade_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'executed'::text, 'cancelled'::text])))
);


--
-- Name: v_analytics_accuracy_comparison; Type: VIEW; Schema: prediction; Owner: -
--

CREATE VIEW prediction.v_analytics_accuracy_comparison AS
 WITH daily_predictions AS (
         SELECT (date_trunc('day'::text, p.predicted_at))::date AS period_date,
            p.is_test,
            p.id AS prediction_id,
            p.confidence,
            e.direction_correct,
            e.overall_score,
            p.status
           FROM (prediction.predictions p
             LEFT JOIN prediction.evaluations e ON ((e.prediction_id = p.id)))
          WHERE (p.predicted_at IS NOT NULL)
        ), aggregated_stats AS (
         SELECT daily_predictions.period_date,
            daily_predictions.is_test,
            count(*) AS total_predictions,
            count(*) FILTER (WHERE (daily_predictions.status = 'resolved'::text)) AS resolved_predictions,
            count(*) FILTER (WHERE (daily_predictions.direction_correct = true)) AS correct_predictions,
            avg(daily_predictions.confidence) AS avg_confidence,
            avg(daily_predictions.overall_score) AS avg_overall_score
           FROM daily_predictions
          GROUP BY daily_predictions.period_date, daily_predictions.is_test
        )
 SELECT period_date,
    is_test,
    total_predictions,
    resolved_predictions,
    correct_predictions,
        CASE
            WHEN (resolved_predictions > 0) THEN round((((correct_predictions)::numeric / (NULLIF(resolved_predictions, 0))::numeric) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS accuracy_pct,
    round(avg_confidence, 4) AS avg_confidence,
    round(avg_overall_score, 4) AS avg_overall_score
   FROM aggregated_stats
  ORDER BY period_date DESC, is_test;


--
-- Name: VIEW v_analytics_accuracy_comparison; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON VIEW prediction.v_analytics_accuracy_comparison IS 'Compare prediction accuracy between test and production systems on a daily basis. Tracks total predictions, resolved predictions, correct predictions, accuracy percentage, average confidence, and overall score.';


--
-- Name: checkpoint_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_blobs (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea
);


--
-- Name: checkpoint_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_migrations (
    v integer NOT NULL
);


--
-- Name: checkpoint_writes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_writes (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    task_id text NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text,
    blob bytea NOT NULL
);


--
-- Name: checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoints (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: llm_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_usage (
    id bigint NOT NULL,
    run_id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    tier text NOT NULL,
    cost numeric(16,8),
    duration integer,
    input_tokens integer,
    output_tokens integer,
    status text,
    "timestamp" timestamp with time zone,
    created_at timestamp with time zone,
    user_id text,
    caller_type text,
    caller_name text,
    conversation_id text,
    organization_slug text,
    reasoning_content text,
    reasoning_tokens integer,
    reasoning_truncated boolean DEFAULT false
);


--
-- Name: llm_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.llm_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: llm_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.llm_usage_id_seq OWNED BY public.llm_usage.id;


--
-- Name: observability_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observability_events (
    id bigint NOT NULL,
    source_app text NOT NULL,
    session_id text,
    hook_event_type text NOT NULL,
    user_id text,
    username text,
    conversation_id text,
    task_id text,
    agent_slug text,
    organization_slug text,
    mode text,
    status text,
    message text,
    progress integer,
    step text,
    sequence integer,
    total_steps integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    "timestamp" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: observability_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.observability_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: observability_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.observability_events_id_seq OWNED BY public.observability_events.id;


--
-- Name: rbac_audit_log id; Type: DEFAULT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_audit_log ALTER COLUMN id SET DEFAULT nextval('authz.rbac_audit_log_id_seq'::regclass);


--
-- Name: llm_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage ALTER COLUMN id SET DEFAULT nextval('public.llm_usage_id_seq'::regclass);


--
-- Name: observability_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_events ALTER COLUMN id SET DEFAULT nextval('public.observability_events_id_seq'::regclass);


--
-- Name: compliance_documents compliance_documents_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.compliance_documents
    ADD CONSTRAINT compliance_documents_pkey PRIMARY KEY (id);


--
-- Name: rbac_audit_log rbac_audit_log_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_audit_log
    ADD CONSTRAINT rbac_audit_log_pkey PRIMARY KEY (id);


--
-- Name: rbac_permissions rbac_permissions_name_key; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_permissions
    ADD CONSTRAINT rbac_permissions_name_key UNIQUE (name);


--
-- Name: rbac_permissions rbac_permissions_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_permissions
    ADD CONSTRAINT rbac_permissions_pkey PRIMARY KEY (id);


--
-- Name: rbac_role_permissions rbac_role_permissions_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: rbac_roles rbac_roles_name_key; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_roles
    ADD CONSTRAINT rbac_roles_name_key UNIQUE (name);


--
-- Name: rbac_roles rbac_roles_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_roles
    ADD CONSTRAINT rbac_roles_pkey PRIMARY KEY (id);


--
-- Name: rbac_user_roles rbac_user_roles_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_user_roles
    ADD CONSTRAINT rbac_user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: channel_members channel_members_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.channel_members
    ADD CONSTRAINT channel_members_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: user_blocks user_blocks_pkey; Type: CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);


--
-- Name: agent_self_modification_log agent_self_modification_log_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.agent_self_modification_log
    ADD CONSTRAINT agent_self_modification_log_pkey PRIMARY KEY (id);


--
-- Name: analyst_adaptation_diffs analyst_adaptation_diffs_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_adaptation_diffs
    ADD CONSTRAINT analyst_adaptation_diffs_pkey PRIMARY KEY (id);


--
-- Name: analyst_assessments analyst_assessments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_assessments
    ADD CONSTRAINT analyst_assessments_pkey PRIMARY KEY (id);


--
-- Name: analyst_config_versions analyst_config_versions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_config_versions
    ADD CONSTRAINT analyst_config_versions_pkey PRIMARY KEY (id);


--
-- Name: analyst_contribution_scores analyst_contribution_scores_analyst_id_instrument_id_period_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_contribution_scores
    ADD CONSTRAINT analyst_contribution_scores_analyst_id_instrument_id_period_key UNIQUE (analyst_id, instrument_id, period);


--
-- Name: analyst_contribution_scores analyst_contribution_scores_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_contribution_scores
    ADD CONSTRAINT analyst_contribution_scores_pkey PRIMARY KEY (id);


--
-- Name: analyst_coverage_gaps analyst_coverage_gaps_instrument_id_horizon_window_period_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_coverage_gaps
    ADD CONSTRAINT analyst_coverage_gaps_instrument_id_horizon_window_period_key UNIQUE (instrument_id, horizon_window, period);


--
-- Name: analyst_coverage_gaps analyst_coverage_gaps_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_coverage_gaps
    ADD CONSTRAINT analyst_coverage_gaps_pkey PRIMARY KEY (id);


--
-- Name: analyst_overrides analyst_overrides_analyst_id_universe_id_target_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_overrides
    ADD CONSTRAINT analyst_overrides_analyst_id_universe_id_target_id_key UNIQUE (analyst_id, universe_id, target_id);


--
-- Name: analyst_overrides analyst_overrides_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_overrides
    ADD CONSTRAINT analyst_overrides_pkey PRIMARY KEY (id);


--
-- Name: analyst_pair_correlations analyst_pair_correlations_analyst_a_id_analyst_b_id_instrum_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_pair_correlations
    ADD CONSTRAINT analyst_pair_correlations_analyst_a_id_analyst_b_id_instrum_key UNIQUE (analyst_a_id, analyst_b_id, instrument_id, horizon_window, period);


--
-- Name: analyst_pair_correlations analyst_pair_correlations_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_pair_correlations
    ADD CONSTRAINT analyst_pair_correlations_pkey PRIMARY KEY (id);


--
-- Name: analyst_performance_metrics analyst_performance_metrics_analyst_id_fork_type_metric_dat_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_performance_metrics
    ADD CONSTRAINT analyst_performance_metrics_analyst_id_fork_type_metric_dat_key UNIQUE (analyst_id, fork_type, metric_date);


--
-- Name: analyst_performance_metrics analyst_performance_metrics_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_performance_metrics
    ADD CONSTRAINT analyst_performance_metrics_pkey PRIMARY KEY (id);


--
-- Name: analyst_performance_profiles analyst_performance_profiles_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_performance_profiles
    ADD CONSTRAINT analyst_performance_profiles_pkey PRIMARY KEY (id);


--
-- Name: analyst_portfolios analyst_portfolios_analyst_id_fork_type_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_portfolios
    ADD CONSTRAINT analyst_portfolios_analyst_id_fork_type_key UNIQUE (analyst_id, fork_type);


--
-- Name: analyst_portfolios analyst_portfolios_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_portfolios
    ADD CONSTRAINT analyst_portfolios_pkey PRIMARY KEY (id);


--
-- Name: analyst_positions analyst_positions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_positions
    ADD CONSTRAINT analyst_positions_pkey PRIMARY KEY (id);


--
-- Name: analyst_risk_assessments analyst_risk_assessments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_risk_assessments
    ADD CONSTRAINT analyst_risk_assessments_pkey PRIMARY KEY (id);


--
-- Name: analyst_source_assignments analyst_source_assignments_analyst_id_source_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_source_assignments
    ADD CONSTRAINT analyst_source_assignments_analyst_id_source_id_key UNIQUE (analyst_id, source_id);


--
-- Name: analyst_source_assignments analyst_source_assignments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_source_assignments
    ADD CONSTRAINT analyst_source_assignments_pkey PRIMARY KEY (id);


--
-- Name: audit_findings audit_findings_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.audit_findings
    ADD CONSTRAINT audit_findings_pkey PRIMARY KEY (id);


--
-- Name: bailout_ledger bailout_ledger_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.bailout_ledger
    ADD CONSTRAINT bailout_ledger_pkey PRIMARY KEY (id);


--
-- Name: bailout_ledger bailout_ledger_portfolio_kind_portfolio_id_reset_date_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.bailout_ledger
    ADD CONSTRAINT bailout_ledger_portfolio_kind_portfolio_id_reset_date_key UNIQUE (portfolio_kind, portfolio_id, reset_date);


--
-- Name: benchmark_series benchmark_series_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.benchmark_series
    ADD CONSTRAINT benchmark_series_pkey PRIMARY KEY (symbol, trading_date);


--
-- Name: canonical_test_days canonical_test_days_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.canonical_test_days
    ADD CONSTRAINT canonical_test_days_pkey PRIMARY KEY (id);


--
-- Name: daily_pnl_snapshot daily_pnl_snapshot_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.daily_pnl_snapshot
    ADD CONSTRAINT daily_pnl_snapshot_pkey PRIMARY KEY (id);


--
-- Name: daily_pnl_snapshot daily_pnl_snapshot_portfolio_kind_portfolio_id_snapshot_dat_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.daily_pnl_snapshot
    ADD CONSTRAINT daily_pnl_snapshot_portfolio_kind_portfolio_id_snapshot_dat_key UNIQUE (portfolio_kind, portfolio_id, snapshot_date);


--
-- Name: daily_postmortem_recommendations daily_postmortem_recommendations_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.daily_postmortem_recommendations
    ADD CONSTRAINT daily_postmortem_recommendations_pkey PRIMARY KEY (id);


--
-- Name: daily_postmortem_runs daily_postmortem_runs_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.daily_postmortem_runs
    ADD CONSTRAINT daily_postmortem_runs_pkey PRIMARY KEY (id);


--
-- Name: data_source_registry data_source_registry_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.data_source_registry
    ADD CONSTRAINT data_source_registry_pkey PRIMARY KEY (id);


--
-- Name: domains domains_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.domains
    ADD CONSTRAINT domains_pkey PRIMARY KEY (slug);


--
-- Name: eod_settlement_log eod_settlement_log_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.eod_settlement_log
    ADD CONSTRAINT eod_settlement_log_pkey PRIMARY KEY (id);


--
-- Name: eod_settlement_log eod_settlement_log_settlement_date_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.eod_settlement_log
    ADD CONSTRAINT eod_settlement_log_settlement_date_key UNIQUE (settlement_date);


--
-- Name: evaluations evaluations_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.evaluations
    ADD CONSTRAINT evaluations_pkey PRIMARY KEY (id);


--
-- Name: evaluations evaluations_prediction_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.evaluations
    ADD CONSTRAINT evaluations_prediction_id_key UNIQUE (prediction_id);


--
-- Name: fear_greed_alerts fear_greed_alerts_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.fear_greed_alerts
    ADD CONSTRAINT fear_greed_alerts_pkey PRIMARY KEY (id);


--
-- Name: fork_learning_exchanges fork_learning_exchanges_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.fork_learning_exchanges
    ADD CONSTRAINT fork_learning_exchanges_pkey PRIMARY KEY (id);


--
-- Name: instrument_analyst_assignments instrument_analyst_assignments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.instrument_analyst_assignments
    ADD CONSTRAINT instrument_analyst_assignments_pkey PRIMARY KEY (instrument_id, analyst_id);


--
-- Name: instruments instruments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.instruments
    ADD CONSTRAINT instruments_pkey PRIMARY KEY (id);


--
-- Name: learning_proposals learning_proposals_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_proposals
    ADD CONSTRAINT learning_proposals_pkey PRIMARY KEY (id);


--
-- Name: learning_queue learning_queue_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_pkey PRIMARY KEY (id);


--
-- Name: learning_reports learning_reports_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_reports
    ADD CONSTRAINT learning_reports_pkey PRIMARY KEY (id);


--
-- Name: learning_reports learning_reports_type_date_unique; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_reports
    ADD CONSTRAINT learning_reports_type_date_unique UNIQUE (report_type, report_date);


--
-- Name: learnings learnings_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learnings
    ADD CONSTRAINT learnings_pkey PRIMARY KEY (id);


--
-- Name: market_analysts market_analysts_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_analysts
    ADD CONSTRAINT market_analysts_pkey PRIMARY KEY (id);


--
-- Name: market_articles market_articles_external_article_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_articles
    ADD CONSTRAINT market_articles_external_article_id_key UNIQUE (external_article_id);


--
-- Name: market_articles market_articles_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_articles
    ADD CONSTRAINT market_articles_pkey PRIMARY KEY (id);


--
-- Name: market_instrument_analyst_assignments market_instrument_analyst_assignments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_instrument_analyst_assignments
    ADD CONSTRAINT market_instrument_analyst_assignments_pkey PRIMARY KEY (instrument_id, analyst_id);


--
-- Name: market_predictions market_predictions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictions
    ADD CONSTRAINT market_predictions_pkey PRIMARY KEY (id);


--
-- Name: market_predictors market_predictors_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictors
    ADD CONSTRAINT market_predictors_pkey PRIMARY KEY (id);


--
-- Name: market_risk_assessments market_risk_assessments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_risk_assessments
    ADD CONSTRAINT market_risk_assessments_pkey PRIMARY KEY (id);


--
-- Name: market_run_artifacts market_run_artifacts_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_artifacts
    ADD CONSTRAINT market_run_artifacts_pkey PRIMARY KEY (id);


--
-- Name: market_run_evaluations market_run_evaluations_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_evaluations
    ADD CONSTRAINT market_run_evaluations_pkey PRIMARY KEY (id);


--
-- Name: market_run_replays market_run_replays_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_replays
    ADD CONSTRAINT market_run_replays_pkey PRIMARY KEY (id);


--
-- Name: missed_opportunities missed_opportunities_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.missed_opportunities
    ADD CONSTRAINT missed_opportunities_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: orchestration_runs orchestration_runs_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.orchestration_runs
    ADD CONSTRAINT orchestration_runs_pkey PRIMARY KEY (id);


--
-- Name: position_sizing_config position_sizing_config_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.position_sizing_config
    ADD CONSTRAINT position_sizing_config_pkey PRIMARY KEY (id);


--
-- Name: prediction_challenges prediction_challenges_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.prediction_challenges
    ADD CONSTRAINT prediction_challenges_pkey PRIMARY KEY (id);


--
-- Name: prediction_horizon_evaluations prediction_horizon_evaluations_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.prediction_horizon_evaluations
    ADD CONSTRAINT prediction_horizon_evaluations_pkey PRIMARY KEY (id);


--
-- Name: predictions predictions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictions
    ADD CONSTRAINT predictions_pkey PRIMARY KEY (id);


--
-- Name: predictors predictors_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictors
    ADD CONSTRAINT predictors_pkey PRIMARY KEY (id);


--
-- Name: replay_test_results replay_test_results_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.replay_test_results
    ADD CONSTRAINT replay_test_results_pkey PRIMARY KEY (id);


--
-- Name: replay_test_snapshots replay_test_snapshots_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.replay_test_snapshots
    ADD CONSTRAINT replay_test_snapshots_pkey PRIMARY KEY (id);


--
-- Name: review_queue review_queue_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.review_queue
    ADD CONSTRAINT review_queue_pkey PRIMARY KEY (id);


--
-- Name: review_queue review_queue_signal_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.review_queue
    ADD CONSTRAINT review_queue_signal_id_key UNIQUE (signal_id);


--
-- Name: risk_composite_scores risk_composite_scores_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_composite_scores
    ADD CONSTRAINT risk_composite_scores_pkey PRIMARY KEY (id);


--
-- Name: risk_debate_contexts risk_debate_contexts_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_debate_contexts
    ADD CONSTRAINT risk_debate_contexts_pkey PRIMARY KEY (id);


--
-- Name: risk_debates risk_debates_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_debates
    ADD CONSTRAINT risk_debates_pkey PRIMARY KEY (id);


--
-- Name: risk_dimension_assessments risk_dimension_assessments_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_dimension_assessments
    ADD CONSTRAINT risk_dimension_assessments_pkey PRIMARY KEY (id);


--
-- Name: risk_dimensions risk_dimensions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_dimensions
    ADD CONSTRAINT risk_dimensions_pkey PRIMARY KEY (id);


--
-- Name: runner_context_versions runner_context_versions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.runner_context_versions
    ADD CONSTRAINT runner_context_versions_pkey PRIMARY KEY (id);


--
-- Name: service_api_keys service_api_keys_key_hash_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.service_api_keys
    ADD CONSTRAINT service_api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: service_api_keys service_api_keys_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.service_api_keys
    ADD CONSTRAINT service_api_keys_pkey PRIMARY KEY (id);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: snapshots snapshots_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.snapshots
    ADD CONSTRAINT snapshots_pkey PRIMARY KEY (id);


--
-- Name: source_catalog source_catalog_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.source_catalog
    ADD CONSTRAINT source_catalog_pkey PRIMARY KEY (id);


--
-- Name: source_catalog source_catalog_source_key_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.source_catalog
    ADD CONSTRAINT source_catalog_source_key_key UNIQUE (source_key);


--
-- Name: source_subscriptions source_subscriptions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.source_subscriptions
    ADD CONSTRAINT source_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: source_subscriptions source_subscriptions_source_id_target_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.source_subscriptions
    ADD CONSTRAINT source_subscriptions_source_id_target_id_key UNIQUE (source_id, target_id);


--
-- Name: strategies strategies_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.strategies
    ADD CONSTRAINT strategies_pkey PRIMARY KEY (id);


--
-- Name: strategies strategies_slug_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.strategies
    ADD CONSTRAINT strategies_slug_key UNIQUE (slug);


--
-- Name: target_context_versions target_context_versions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.target_context_versions
    ADD CONSTRAINT target_context_versions_pkey PRIMARY KEY (id);


--
-- Name: target_snapshots target_snapshots_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.target_snapshots
    ADD CONSTRAINT target_snapshots_pkey PRIMARY KEY (id);


--
-- Name: targets targets_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.targets
    ADD CONSTRAINT targets_pkey PRIMARY KEY (id);


--
-- Name: targets targets_universe_id_symbol_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.targets
    ADD CONSTRAINT targets_universe_id_symbol_key UNIQUE (universe_id, symbol);


--
-- Name: tenant_source_entitlements tenant_source_entitlements_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.tenant_source_entitlements
    ADD CONSTRAINT tenant_source_entitlements_pkey PRIMARY KEY (source_id);


--
-- Name: test_target_mirrors test_target_mirrors_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.test_target_mirrors
    ADD CONSTRAINT test_target_mirrors_pkey PRIMARY KEY (id);


--
-- Name: tool_requests tool_requests_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.tool_requests
    ADD CONSTRAINT tool_requests_pkey PRIMARY KEY (id);


--
-- Name: universe_context_versions universe_context_versions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.universe_context_versions
    ADD CONSTRAINT universe_context_versions_pkey PRIMARY KEY (id);


--
-- Name: universes universes_pkey1; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.universes
    ADD CONSTRAINT universes_pkey1 PRIMARY KEY (slug);


--
-- Name: test_target_mirrors uq_test_target_mirrors_real; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.test_target_mirrors
    ADD CONSTRAINT uq_test_target_mirrors_real UNIQUE (real_target_id);


--
-- Name: test_target_mirrors uq_test_target_mirrors_test; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.test_target_mirrors
    ADD CONSTRAINT uq_test_target_mirrors_test UNIQUE (test_target_id);


--
-- Name: user_affinity_signals user_affinity_signals_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_affinity_signals
    ADD CONSTRAINT user_affinity_signals_pkey PRIMARY KEY (id);


--
-- Name: user_analyst_affinity user_analyst_affinity_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_analyst_affinity
    ADD CONSTRAINT user_analyst_affinity_pkey PRIMARY KEY (id);


--
-- Name: user_analyst_affinity user_analyst_affinity_user_id_analyst_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_analyst_affinity
    ADD CONSTRAINT user_analyst_affinity_user_id_analyst_id_key UNIQUE (user_id, analyst_id);


--
-- Name: user_contrarian_alerts user_contrarian_alerts_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_contrarian_alerts
    ADD CONSTRAINT user_contrarian_alerts_pkey PRIMARY KEY (id);


--
-- Name: user_decision_outcomes user_decision_outcomes_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_decision_outcomes
    ADD CONSTRAINT user_decision_outcomes_pkey PRIMARY KEY (id);


--
-- Name: user_portfolios user_portfolios_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_portfolios
    ADD CONSTRAINT user_portfolios_pkey PRIMARY KEY (id);


--
-- Name: user_positions user_positions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_positions
    ADD CONSTRAINT user_positions_pkey PRIMARY KEY (id);


--
-- Name: user_trade_decisions user_trade_decisions_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_trade_decisions
    ADD CONSTRAINT user_trade_decisions_pkey PRIMARY KEY (id);


--
-- Name: user_trade_decisions user_trade_decisions_user_id_prediction_id_key; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_trade_decisions
    ADD CONSTRAINT user_trade_decisions_user_id_prediction_id_key UNIQUE (user_id, prediction_id);


--
-- Name: user_trade_queue user_trade_queue_pkey; Type: CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.user_trade_queue
    ADD CONSTRAINT user_trade_queue_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_blobs checkpoint_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);


--
-- Name: checkpoint_migrations checkpoint_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);


--
-- Name: checkpoint_writes checkpoint_writes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);


--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);


--
-- Name: llm_usage llm_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_usage
    ADD CONSTRAINT llm_usage_pkey PRIMARY KEY (id);


--
-- Name: observability_events observability_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_events
    ADD CONSTRAINT observability_events_pkey PRIMARY KEY (id);


--
-- Name: rbac_user_org_roles_user_role_idx; Type: INDEX; Schema: authz; Owner: -
--

CREATE UNIQUE INDEX rbac_user_org_roles_user_role_idx ON authz.rbac_user_roles USING btree (user_id, role_id);


--
-- Name: idx_channel_members_user; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX idx_channel_members_user ON messaging.channel_members USING btree (user_id);


--
-- Name: idx_channels_scope; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX idx_channels_scope ON messaging.channels USING btree (scope, scope_id);


--
-- Name: idx_messages_channel_created; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX idx_messages_channel_created ON messaging.messages USING btree (channel_id, created_at DESC);


--
-- Name: idx_messages_parent; Type: INDEX; Schema: messaging; Owner: -
--

CREATE INDEX idx_messages_parent ON messaging.messages USING btree (parent_message_id) WHERE (parent_message_id IS NOT NULL);


--
-- Name: analyst_contribution_scores_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX analyst_contribution_scores_analyst_idx ON prediction.analyst_contribution_scores USING btree (analyst_id);


--
-- Name: analyst_coverage_gaps_gap_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX analyst_coverage_gaps_gap_idx ON prediction.analyst_coverage_gaps USING btree (is_gap) WHERE (is_gap = true);


--
-- Name: analyst_pair_corr_flag_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX analyst_pair_corr_flag_idx ON prediction.analyst_pair_correlations USING btree (flag) WHERE (flag IS NOT NULL);


--
-- Name: audit_findings_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX audit_findings_analyst_idx ON prediction.audit_findings USING btree (analyst_id);


--
-- Name: audit_findings_prediction_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX audit_findings_prediction_idx ON prediction.audit_findings USING btree (prediction_id);


--
-- Name: audit_findings_status_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX audit_findings_status_idx ON prediction.audit_findings USING btree (status);


--
-- Name: fear_greed_alerts_predictor_user_key; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX fear_greed_alerts_predictor_user_key ON prediction.fear_greed_alerts USING btree (predictor_id, user_id);


--
-- Name: fear_greed_alerts_user_unread_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX fear_greed_alerts_user_unread_idx ON prediction.fear_greed_alerts USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_agent_self_modification_log_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_agent_self_modification_log_analyst ON prediction.agent_self_modification_log USING btree (analyst_id);


--
-- Name: idx_agent_self_modification_log_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_agent_self_modification_log_created ON prediction.agent_self_modification_log USING btree (created_at DESC);


--
-- Name: idx_agent_self_modification_log_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_agent_self_modification_log_type ON prediction.agent_self_modification_log USING btree (modification_type);


--
-- Name: idx_agent_self_modification_log_unacked; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_agent_self_modification_log_unacked ON prediction.agent_self_modification_log USING btree (acknowledged, created_at DESC) WHERE (acknowledged = false);


--
-- Name: idx_analyst_adaptation_diffs_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_adaptation_diffs_analyst ON prediction.analyst_adaptation_diffs USING btree (analyst_id);


--
-- Name: idx_analyst_adaptation_diffs_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_adaptation_diffs_created ON prediction.analyst_adaptation_diffs USING btree (created_at DESC);


--
-- Name: idx_analyst_adaptation_diffs_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_adaptation_diffs_status ON prediction.analyst_adaptation_diffs USING btree (adoption_status);


--
-- Name: idx_analyst_assessments_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_analyst ON prediction.analyst_assessments USING btree (analyst_id);


--
-- Name: idx_analyst_assessments_context_version; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_context_version ON prediction.analyst_assessments USING btree (context_version_id) WHERE (context_version_id IS NOT NULL);


--
-- Name: idx_analyst_assessments_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_created ON prediction.analyst_assessments USING btree (created_at DESC);


--
-- Name: idx_analyst_assessments_fork; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_fork ON prediction.analyst_assessments USING btree (fork_type);


--
-- Name: idx_analyst_assessments_learnings; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_learnings ON prediction.analyst_assessments USING gin (learnings_applied);


--
-- Name: idx_analyst_assessments_llm_usage; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_llm_usage ON prediction.analyst_assessments USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: idx_analyst_assessments_prediction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_prediction ON prediction.analyst_assessments USING btree (prediction_id) WHERE (prediction_id IS NOT NULL);


--
-- Name: idx_analyst_assessments_predictor; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_predictor ON prediction.analyst_assessments USING btree (predictor_id) WHERE (predictor_id IS NOT NULL);


--
-- Name: idx_analyst_assessments_tier; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_assessments_tier ON prediction.analyst_assessments USING btree (llm_tier);


--
-- Name: idx_analyst_overrides_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_overrides_analyst ON prediction.analyst_overrides USING btree (analyst_id);


--
-- Name: idx_analyst_overrides_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_overrides_target ON prediction.analyst_overrides USING btree (target_id) WHERE (target_id IS NOT NULL);


--
-- Name: idx_analyst_overrides_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_overrides_universe ON prediction.analyst_overrides USING btree (universe_id) WHERE (universe_id IS NOT NULL);


--
-- Name: idx_analyst_performance_metrics_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_performance_metrics_analyst ON prediction.analyst_performance_metrics USING btree (analyst_id);


--
-- Name: idx_analyst_performance_metrics_date; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_performance_metrics_date ON prediction.analyst_performance_metrics USING btree (metric_date DESC);


--
-- Name: idx_analyst_performance_metrics_fork_date; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_performance_metrics_fork_date ON prediction.analyst_performance_metrics USING btree (analyst_id, fork_type, metric_date DESC);


--
-- Name: idx_analyst_portfolios_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_portfolios_analyst ON prediction.analyst_portfolios USING btree (analyst_id);


--
-- Name: idx_analyst_portfolios_balance; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_portfolios_balance ON prediction.analyst_portfolios USING btree (current_balance);


--
-- Name: idx_analyst_portfolios_fork; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_portfolios_fork ON prediction.analyst_portfolios USING btree (fork_type);


--
-- Name: idx_analyst_portfolios_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_portfolios_status ON prediction.analyst_portfolios USING btree (status) WHERE (fork_type = 'agent'::text);


--
-- Name: idx_analyst_positions_assessment; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_assessment ON prediction.analyst_positions USING btree (analyst_assessment_id) WHERE (analyst_assessment_id IS NOT NULL);


--
-- Name: idx_analyst_positions_open; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_open ON prediction.analyst_positions USING btree (portfolio_id, status) WHERE (status = 'open'::text);


--
-- Name: idx_analyst_positions_paper; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_paper ON prediction.analyst_positions USING btree (is_paper_only) WHERE (is_paper_only = true);


--
-- Name: idx_analyst_positions_portfolio; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_portfolio ON prediction.analyst_positions USING btree (portfolio_id);


--
-- Name: idx_analyst_positions_prediction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_prediction ON prediction.analyst_positions USING btree (prediction_id) WHERE (prediction_id IS NOT NULL);


--
-- Name: idx_analyst_positions_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_status ON prediction.analyst_positions USING btree (status);


--
-- Name: idx_analyst_positions_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_analyst_positions_target ON prediction.analyst_positions USING btree (target_id);


--
-- Name: idx_bailout_portfolio; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_bailout_portfolio ON prediction.bailout_ledger USING btree (portfolio_kind, portfolio_id, reset_date DESC);


--
-- Name: idx_daily_postmortem_recs_run; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_daily_postmortem_recs_run ON prediction.daily_postmortem_recommendations USING btree (run_id);


--
-- Name: idx_daily_postmortem_recs_scope; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_daily_postmortem_recs_scope ON prediction.daily_postmortem_recommendations USING btree (scope_level);


--
-- Name: idx_daily_postmortem_recs_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_daily_postmortem_recs_status ON prediction.daily_postmortem_recommendations USING btree (status);


--
-- Name: idx_daily_postmortem_runs_org_agent_date; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_daily_postmortem_runs_org_agent_date ON prediction.daily_postmortem_runs USING btree (org_slug, agent_slug, run_date DESC);


--
-- Name: idx_eod_settlement_log_date; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_eod_settlement_log_date ON prediction.eod_settlement_log USING btree (settlement_date DESC);


--
-- Name: idx_evaluations_production; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_evaluations_production ON prediction.evaluations USING btree (prediction_id, created_at DESC) WHERE (is_test = false);


--
-- Name: INDEX idx_evaluations_production; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON INDEX prediction.idx_evaluations_production IS 'Production evaluations only (excludes test data)';


--
-- Name: idx_evaluations_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_evaluations_test_data ON prediction.evaluations USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_evaluations_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_evaluations_test_scenario ON prediction.evaluations USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_fork_learning_exchanges_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_fork_learning_exchanges_analyst ON prediction.fork_learning_exchanges USING btree (analyst_id);


--
-- Name: idx_fork_learning_exchanges_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_fork_learning_exchanges_created ON prediction.fork_learning_exchanges USING btree (created_at DESC);


--
-- Name: idx_fork_learning_exchanges_initiator; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_fork_learning_exchanges_initiator ON prediction.fork_learning_exchanges USING btree (initiated_by);


--
-- Name: idx_fork_learning_exchanges_outcome; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_fork_learning_exchanges_outcome ON prediction.fork_learning_exchanges USING btree (outcome);


--
-- Name: idx_learning_queue_confidence; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_confidence ON prediction.learning_queue USING btree (ai_confidence DESC);


--
-- Name: idx_learning_queue_config; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_config ON prediction.learning_queue USING gin (suggested_config);


--
-- Name: idx_learning_queue_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_created ON prediction.learning_queue USING btree (created_at DESC);


--
-- Name: idx_learning_queue_learning; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_learning ON prediction.learning_queue USING btree (learning_id) WHERE (learning_id IS NOT NULL);


--
-- Name: idx_learning_queue_reviewed; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_reviewed ON prediction.learning_queue USING btree (reviewed_at DESC) WHERE (reviewed_at IS NOT NULL);


--
-- Name: idx_learning_queue_reviewer; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_reviewer ON prediction.learning_queue USING btree (reviewed_by_user_id) WHERE (reviewed_by_user_id IS NOT NULL);


--
-- Name: idx_learning_queue_source_eval; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_source_eval ON prediction.learning_queue USING btree (source_evaluation_id) WHERE (source_evaluation_id IS NOT NULL);


--
-- Name: idx_learning_queue_source_missed; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_source_missed ON prediction.learning_queue USING btree (source_missed_opportunity_id) WHERE (source_missed_opportunity_id IS NOT NULL);


--
-- Name: idx_learning_queue_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_status ON prediction.learning_queue USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_learning_queue_suggested_scope; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_suggested_scope ON prediction.learning_queue USING btree (suggested_scope_level, suggested_domain);


--
-- Name: idx_learning_queue_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_test_data ON prediction.learning_queue USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_learning_queue_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learning_queue_test_scenario ON prediction.learning_queue USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_learnings_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_analyst ON prediction.learnings USING btree (analyst_id) WHERE (analyst_id IS NOT NULL);


--
-- Name: idx_learnings_config; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_config ON prediction.learnings USING gin (config);


--
-- Name: idx_learnings_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_created ON prediction.learnings USING btree (created_at DESC);


--
-- Name: idx_learnings_domain; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_domain ON prediction.learnings USING btree (domain) WHERE (domain IS NOT NULL);


--
-- Name: idx_learnings_effectiveness; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_effectiveness ON prediction.learnings USING btree (times_applied, times_helpful);


--
-- Name: idx_learnings_production; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_production ON prediction.learnings USING btree (scope_level, status, created_at DESC) WHERE (is_test = false);


--
-- Name: INDEX idx_learnings_production; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON INDEX prediction.idx_learnings_production IS 'Production learnings only (excludes test data)';


--
-- Name: idx_learnings_production_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_production_active ON prediction.learnings USING btree (scope_level, domain, universe_id) WHERE ((is_test = false) AND (status = 'active'::text));


--
-- Name: idx_learnings_scope; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_scope ON prediction.learnings USING btree (scope_level, domain, universe_id, target_id);


--
-- Name: idx_learnings_source_eval; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_source_eval ON prediction.learnings USING btree (source_evaluation_id) WHERE (source_evaluation_id IS NOT NULL);


--
-- Name: idx_learnings_source_missed; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_source_missed ON prediction.learnings USING btree (source_missed_opportunity_id) WHERE (source_missed_opportunity_id IS NOT NULL);


--
-- Name: idx_learnings_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_status ON prediction.learnings USING btree (status) WHERE (status = 'active'::text);


--
-- Name: idx_learnings_superseded; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_superseded ON prediction.learnings USING btree (superseded_by) WHERE (superseded_by IS NOT NULL);


--
-- Name: idx_learnings_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_target ON prediction.learnings USING btree (target_id) WHERE (target_id IS NOT NULL);


--
-- Name: idx_learnings_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_test_data ON prediction.learnings USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_learnings_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_test_scenario ON prediction.learnings USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_learnings_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_type ON prediction.learnings USING btree (learning_type);


--
-- Name: idx_learnings_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_learnings_universe ON prediction.learnings USING btree (universe_id) WHERE (universe_id IS NOT NULL);


--
-- Name: idx_missed_opportunities_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_missed_opportunities_test_data ON prediction.missed_opportunities USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_missed_opportunities_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_missed_opportunities_test_scenario ON prediction.missed_opportunities USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_pnl_snapshot_portfolio; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_pnl_snapshot_portfolio ON prediction.daily_pnl_snapshot USING btree (portfolio_kind, portfolio_id, snapshot_date DESC);


--
-- Name: idx_prediction_evaluations_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_analyst ON prediction.evaluations USING gin (analyst_scores);


--
-- Name: idx_prediction_evaluations_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_created_at ON prediction.evaluations USING btree (created_at DESC);


--
-- Name: idx_prediction_evaluations_direction_correct; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_direction_correct ON prediction.evaluations USING btree (direction_correct);


--
-- Name: idx_prediction_evaluations_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_is_test ON prediction.evaluations USING btree (is_test);


--
-- Name: idx_prediction_evaluations_learnings; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_learnings ON prediction.evaluations USING gin (suggested_learnings);


--
-- Name: idx_prediction_evaluations_llm; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_llm ON prediction.evaluations USING gin (llm_tier_scores);


--
-- Name: idx_prediction_evaluations_overall_score; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_overall_score ON prediction.evaluations USING btree (overall_score DESC);


--
-- Name: idx_prediction_evaluations_prediction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_evaluations_prediction ON prediction.evaluations USING btree (prediction_id);


--
-- Name: idx_prediction_learning_queue_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_learning_queue_is_test ON prediction.learning_queue USING btree (is_test);


--
-- Name: idx_prediction_learnings_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_learnings_is_test ON prediction.learnings USING btree (is_test);


--
-- Name: idx_prediction_missed_analysis_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_analysis_status ON prediction.missed_opportunities USING btree (analysis_status);


--
-- Name: idx_prediction_missed_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_created_at ON prediction.missed_opportunities USING btree (created_at DESC);


--
-- Name: idx_prediction_missed_detected; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_detected ON prediction.missed_opportunities USING btree (detected_at DESC);


--
-- Name: idx_prediction_missed_drivers; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_drivers ON prediction.missed_opportunities USING gin (discovered_drivers);


--
-- Name: idx_prediction_missed_gaps; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_gaps ON prediction.missed_opportunities USING gin (source_gaps);


--
-- Name: idx_prediction_missed_opportunities_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_opportunities_is_test ON prediction.missed_opportunities USING btree (is_test);


--
-- Name: idx_prediction_missed_percent; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_percent ON prediction.missed_opportunities USING btree (percent_change DESC);


--
-- Name: idx_prediction_missed_signals; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_signals ON prediction.missed_opportunities USING gin (signals_we_had);


--
-- Name: idx_prediction_missed_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_target ON prediction.missed_opportunities USING btree (target_id);


--
-- Name: idx_prediction_missed_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_missed_type ON prediction.missed_opportunities USING btree (move_type);


--
-- Name: idx_prediction_predictions_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_active ON prediction.predictions USING btree (target_id, status, expires_at) WHERE (status = 'active'::text);


--
-- Name: idx_prediction_predictions_analyst_ensemble; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_analyst_ensemble ON prediction.predictions USING gin (analyst_ensemble);


--
-- Name: idx_prediction_predictions_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_created_at ON prediction.predictions USING btree (created_at DESC);


--
-- Name: idx_prediction_predictions_direction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_direction ON prediction.predictions USING btree (direction);


--
-- Name: idx_prediction_predictions_expires_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_expires_at ON prediction.predictions USING btree (expires_at);


--
-- Name: idx_prediction_predictions_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_is_test ON prediction.predictions USING btree (is_test);


--
-- Name: idx_prediction_predictions_llm_ensemble; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_llm_ensemble ON prediction.predictions USING gin (llm_ensemble);


--
-- Name: idx_prediction_predictions_predicted_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_predicted_at ON prediction.predictions USING btree (predicted_at DESC);


--
-- Name: idx_prediction_predictions_production_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_production_active ON prediction.predictions USING btree (target_id, status, expires_at) WHERE ((is_test = false) AND (status = 'active'::text));


--
-- Name: idx_prediction_predictions_scenario_run; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_scenario_run ON prediction.predictions USING btree (scenario_run_id) WHERE (scenario_run_id IS NOT NULL);


--
-- Name: idx_prediction_predictions_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_status ON prediction.predictions USING btree (status);


--
-- Name: idx_prediction_predictions_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_target ON prediction.predictions USING btree (target_id);


--
-- Name: idx_prediction_predictions_task; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictions_task ON prediction.predictions USING btree (task_id) WHERE (task_id IS NOT NULL);


--
-- Name: idx_prediction_predictors_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_active ON prediction.predictors USING btree (target_id, status, expires_at) WHERE (status = 'active'::text);


--
-- Name: idx_prediction_predictors_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_analyst ON prediction.predictors USING btree (analyst_slug);


--
-- Name: idx_prediction_predictors_article_id; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_article_id ON prediction.predictors USING btree (article_id) WHERE (article_id IS NOT NULL);


--
-- Name: idx_prediction_predictors_assessment; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_assessment ON prediction.predictors USING gin (analyst_assessment);


--
-- Name: idx_prediction_predictors_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_created_at ON prediction.predictors USING btree (created_at DESC);


--
-- Name: idx_prediction_predictors_direction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_direction ON prediction.predictors USING btree (direction);


--
-- Name: idx_prediction_predictors_expires_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_expires_at ON prediction.predictors USING btree (expires_at);


--
-- Name: idx_prediction_predictors_fork_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_fork_type ON prediction.predictors USING btree (analyst_slug, fork_type) WHERE (fork_type IS NOT NULL);


--
-- Name: idx_prediction_predictors_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_is_test ON prediction.predictors USING btree (is_test);


--
-- Name: idx_prediction_predictors_llm_usage; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_llm_usage ON prediction.predictors USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: idx_prediction_predictors_scenario_run; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_scenario_run ON prediction.predictors USING btree (scenario_run_id) WHERE (scenario_run_id IS NOT NULL);


--
-- Name: idx_prediction_predictors_scenario_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_scenario_test ON prediction.predictors USING btree (scenario_run_id, is_test) WHERE (scenario_run_id IS NOT NULL);


--
-- Name: idx_prediction_predictors_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_status ON prediction.predictors USING btree (status);


--
-- Name: idx_prediction_predictors_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_predictors_target ON prediction.predictors USING btree (target_id);


--
-- Name: idx_prediction_signals_detected_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_detected_at ON prediction.signals USING btree (detected_at DESC);


--
-- Name: idx_prediction_signals_direction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_direction ON prediction.signals USING btree (direction);


--
-- Name: idx_prediction_signals_disposition; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_disposition ON prediction.signals USING btree (disposition);


--
-- Name: idx_prediction_signals_evaluation; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_evaluation ON prediction.signals USING gin (evaluation_result) WHERE (evaluation_result IS NOT NULL);


--
-- Name: idx_prediction_signals_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_is_test ON prediction.signals USING btree (is_test);


--
-- Name: idx_prediction_signals_metadata; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_metadata ON prediction.signals USING gin (metadata);


--
-- Name: idx_prediction_signals_pending; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_pending ON prediction.signals USING btree (target_id, disposition, detected_at) WHERE (disposition = 'pending'::text);


--
-- Name: idx_prediction_signals_scenario_run; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_scenario_run ON prediction.signals USING btree (scenario_run_id) WHERE (scenario_run_id IS NOT NULL);


--
-- Name: idx_prediction_signals_source; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_source ON prediction.signals USING btree (source_id);


--
-- Name: idx_prediction_signals_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_target ON prediction.signals USING btree (target_id);


--
-- Name: idx_prediction_signals_test_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_test_target ON prediction.signals USING btree (target_id, is_test, detected_at DESC) WHERE (is_test = true);


--
-- Name: idx_prediction_signals_urgency; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_urgency ON prediction.signals USING btree (urgency) WHERE (urgency IS NOT NULL);


--
-- Name: idx_prediction_signals_worker; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_signals_worker ON prediction.signals USING btree (processing_worker) WHERE (processing_worker IS NOT NULL);


--
-- Name: idx_prediction_snapshots_analyst; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_analyst ON prediction.snapshots USING gin (analyst_predictions);


--
-- Name: idx_prediction_snapshots_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_created_at ON prediction.snapshots USING btree (created_at DESC);


--
-- Name: idx_prediction_snapshots_learnings; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_learnings ON prediction.snapshots USING gin (learnings_applied);


--
-- Name: idx_prediction_snapshots_llm; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_llm ON prediction.snapshots USING gin (llm_ensemble);


--
-- Name: idx_prediction_snapshots_prediction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_prediction ON prediction.snapshots USING btree (prediction_id);


--
-- Name: idx_prediction_snapshots_predictors; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_snapshots_predictors ON prediction.snapshots USING gin (predictors);


--
-- Name: idx_prediction_source_subs_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_source_subs_active ON prediction.source_subscriptions USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_prediction_source_subs_last_processed; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_source_subs_last_processed ON prediction.source_subscriptions USING btree (last_processed_at);


--
-- Name: idx_prediction_source_subs_source; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_source_subs_source ON prediction.source_subscriptions USING btree (source_id);


--
-- Name: idx_prediction_source_subs_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_source_subs_target ON prediction.source_subscriptions USING btree (target_id);


--
-- Name: idx_prediction_source_subs_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_source_subs_universe ON prediction.source_subscriptions USING btree (universe_id);


--
-- Name: idx_prediction_strategies_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_strategies_active ON prediction.strategies USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_prediction_strategies_risk; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_strategies_risk ON prediction.strategies USING btree (risk_level);


--
-- Name: idx_prediction_strategies_slug; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_strategies_slug ON prediction.strategies USING btree (slug);


--
-- Name: idx_prediction_strategies_system; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_strategies_system ON prediction.strategies USING btree (is_system) WHERE (is_system = true);


--
-- Name: idx_prediction_target_snapshots_captured; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_target_snapshots_captured ON prediction.target_snapshots USING btree (captured_at DESC);


--
-- Name: idx_prediction_target_snapshots_is_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_target_snapshots_is_test ON prediction.target_snapshots USING btree (is_test);


--
-- Name: idx_prediction_target_snapshots_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_target_snapshots_target ON prediction.target_snapshots USING btree (target_id);


--
-- Name: idx_prediction_target_snapshots_target_time; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_target_snapshots_target_time ON prediction.target_snapshots USING btree (target_id, captured_at DESC);


--
-- Name: idx_prediction_targets_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_active ON prediction.targets USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_prediction_targets_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_created_at ON prediction.targets USING btree (created_at DESC);


--
-- Name: idx_prediction_targets_llm_override; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_llm_override ON prediction.targets USING gin (llm_config_override) WHERE (llm_config_override IS NOT NULL);


--
-- Name: idx_prediction_targets_metadata; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_metadata ON prediction.targets USING gin (metadata);


--
-- Name: idx_prediction_targets_symbol; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_symbol ON prediction.targets USING btree (symbol);


--
-- Name: idx_prediction_targets_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_type ON prediction.targets USING btree (target_type);


--
-- Name: idx_prediction_targets_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_targets_universe ON prediction.targets USING btree (universe_id);


--
-- Name: idx_prediction_tool_requests_created_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_tool_requests_created_at ON prediction.tool_requests USING btree (created_at DESC);


--
-- Name: idx_prediction_tool_requests_source_miss; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_tool_requests_source_miss ON prediction.tool_requests USING btree (missed_opportunity_id) WHERE (missed_opportunity_id IS NOT NULL);


--
-- Name: idx_prediction_tool_requests_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_tool_requests_status ON prediction.tool_requests USING btree (status);


--
-- Name: idx_prediction_tool_requests_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_tool_requests_type ON prediction.tool_requests USING btree (tool_type);


--
-- Name: idx_prediction_tool_requests_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_prediction_tool_requests_universe ON prediction.tool_requests USING btree (universe_id);


--
-- Name: idx_predictions_analyst_slug; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_analyst_slug ON prediction.predictions USING btree (analyst_slug) WHERE (analyst_slug IS NOT NULL);


--
-- Name: idx_predictions_is_arbitrator; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_is_arbitrator ON prediction.predictions USING btree (target_id, is_arbitrator) WHERE (is_arbitrator = true);


--
-- Name: idx_predictions_production; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_production ON prediction.predictions USING btree (target_id, created_at DESC) WHERE (is_test = false);


--
-- Name: INDEX idx_predictions_production; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON INDEX prediction.idx_predictions_production IS 'Production predictions only (excludes test data)';


--
-- Name: idx_predictions_production_active; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_production_active ON prediction.predictions USING btree (target_id, expires_at) WHERE ((is_test = false) AND (status = 'active'::text));


--
-- Name: idx_predictions_runner_context; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_runner_context ON prediction.predictions USING btree (runner_context_version_id) WHERE (runner_context_version_id IS NOT NULL);


--
-- Name: idx_predictions_target_context; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_target_context ON prediction.predictions USING btree (target_context_version_id) WHERE (target_context_version_id IS NOT NULL);


--
-- Name: idx_predictions_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_test_data ON prediction.predictions USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_predictions_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_test_scenario ON prediction.predictions USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_predictions_universe_context; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictions_universe_context ON prediction.predictions USING btree (universe_context_version_id) WHERE (universe_context_version_id IS NOT NULL);


--
-- Name: idx_predictors_production; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictors_production ON prediction.predictors USING btree (target_id, created_at DESC) WHERE (is_test = false);


--
-- Name: INDEX idx_predictors_production; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON INDEX prediction.idx_predictors_production IS 'Production predictors only (excludes test data)';


--
-- Name: idx_predictors_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictors_test_data ON prediction.predictors USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_predictors_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_predictors_test_scenario ON prediction.predictors USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_replay_results_improvement; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_replay_results_improvement ON prediction.replay_test_results USING btree (improvement) WHERE (improvement IS NOT NULL);


--
-- Name: idx_replay_results_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_replay_results_target ON prediction.replay_test_results USING btree (target_id);


--
-- Name: idx_replay_results_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_replay_results_test ON prediction.replay_test_results USING btree (replay_test_id);


--
-- Name: idx_replay_snapshots_table; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_replay_snapshots_table ON prediction.replay_test_snapshots USING btree (table_name);


--
-- Name: idx_replay_snapshots_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_replay_snapshots_test ON prediction.replay_test_snapshots USING btree (replay_test_id);


--
-- Name: idx_review_queue_confidence; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_confidence ON prediction.review_queue USING btree (original_confidence);


--
-- Name: idx_review_queue_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_created ON prediction.review_queue USING btree (created_at DESC);


--
-- Name: idx_review_queue_learning; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_learning ON prediction.review_queue USING btree (create_learning) WHERE (create_learning = true);


--
-- Name: idx_review_queue_predictor; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_predictor ON prediction.review_queue USING btree (predictor_id) WHERE (predictor_id IS NOT NULL);


--
-- Name: idx_review_queue_reviewed; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_reviewed ON prediction.review_queue USING btree (reviewed_at DESC) WHERE (reviewed_at IS NOT NULL);


--
-- Name: idx_review_queue_reviewer; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_reviewer ON prediction.review_queue USING btree (reviewed_by_user_id) WHERE (reviewed_by_user_id IS NOT NULL);


--
-- Name: idx_review_queue_signal; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_signal ON prediction.review_queue USING btree (signal_id);


--
-- Name: idx_review_queue_status; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_status ON prediction.review_queue USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_review_queue_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_test_data ON prediction.review_queue USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_review_queue_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_review_queue_test_scenario ON prediction.review_queue USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_runner_context_versions_created; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_runner_context_versions_created ON prediction.runner_context_versions USING btree (created_at DESC);


--
-- Name: idx_runner_context_versions_current; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_runner_context_versions_current ON prediction.runner_context_versions USING btree (runner_type, is_current) WHERE (is_current = true);


--
-- Name: idx_runner_context_versions_runner_type; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_runner_context_versions_runner_type ON prediction.runner_context_versions USING btree (runner_type);


--
-- Name: idx_signals_production; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_signals_production ON prediction.signals USING btree (target_id, detected_at DESC) WHERE (is_test = false);


--
-- Name: INDEX idx_signals_production; Type: COMMENT; Schema: prediction; Owner: -
--

COMMENT ON INDEX prediction.idx_signals_production IS 'Production signals only (excludes test data)';


--
-- Name: idx_signals_production_source; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_signals_production_source ON prediction.signals USING btree (source_id, detected_at DESC) WHERE (is_test = false);


--
-- Name: idx_signals_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_signals_test_data ON prediction.signals USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_signals_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_signals_test_scenario ON prediction.signals USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_snapshots_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_snapshots_test_data ON prediction.snapshots USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_snapshots_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_snapshots_test_scenario ON prediction.snapshots USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_strategies_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_strategies_test_data ON prediction.strategies USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_strategies_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_strategies_test_scenario ON prediction.strategies USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_target_context_versions_current; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_target_context_versions_current ON prediction.target_context_versions USING btree (target_id, is_current) WHERE (is_current = true);


--
-- Name: idx_target_context_versions_target; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_target_context_versions_target ON prediction.target_context_versions USING btree (target_id);


--
-- Name: idx_target_snapshots_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_target_snapshots_test_data ON prediction.target_snapshots USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_target_snapshots_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_target_snapshots_test_scenario ON prediction.target_snapshots USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_targets_price_updated_at; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_targets_price_updated_at ON prediction.targets USING btree (price_updated_at) WHERE (price_updated_at IS NOT NULL);


--
-- Name: idx_targets_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_targets_test_data ON prediction.targets USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_targets_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_targets_test_scenario ON prediction.targets USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_test_target_mirrors_real; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_test_target_mirrors_real ON prediction.test_target_mirrors USING btree (real_target_id);


--
-- Name: idx_test_target_mirrors_test; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_test_target_mirrors_test ON prediction.test_target_mirrors USING btree (test_target_id);


--
-- Name: idx_tool_requests_priority; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_tool_requests_priority ON prediction.tool_requests USING btree (priority);


--
-- Name: idx_tool_requests_test_data; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_tool_requests_test_data ON prediction.tool_requests USING btree (is_test_data) WHERE (is_test_data = true);


--
-- Name: idx_tool_requests_test_scenario; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_tool_requests_test_scenario ON prediction.tool_requests USING btree (test_scenario_id) WHERE (test_scenario_id IS NOT NULL);


--
-- Name: idx_unique_active_analyst_prediction; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX idx_unique_active_analyst_prediction ON prediction.predictions USING btree (target_id, analyst_slug) WHERE ((status = 'active'::text) AND (analyst_slug IS NOT NULL));


--
-- Name: idx_universe_context_versions_current; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_universe_context_versions_current ON prediction.universe_context_versions USING btree (universe_id, is_current) WHERE (is_current = true);


--
-- Name: idx_universe_context_versions_universe; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX idx_universe_context_versions_universe ON prediction.universe_context_versions USING btree (universe_id);


--
-- Name: market_predictors_instrument_article_analyst_key; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX market_predictors_instrument_article_analyst_key ON prediction.market_predictors USING btree (instrument_id, article_id, scored_by_analyst_id);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON prediction.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: prediction_affinity_signals_user_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_affinity_signals_user_idx ON prediction.user_affinity_signals USING btree (user_id, created_at DESC);


--
-- Name: prediction_analyst_config_versions_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_config_versions_analyst_idx ON prediction.analyst_config_versions USING btree (analyst_id, is_active);


--
-- Name: prediction_analyst_config_versions_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_config_versions_llm_usage_idx ON prediction.analyst_config_versions USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_analyst_portfolios_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_portfolios_analyst_idx ON prediction.analyst_portfolios USING btree (analyst_id);


--
-- Name: prediction_analyst_portfolios_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_portfolios_user_id_idx ON prediction.analyst_portfolios USING btree (analyst_id, user_id);


--
-- Name: prediction_analyst_positions_portfolio_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_positions_portfolio_idx ON prediction.analyst_positions USING btree (portfolio_id, status);


--
-- Name: prediction_analyst_positions_prediction_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_positions_prediction_idx ON prediction.analyst_positions USING btree (prediction_id);


--
-- Name: prediction_analyst_risk_assessments_instrument_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_risk_assessments_instrument_idx ON prediction.analyst_risk_assessments USING btree (instrument_id);


--
-- Name: prediction_analyst_risk_assessments_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_risk_assessments_llm_usage_idx ON prediction.analyst_risk_assessments USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_analyst_risk_assessments_run_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_risk_assessments_run_idx ON prediction.analyst_risk_assessments USING btree (run_id);


--
-- Name: prediction_analyst_risk_assessments_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analyst_risk_assessments_user_id_idx ON prediction.analyst_risk_assessments USING btree (user_id, instrument_id);


--
-- Name: prediction_analysts_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_analysts_user_id_idx ON prediction.market_analysts USING btree (user_id);


--
-- Name: prediction_audit_findings_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_audit_findings_user_id_idx ON prediction.audit_findings USING btree (user_id, status);


--
-- Name: prediction_canonical_days_instrument_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_canonical_days_instrument_idx ON prediction.canonical_test_days USING btree (instrument_id, is_active) WHERE (is_active = true);


--
-- Name: prediction_canonical_test_days_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_canonical_test_days_user_id_idx ON prediction.canonical_test_days USING btree (user_id, instrument_id, is_active) WHERE (is_active = true);


--
-- Name: prediction_challenges_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_challenges_llm_usage_idx ON prediction.prediction_challenges USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_challenges_prediction_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_challenges_prediction_idx ON prediction.prediction_challenges USING btree (prediction_id);


--
-- Name: prediction_contrarian_alerts_user_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_contrarian_alerts_user_idx ON prediction.user_contrarian_alerts USING btree (user_id, is_read, created_at DESC);


--
-- Name: prediction_decision_outcomes_decision_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_decision_outcomes_decision_idx ON prediction.user_decision_outcomes USING btree (decision_id);


--
-- Name: prediction_horizon_evals_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_horizon_evals_analyst_idx ON prediction.prediction_horizon_evaluations USING btree (analyst_id);


--
-- Name: prediction_horizon_evals_prediction_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_horizon_evals_prediction_idx ON prediction.prediction_horizon_evaluations USING btree (prediction_id);


--
-- Name: prediction_instruments_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_instruments_user_id_idx ON prediction.instruments USING btree (user_id);


--
-- Name: prediction_learning_proposals_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_learning_proposals_llm_usage_idx ON prediction.learning_proposals USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_learning_proposals_status_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_learning_proposals_status_idx ON prediction.learning_proposals USING btree (status);


--
-- Name: prediction_learning_proposals_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_learning_proposals_user_id_idx ON prediction.learning_proposals USING btree (user_id, status);


--
-- Name: prediction_learning_reports_date_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_learning_reports_date_idx ON prediction.learning_reports USING btree (report_date DESC);


--
-- Name: prediction_learning_reports_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_learning_reports_llm_usage_idx ON prediction.learning_reports USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_market_articles_external_source_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_articles_external_source_idx ON prediction.market_articles USING btree (external_source_slug);


--
-- Name: prediction_market_articles_published_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_articles_published_idx ON prediction.market_articles USING btree (published_at DESC);


--
-- Name: prediction_market_articles_source_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_articles_source_id_idx ON prediction.market_articles USING btree (source_id);


--
-- Name: prediction_market_predictions_active_analyst_instrument_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_market_predictions_active_analyst_instrument_idx ON prediction.market_predictions USING btree (analyst_id, instrument_id) WHERE ((settled_at IS NULL) AND (analyst_id IS NOT NULL));


--
-- Name: prediction_market_predictions_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_predictions_llm_usage_idx ON prediction.market_predictions USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_market_predictions_run_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_market_predictions_run_analyst_idx ON prediction.market_predictions USING btree (run_id, analyst_id) WHERE ((analyst_id IS NOT NULL) AND (role = 'analyst'::text));


--
-- Name: prediction_market_predictions_run_arbitrator_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_market_predictions_run_arbitrator_idx ON prediction.market_predictions USING btree (run_id) WHERE (role = 'arbitrator'::text);


--
-- Name: prediction_market_predictions_run_portfolio_manager_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_market_predictions_run_portfolio_manager_idx ON prediction.market_predictions USING btree (run_id) WHERE (role = 'portfolio_manager'::text);


--
-- Name: prediction_market_predictions_unsettled_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_predictions_unsettled_idx ON prediction.market_predictions USING btree (instrument_id, created_at DESC) WHERE (settled_at IS NULL);


--
-- Name: prediction_market_predictors_instrument_status_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_predictors_instrument_status_idx ON prediction.market_predictors USING btree (instrument_id, status);


--
-- Name: prediction_market_predictors_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_market_predictors_llm_usage_idx ON prediction.market_predictors USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_one_queued_run_per_key_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_one_queued_run_per_key_idx ON prediction.orchestration_runs USING btree (instrument_id, run_type) WHERE (status = 'queued'::text);


--
-- Name: prediction_perf_profiles_analyst_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_perf_profiles_analyst_idx ON prediction.analyst_performance_profiles USING btree (analyst_id);


--
-- Name: prediction_position_sizing_tier_unique_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_position_sizing_tier_unique_idx ON prediction.position_sizing_config USING btree (tier_name);


--
-- Name: prediction_prediction_challenges_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_prediction_challenges_user_id_idx ON prediction.prediction_challenges USING btree (user_id);


--
-- Name: prediction_risk_composite_instrument_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_composite_instrument_idx ON prediction.risk_composite_scores USING btree (instrument_id, status) WHERE (status = 'active'::text);


--
-- Name: prediction_risk_composite_run_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_composite_run_idx ON prediction.risk_composite_scores USING btree (run_id);


--
-- Name: prediction_risk_debate_contexts_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_debate_contexts_user_id_idx ON prediction.risk_debate_contexts USING btree (user_id);


--
-- Name: prediction_risk_debates_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_debates_llm_usage_idx ON prediction.risk_debates USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_risk_debates_run_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_debates_run_idx ON prediction.risk_debates USING btree (run_id);


--
-- Name: prediction_risk_dim_assessments_instrument_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_dim_assessments_instrument_idx ON prediction.risk_dimension_assessments USING btree (instrument_id);


--
-- Name: prediction_risk_dim_assessments_llm_usage_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_dim_assessments_llm_usage_idx ON prediction.risk_dimension_assessments USING btree (llm_usage_id) WHERE (llm_usage_id IS NOT NULL);


--
-- Name: prediction_risk_dim_assessments_run_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_dim_assessments_run_idx ON prediction.risk_dimension_assessments USING btree (run_id);


--
-- Name: prediction_risk_dimensions_user_id_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_risk_dimensions_user_id_idx ON prediction.risk_dimensions USING btree (user_id);


--
-- Name: prediction_source_origin_external_id_unique_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE UNIQUE INDEX prediction_source_origin_external_id_unique_idx ON prediction.source_catalog USING btree (source_origin, external_source_id) WHERE (external_source_id IS NOT NULL);


--
-- Name: prediction_user_analyst_affinity_user_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_user_analyst_affinity_user_idx ON prediction.user_analyst_affinity USING btree (user_id);


--
-- Name: prediction_user_decisions_user_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_user_decisions_user_idx ON prediction.user_trade_decisions USING btree (user_id);


--
-- Name: prediction_user_positions_portfolio_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_user_positions_portfolio_idx ON prediction.user_positions USING btree (portfolio_id, status);


--
-- Name: prediction_user_trade_queue_status_idx; Type: INDEX; Schema: prediction; Owner: -
--

CREATE INDEX prediction_user_trade_queue_status_idx ON prediction.user_trade_queue USING btree (user_id, status) WHERE (status = 'queued'::text);


--
-- Name: analyst_overrides set_analyst_overrides_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_analyst_overrides_updated_at BEFORE UPDATE ON prediction.analyst_overrides FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: analyst_portfolios set_analyst_portfolios_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_analyst_portfolios_updated_at BEFORE UPDATE ON prediction.analyst_portfolios FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: analyst_positions set_analyst_positions_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_analyst_positions_updated_at BEFORE UPDATE ON prediction.analyst_positions FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: learning_queue set_learning_queue_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_learning_queue_updated_at BEFORE UPDATE ON prediction.learning_queue FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: learnings set_learnings_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_learnings_updated_at BEFORE UPDATE ON prediction.learnings FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: evaluations set_prediction_evaluations_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_evaluations_updated_at BEFORE UPDATE ON prediction.evaluations FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: missed_opportunities set_prediction_missed_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_missed_updated_at BEFORE UPDATE ON prediction.missed_opportunities FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: predictions set_prediction_predictions_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_predictions_updated_at BEFORE UPDATE ON prediction.predictions FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: predictors set_prediction_predictors_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_predictors_updated_at BEFORE UPDATE ON prediction.predictors FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: signals set_prediction_signals_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_signals_updated_at BEFORE UPDATE ON prediction.signals FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: source_subscriptions set_prediction_source_subs_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_source_subs_updated_at BEFORE UPDATE ON prediction.source_subscriptions FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: strategies set_prediction_strategies_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_strategies_updated_at BEFORE UPDATE ON prediction.strategies FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: targets set_prediction_targets_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_targets_updated_at BEFORE UPDATE ON prediction.targets FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: tool_requests set_prediction_tool_requests_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_prediction_tool_requests_updated_at BEFORE UPDATE ON prediction.tool_requests FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: review_queue set_review_queue_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER set_review_queue_updated_at BEFORE UPDATE ON prediction.review_queue FOR EACH ROW EXECUTE FUNCTION prediction.set_updated_at();


--
-- Name: targets trg_auto_create_test_mirror; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_auto_create_test_mirror AFTER INSERT ON prediction.targets FOR EACH ROW EXECUTE FUNCTION prediction.auto_create_test_mirror();


--
-- Name: daily_postmortem_recommendations trg_daily_postmortem_recommendations_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_daily_postmortem_recommendations_updated_at BEFORE UPDATE ON prediction.daily_postmortem_recommendations FOR EACH ROW EXECUTE FUNCTION prediction.update_daily_postmortem_recommendations_timestamp();


--
-- Name: daily_postmortem_runs trg_daily_postmortem_runs_updated_at; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_daily_postmortem_runs_updated_at BEFORE UPDATE ON prediction.daily_postmortem_runs FOR EACH ROW EXECUTE FUNCTION prediction.update_daily_postmortem_runs_timestamp();


--
-- Name: predictions trg_enforce_prediction_direction; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_prediction_direction BEFORE INSERT OR UPDATE ON prediction.predictions FOR EACH ROW EXECUTE FUNCTION prediction.enforce_prediction_direction();


--
-- Name: predictors trg_enforce_predictor_direction; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_predictor_direction BEFORE INSERT OR UPDATE ON prediction.predictors FOR EACH ROW EXECUTE FUNCTION prediction.enforce_predictor_direction();


--
-- Name: predictors trg_enforce_predictor_is_test; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_predictor_is_test BEFORE INSERT OR UPDATE ON prediction.predictors FOR EACH ROW EXECUTE FUNCTION prediction.enforce_predictor_is_test();


--
-- Name: signals trg_enforce_signal_direction; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_signal_direction BEFORE INSERT OR UPDATE ON prediction.signals FOR EACH ROW EXECUTE FUNCTION prediction.enforce_signal_direction();


--
-- Name: signals trg_enforce_signal_is_test; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_signal_is_test BEFORE INSERT OR UPDATE ON prediction.signals FOR EACH ROW EXECUTE FUNCTION prediction.enforce_signal_is_test();


--
-- Name: targets trg_enforce_target_domain_type; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_target_domain_type BEFORE INSERT OR UPDATE ON prediction.targets FOR EACH ROW EXECUTE FUNCTION prediction.enforce_target_domain_type();


--
-- Name: predictors trg_enforce_test_target_isolation; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_enforce_test_target_isolation BEFORE INSERT OR UPDATE ON prediction.predictors FOR EACH ROW EXECUTE FUNCTION prediction.enforce_test_target_isolation();


--
-- Name: predictions trg_prediction_status_transition; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_prediction_status_transition BEFORE UPDATE ON prediction.predictions FOR EACH ROW EXECUTE FUNCTION prediction.validate_prediction_status_transition();


--
-- Name: analyst_portfolios trg_update_analyst_portfolio_status; Type: TRIGGER; Schema: prediction; Owner: -
--

CREATE TRIGGER trg_update_analyst_portfolio_status BEFORE UPDATE OF current_balance ON prediction.analyst_portfolios FOR EACH ROW EXECUTE FUNCTION prediction.update_analyst_portfolio_status();


--
-- Name: rbac_role_permissions rbac_role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES authz.rbac_permissions(id) ON DELETE CASCADE;


--
-- Name: rbac_role_permissions rbac_role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_role_permissions
    ADD CONSTRAINT rbac_role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES authz.rbac_roles(id) ON DELETE CASCADE;


--
-- Name: rbac_user_roles rbac_user_org_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_user_roles
    ADD CONSTRAINT rbac_user_org_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES authz.rbac_roles(id) ON DELETE CASCADE;


--
-- Name: rbac_user_roles rbac_user_org_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: authz; Owner: -
--

ALTER TABLE ONLY authz.rbac_user_roles
    ADD CONSTRAINT rbac_user_org_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES authz.users(id) ON DELETE CASCADE;


--
-- Name: channel_members channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.channel_members
    ADD CONSTRAINT channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES messaging.channels(id);


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messaging.messages(id);


--
-- Name: messages messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.messages
    ADD CONSTRAINT messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES messaging.channels(id);


--
-- Name: messages messages_parent_message_id_fkey; Type: FK CONSTRAINT; Schema: messaging; Owner: -
--

ALTER TABLE ONLY messaging.messages
    ADD CONSTRAINT messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messaging.messages(id);


--
-- Name: analyst_assessments analyst_assessments_prediction_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_assessments
    ADD CONSTRAINT analyst_assessments_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES prediction.predictions(id) ON DELETE CASCADE;


--
-- Name: analyst_assessments analyst_assessments_predictor_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_assessments
    ADD CONSTRAINT analyst_assessments_predictor_id_fkey FOREIGN KEY (predictor_id) REFERENCES prediction.predictors(id) ON DELETE CASCADE;


--
-- Name: analyst_overrides analyst_overrides_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_overrides
    ADD CONSTRAINT analyst_overrides_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: analyst_source_assignments analyst_source_assignments_source_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.analyst_source_assignments
    ADD CONSTRAINT analyst_source_assignments_source_id_fkey FOREIGN KEY (source_id) REFERENCES prediction.data_source_registry(id);


--
-- Name: daily_postmortem_recommendations daily_postmortem_recommendations_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.daily_postmortem_recommendations
    ADD CONSTRAINT daily_postmortem_recommendations_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.daily_postmortem_runs(id) ON DELETE CASCADE;


--
-- Name: evaluations evaluations_prediction_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.evaluations
    ADD CONSTRAINT evaluations_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES prediction.predictions(id) ON DELETE CASCADE;


--
-- Name: predictors fk_predictors_consumed_prediction; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictors
    ADD CONSTRAINT fk_predictors_consumed_prediction FOREIGN KEY (consumed_by_prediction_id) REFERENCES prediction.predictions(id) ON DELETE SET NULL;


--
-- Name: instrument_analyst_assignments instrument_analyst_assignments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.instrument_analyst_assignments
    ADD CONSTRAINT instrument_analyst_assignments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: learning_queue learning_queue_final_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_final_target_id_fkey FOREIGN KEY (final_target_id) REFERENCES prediction.targets(id) ON DELETE SET NULL;


--
-- Name: learning_queue learning_queue_learning_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_learning_id_fkey FOREIGN KEY (learning_id) REFERENCES prediction.learnings(id) ON DELETE SET NULL;


--
-- Name: learning_queue learning_queue_source_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_source_evaluation_id_fkey FOREIGN KEY (source_evaluation_id) REFERENCES prediction.evaluations(id) ON DELETE SET NULL;


--
-- Name: learning_queue learning_queue_source_missed_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_source_missed_opportunity_id_fkey FOREIGN KEY (source_missed_opportunity_id) REFERENCES prediction.missed_opportunities(id) ON DELETE SET NULL;


--
-- Name: learning_queue learning_queue_suggested_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learning_queue
    ADD CONSTRAINT learning_queue_suggested_target_id_fkey FOREIGN KEY (suggested_target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: learnings learnings_source_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learnings
    ADD CONSTRAINT learnings_source_evaluation_id_fkey FOREIGN KEY (source_evaluation_id) REFERENCES prediction.evaluations(id) ON DELETE SET NULL;


--
-- Name: learnings learnings_source_missed_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learnings
    ADD CONSTRAINT learnings_source_missed_opportunity_id_fkey FOREIGN KEY (source_missed_opportunity_id) REFERENCES prediction.missed_opportunities(id) ON DELETE SET NULL;


--
-- Name: learnings learnings_superseded_by_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learnings
    ADD CONSTRAINT learnings_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES prediction.learnings(id) ON DELETE SET NULL;


--
-- Name: learnings learnings_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.learnings
    ADD CONSTRAINT learnings_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: market_articles market_articles_source_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_articles
    ADD CONSTRAINT market_articles_source_id_fkey FOREIGN KEY (source_id) REFERENCES prediction.source_catalog(id) ON DELETE CASCADE;


--
-- Name: market_instrument_analyst_assignments market_instrument_analyst_assignments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_instrument_analyst_assignments
    ADD CONSTRAINT market_instrument_analyst_assignments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: market_predictions market_predictions_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictions
    ADD CONSTRAINT market_predictions_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: market_predictions market_predictions_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictions
    ADD CONSTRAINT market_predictions_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: market_predictors market_predictors_article_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictors
    ADD CONSTRAINT market_predictors_article_id_fkey FOREIGN KEY (article_id) REFERENCES prediction.market_articles(id) ON DELETE CASCADE;


--
-- Name: market_predictors market_predictors_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_predictors
    ADD CONSTRAINT market_predictors_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: market_risk_assessments market_risk_assessments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_risk_assessments
    ADD CONSTRAINT market_risk_assessments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: market_risk_assessments market_risk_assessments_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_risk_assessments
    ADD CONSTRAINT market_risk_assessments_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: market_run_artifacts market_run_artifacts_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_artifacts
    ADD CONSTRAINT market_run_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: market_run_evaluations market_run_evaluations_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_evaluations
    ADD CONSTRAINT market_run_evaluations_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: market_run_replays market_run_replays_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.market_run_replays
    ADD CONSTRAINT market_run_replays_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: missed_opportunities missed_opportunities_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.missed_opportunities
    ADD CONSTRAINT missed_opportunities_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: orchestration_runs orchestration_runs_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.orchestration_runs
    ADD CONSTRAINT orchestration_runs_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_runner_context_version_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictions
    ADD CONSTRAINT predictions_runner_context_version_id_fkey FOREIGN KEY (runner_context_version_id) REFERENCES prediction.runner_context_versions(id);


--
-- Name: predictions predictions_target_context_version_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictions
    ADD CONSTRAINT predictions_target_context_version_id_fkey FOREIGN KEY (target_context_version_id) REFERENCES prediction.target_context_versions(id);


--
-- Name: predictions predictions_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictions
    ADD CONSTRAINT predictions_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: predictions predictions_universe_context_version_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictions
    ADD CONSTRAINT predictions_universe_context_version_id_fkey FOREIGN KEY (universe_context_version_id) REFERENCES prediction.universe_context_versions(id);


--
-- Name: predictors predictors_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.predictors
    ADD CONSTRAINT predictors_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: replay_test_results replay_test_results_evaluation_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.replay_test_results
    ADD CONSTRAINT replay_test_results_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES prediction.evaluations(id);


--
-- Name: replay_test_results replay_test_results_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.replay_test_results
    ADD CONSTRAINT replay_test_results_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id);


--
-- Name: review_queue review_queue_predictor_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.review_queue
    ADD CONSTRAINT review_queue_predictor_id_fkey FOREIGN KEY (predictor_id) REFERENCES prediction.predictors(id) ON DELETE SET NULL;


--
-- Name: review_queue review_queue_signal_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.review_queue
    ADD CONSTRAINT review_queue_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES prediction.signals(id) ON DELETE CASCADE;


--
-- Name: risk_composite_scores risk_composite_scores_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_composite_scores
    ADD CONSTRAINT risk_composite_scores_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: risk_composite_scores risk_composite_scores_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_composite_scores
    ADD CONSTRAINT risk_composite_scores_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: risk_debates risk_debates_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_debates
    ADD CONSTRAINT risk_debates_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: risk_debates risk_debates_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_debates
    ADD CONSTRAINT risk_debates_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: risk_dimension_assessments risk_dimension_assessments_instrument_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_dimension_assessments
    ADD CONSTRAINT risk_dimension_assessments_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES prediction.instruments(id) ON DELETE CASCADE;


--
-- Name: risk_dimension_assessments risk_dimension_assessments_run_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.risk_dimension_assessments
    ADD CONSTRAINT risk_dimension_assessments_run_id_fkey FOREIGN KEY (run_id) REFERENCES prediction.orchestration_runs(id) ON DELETE CASCADE;


--
-- Name: signals signals_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.signals
    ADD CONSTRAINT signals_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: snapshots snapshots_prediction_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.snapshots
    ADD CONSTRAINT snapshots_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES prediction.predictions(id) ON DELETE CASCADE;


--
-- Name: source_subscriptions source_subscriptions_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.source_subscriptions
    ADD CONSTRAINT source_subscriptions_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: target_context_versions target_context_versions_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.target_context_versions
    ADD CONSTRAINT target_context_versions_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: target_snapshots target_snapshots_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.target_snapshots
    ADD CONSTRAINT target_snapshots_target_id_fkey FOREIGN KEY (target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: tenant_source_entitlements tenant_source_entitlements_source_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.tenant_source_entitlements
    ADD CONSTRAINT tenant_source_entitlements_source_id_fkey FOREIGN KEY (source_id) REFERENCES prediction.source_catalog(id) ON DELETE CASCADE;


--
-- Name: test_target_mirrors test_target_mirrors_real_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.test_target_mirrors
    ADD CONSTRAINT test_target_mirrors_real_target_id_fkey FOREIGN KEY (real_target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: test_target_mirrors test_target_mirrors_test_target_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.test_target_mirrors
    ADD CONSTRAINT test_target_mirrors_test_target_id_fkey FOREIGN KEY (test_target_id) REFERENCES prediction.targets(id) ON DELETE CASCADE;


--
-- Name: tool_requests tool_requests_source_missed_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.tool_requests
    ADD CONSTRAINT tool_requests_source_missed_opportunity_id_fkey FOREIGN KEY (missed_opportunity_id) REFERENCES prediction.missed_opportunities(id) ON DELETE SET NULL;


--
-- Name: universes universes_domain_slug_fkey; Type: FK CONSTRAINT; Schema: prediction; Owner: -
--

ALTER TABLE ONLY prediction.universes
    ADD CONSTRAINT universes_domain_slug_fkey FOREIGN KEY (domain_slug) REFERENCES prediction.domains(slug);


--
-- Name: analyst_assessments; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.analyst_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: analyst_assessments analyst_assessments_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY analyst_assessments_service_policy ON prediction.analyst_assessments TO service_role USING (true) WITH CHECK (true);


--
-- Name: analyst_overrides; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.analyst_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: analyst_overrides analyst_overrides_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY analyst_overrides_service_policy ON prediction.analyst_overrides TO service_role USING (true) WITH CHECK (true);


--
-- Name: evaluations; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluations evaluations_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY evaluations_service_policy ON prediction.evaluations TO service_role USING (true) WITH CHECK (true);


--
-- Name: learning_queue; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.learning_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_queue learning_queue_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY learning_queue_service_policy ON prediction.learning_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: learnings; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.learnings ENABLE ROW LEVEL SECURITY;

--
-- Name: learnings learnings_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY learnings_service_policy ON prediction.learnings TO service_role USING (true) WITH CHECK (true);


--
-- Name: missed_opportunities; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.missed_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: missed_opportunities missed_opportunities_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY missed_opportunities_service_policy ON prediction.missed_opportunities TO service_role USING (true) WITH CHECK (true);


--
-- Name: source_subscriptions prediction_source_subs_service_all; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY prediction_source_subs_service_all ON prediction.source_subscriptions TO service_role USING (true) WITH CHECK (true);


--
-- Name: predictions; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions predictions_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY predictions_service_policy ON prediction.predictions TO service_role USING (true) WITH CHECK (true);


--
-- Name: predictors; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.predictors ENABLE ROW LEVEL SECURITY;

--
-- Name: predictors predictors_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY predictors_service_policy ON prediction.predictors TO service_role USING (true) WITH CHECK (true);


--
-- Name: review_queue; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: review_queue review_queue_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY review_queue_service_policy ON prediction.review_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: signals; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.signals ENABLE ROW LEVEL SECURITY;

--
-- Name: signals signals_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY signals_service_policy ON prediction.signals TO service_role USING (true) WITH CHECK (true);


--
-- Name: snapshots; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: snapshots snapshots_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY snapshots_service_policy ON prediction.snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: source_subscriptions; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.source_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: strategies; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.strategies ENABLE ROW LEVEL SECURITY;

--
-- Name: strategies strategies_read_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY strategies_read_policy ON prediction.strategies FOR SELECT TO authenticated USING (true);


--
-- Name: strategies strategies_service_write_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY strategies_service_write_policy ON prediction.strategies TO service_role USING (true) WITH CHECK (true);


--
-- Name: target_snapshots; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.target_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: target_snapshots target_snapshots_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY target_snapshots_service_policy ON prediction.target_snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: targets; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.targets ENABLE ROW LEVEL SECURITY;

--
-- Name: targets targets_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY targets_service_policy ON prediction.targets TO service_role USING (true) WITH CHECK (true);


--
-- Name: tool_requests; Type: ROW SECURITY; Schema: prediction; Owner: -
--

ALTER TABLE prediction.tool_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: tool_requests tool_requests_service_policy; Type: POLICY; Schema: prediction; Owner: -
--

CREATE POLICY tool_requests_service_policy ON prediction.tool_requests TO service_role USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict HigtdUG5uM1ciDC8X6vXmZm1LJ0XDOz5I2IrPWtOp3d6sBeSXRAvZkYTWVt4qJj

