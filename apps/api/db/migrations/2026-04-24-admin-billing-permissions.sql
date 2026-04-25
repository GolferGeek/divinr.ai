-- Phase 5 of stripe-integration: seed RBAC permissions for the
-- admin refund/credit/comp endpoints. Mirrors the markets-instruments-* /
-- markets-instruments-write pattern using stable text IDs so seed scripts
-- and code can reference them by id without UUID lookups.

INSERT INTO authz.rbac_permissions (id, name, display_name, description, category)
VALUES
  ('admin-billing-refund', 'admin.billing.refund', 'Issue Stripe refunds',  'Issue full or partial refunds against a Stripe invoice from the admin user-billing view.', 'billing'),
  ('admin-billing-credit', 'admin.billing.credit', 'Issue customer credit', 'Apply a one-time customer balance credit (Stripe customer balance transaction). Reduces the next invoice.', 'billing'),
  ('admin-billing-comp',   'admin.billing.comp',   'Comp billing periods',  'Apply a 100%-off coupon to a customer for N billing cycles. Used for support comps, beta credits, etc.', 'billing')
ON CONFLICT (id) DO NOTHING;

-- Grant all three to role-admin and role-super-admin. role-owner gets them
-- too — owners always carry admin permissions in this system.
INSERT INTO authz.rbac_role_permissions (role_id, permission_id)
SELECT role_id, perm_id
FROM (VALUES
  ('role-admin'),
  ('role-super-admin'),
  ('role-owner')
) AS r(role_id),
(VALUES
  ('admin-billing-refund'),
  ('admin-billing-credit'),
  ('admin-billing-comp')
) AS p(perm_id)
WHERE EXISTS (SELECT 1 FROM authz.rbac_roles WHERE id = r.role_id)
ON CONFLICT (role_id, permission_id) DO NOTHING;
