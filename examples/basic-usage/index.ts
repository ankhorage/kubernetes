import type { KubernetesApi } from '@ankhorage/kubernetes';
import { createKubernetesDriver } from '@ankhorage/kubernetes';

declare const authenticatedClusterApi: KubernetesApi;
const driver = createKubernetesDriver({ api: authenticatedClusterApi });

console.log(driver.kind);
