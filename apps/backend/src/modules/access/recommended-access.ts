// Explicit permission profiles, not role-name authorization or wildcard grants.
// Operators choose the entity and role code; changing the code does not change policy checks.
export const recommendedAccessProfiles = {
  administrator: [
    'entities.read', 'network.read', 'network.write', 'network.master-write',
    'bookings.create', 'bookings.read', 'bookings.release', 'allocations.write',
    'waiting-list.create', 'waiting-list.read', 'waiting-list.allocate', 'waiting-list.cancel',
    'analysis.create', 'analysis.read', 'analysis.bulk', 'imports.write',
    'jobs.read', 'jobs.manage', 'reports.read', 'reports.export',
    'notifications.read', 'notifications.receive', 'audit.read',
    'settings.read', 'settings.write', 'settings.approve-operational', 'settings.approve-engineering',
  ],
  'policy-requester': ['settings.read', 'settings.write', 'notifications.read'],
  'policy-approver-operational': ['settings.read', 'settings.approve-operational', 'notifications.read', 'audit.read'],
  'policy-approver-engineering': ['settings.read', 'settings.approve-engineering', 'notifications.read', 'audit.read'],
} as const
