import { isInfraAdapterDescriptor } from '@ankhorage/contracts/infra';
import { describe, expect, it } from 'bun:test';

import * as packageApi from './index';

describe('Kubernetes driver foundation', () => {
  it('exports a driver entrypoint without claiming a selectable adapter identity', () => {
    expect(packageApi.createKubernetesDriver()).toEqual({ kind: 'kubernetes' });
    expect('infraAdapterDescriptor' in packageApi).toBe(false);
    expect(isInfraAdapterDescriptor(packageApi.createKubernetesDriver())).toBe(false);
  });
});
