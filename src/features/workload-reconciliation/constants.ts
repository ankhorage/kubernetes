export const KUBERNETES_OWNERSHIP = {
  managedByLabel: 'app.kubernetes.io/managed-by',
  managedByValue: 'ankhorage-infra',
  projectLabel: 'infra.ankhorage.dev/project',
  environmentLabel: 'infra.ankhorage.dev/environment',
  projectAnnotation: 'infra.ankhorage.dev/project-id',
  environmentAnnotation: 'infra.ankhorage.dev/environment',
  adapterAnnotation: 'infra.ankhorage.dev/adapter',
  resourceAnnotation: 'infra.ankhorage.dev/resource-id',
  persistentAnnotation: 'infra.ankhorage.dev/persistent',
  retentionAnnotation: 'infra.ankhorage.dev/retention',
  dependenciesAnnotation: 'infra.ankhorage.dev/depends-on',
} as const;
