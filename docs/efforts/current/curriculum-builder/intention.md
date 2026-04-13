# Effort: Curriculum Builder

## Problem

University professors and financial literacy programs want structured multi-week learning paths, not just ad-hoc tournaments and challenges. There's no way to sequence activities, track progress through a syllabus, or assign specific learning objectives.

## Intention

Build a curriculum system where club admins create structured multi-week courses with sequenced activities — each week has assigned instruments, prediction challenges, required journal entries, and a tournament. Students progress through the curriculum with tracked completion and scores.

## Scope

- Curriculum entity: name, description, weeks, club_id
- Weekly modules: each week has a theme, assigned instruments, a prediction challenge, a consensus poll, and a tournament
- Student progress tracking: completion %, scores per week
- Auto-unlock: next week unlocks when current week's activities are completed
- Curriculum templates: pre-built curricula for common courses (Intro to Markets, Technical Analysis, Fundamental Analysis)
- Professor dashboard: class-wide progress view, individual student scores

## Dependencies
- Learning clubs must ship first
- Learning activities (challenges, polls, journals) must exist
