import { createKubernetesDriver } from '@ankhorage/kubernetes';

const driver = createKubernetesDriver();

console.log(driver.kind);
