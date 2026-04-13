# Effort: Navigation Redesign

## Problem
The left sidebar has 16+ items in a flat list (Dashboard, Performance, Instruments, Analysts, Coordination, Runs, Risk, Portfolios, Sources, Evaluations, Learning, Proposals, Affinity, Clubs, Tournaments, Messages, Notifications). This is intimidating for new users and makes it hard to find things.

## Intention
Reorganize the sidebar into logical groups with collapsible sections, so new users see a clean entry point and power users can still access everything.

## Scope
- Group nav items into sections (e.g., "Markets", "AI Analysts", "Learning", "Social", "Admin")
- Collapsible section headers — default collapsed for non-essential sections
- Highlight the most important items for new users (Dashboard, Portfolios, Clubs)
- Consider hiding admin-only items (Runs, Sources, Evaluations, Coordination) for non-admin users
- Role-based visibility: members see a simpler nav than owners/admins
- Mobile: keep hamburger menu but with grouped sections

## Possible Grouping
- **Home**: Dashboard
- **Markets**: Instruments, Portfolios, Risk
- **AI Analysts**: Analysts, Coordination, Performance, Affinity
- **Learning**: Evaluations, Learning, Proposals
- **Social**: Clubs, Tournaments, Messages
- **System** (admin only): Runs, Sources, Notifications

## Out of Scope
- Redesigning individual page layouts
- New features
