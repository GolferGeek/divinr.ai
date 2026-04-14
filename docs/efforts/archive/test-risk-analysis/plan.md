# Test: Risk Analysis & Debate — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: Chrome Testing — Risk Dashboard & Detail
- [x] Phase 2: Bug Fixes & Marketing

---

## Phase 1: Chrome Testing — Risk Dashboard & Detail
**Status**: Complete
**Note**: Full risk pipeline verified for GOOGL. Composite score with debate adjustment, 6 dimension assessments, and 3-column bull/bear/arbiter debate all rendering correctly.

### Steps
- [x] 1.1 Navigate to `/risk` → Risk Dashboard loads with Risk Dimensions (4 cards: Market 0.30, Fundamental 0.30, Technical 0.20, Macro 0.20)
- [x] 1.2 Instrument Risk Scores section → GOOGL card with score 62, MEDIUM verdict, 92% confidence, progress bar
- [x] 1.3 Click GOOGL → detail view with composite risk score gauge (62/100, MEDIUM RISK)
- [x] 1.4 Debate Impact shown: pre-debate 50 → post-debate 62, adjustment +12
- [x] 1.5 Score Trend bar chart rendering
- [x] 1.6 "RE-RUN DEBATE" and "RE-RUN RISK" buttons present (not tested to avoid load on Spark)
- [x] 1.7 Dimension Analysis: 6 dimensions with scores — Technical (88), Macro (80), Sentiment (80), Value Focus (80), Momentum (80), Fundamentals (75)
- [x] 1.8 Each dimension has HIGH/MEDIUM badge, confidence %, reasoning text, "Click to expand evidence"
- [x] 1.9 Risk Debate section: 3-column layout — Blue Agent (Defense), Red Agent (Challenge), Arbiter (Synthesis)
- [x] 1.10 Blue Agent provides methodological defense with key findings
- [x] 1.11 Red Agent challenges with geopolitical/supply chain risks
- [x] 1.12 Arbiter reconciles both sides, explains why score was adjusted from 50 to 62
- [x] 1.13 API verified: risk run completed with compositeScore=62, 6 dimensionAssessments, debate present (from prediction pipeline testing)

### Quality Gate
- [x] Risk dimensions with weights displayed
- [x] Instrument risk cards with score/verdict/confidence
- [x] Detail view: composite gauge, dimension breakdown, debate
- [x] Bull/bear/arbiter debate fully rendered with reasoning

---

## Phase 2: Bug Fixes & Marketing
**Status**: Complete

### Steps
- [x] 2.1 No bugs discovered
- [x] 2.2 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] **Marketing blurb written**
