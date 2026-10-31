import { afterEach, expect, it, vi } from 'vitest';
import demo from '../../data/demo.json';
import type { Part } from '../types';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it('keeps shared inspection records on the server without rewriting a workstation archive', async () => {
  vi.resetModules(); vi.stubEnv('VITE_DATA_MODE', 'api');
  const writeStorage = vi.fn(() => { throw new Error('Browser storage disabled'); });
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: writeStorage });
  const response = { id: 'server-run', jobNumber: 'JOB-SHARED', measurements: [] };
  const fetchServer = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal('fetch', fetchServer);
  const { startRun } = await import('./data');
  const run = await startRun(demo.parts[3] as Part, { jobNumber: 'JOB-SHARED', inspector: 'Operator', sampleNumber: '01', lotNumber: '' });
  expect(run.id).toBe('server-run');
  expect(fetchServer).toHaveBeenCalledWith('/api/runs', expect.objectContaining({ method: 'POST' }));
  expect(writeStorage).not.toHaveBeenCalled();
});
