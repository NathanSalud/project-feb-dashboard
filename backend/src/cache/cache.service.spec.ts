import { CacheService } from './cache.service';

// Direct instantiation with a mocked SnowflakeService (no Nest DI, no onModuleInit
// → no cron / no preload). We exercise the lazy per-tenant timeseries/discounts paths.
describe('CacheService lazy per-tenant caching', () => {
  let svc: CacheService;
  let query: jest.Mock;

  // returns one row tagged with the bound company so isolation is observable
  const tenantRow = (company: string) => ({
    COMPANY_NAME: company,
    ACCOUNT_NAME: 'acc',
    PLATFORM: 'Shopee',
    ORDER_DATE: '2024-01-01',
    ORDERS: 1,
    REVENUE: 10,
  });

  beforeEach(() => {
    query = jest.fn();
    svc = new CacheService({ query } as any);
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  });

  it('tenant fetch binds COMPANY_NAME and isolates tenants', async () => {
    query.mockImplementation((_sql: string, binds: any[]) =>
      Promise.resolve([tenantRow(binds[0])]),
    );

    const a = await svc.getTimeSeries('Company A', false);
    expect(a).toEqual([tenantRow('Company A')]);
    expect(query.mock.calls[0][0]).toContain('a.COMPANY_NAME = ?');
    expect(query.mock.calls[0][1]).toEqual(['Company A']);

    const b = await svc.getTimeSeries('Company B', false);
    expect(b).toEqual([tenantRow('Company B')]);
    // A never sees B and vice versa
    expect(a.every(r => r.COMPANY_NAME === 'Company A')).toBe(true);
    expect(b.every(r => r.COMPANY_NAME === 'Company B')).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('serves a second same-tenant request from cache (no re-query)', async () => {
    query.mockResolvedValue([tenantRow('Company A')]);
    await svc.getTimeSeries('Company A', false);
    await svc.getTimeSeries('Company A', false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('caches empty results so empty tenants do not re-hit Snowflake', async () => {
    query.mockResolvedValue([]);
    const first = await svc.getTimeSeries('Empty Co', false);
    const second = await svc.getTimeSeries('Empty Co', false);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('admin path queries all tenants, unbound, and is NOT cached', async () => {
    query.mockResolvedValue([tenantRow('A'), tenantRow('B')]);
    const r1 = await svc.getTimeSeries('GDEC Admin', true);
    expect(r1).toHaveLength(2); // sees multiple companies
    expect(query.mock.calls[0][0]).not.toContain('a.COMPANY_NAME = ?');
    expect(query.mock.calls[0][1]).toBeUndefined();
    expect((svc as any).timeseriesByCompany.size).toBe(0); // nothing resident

    await svc.getTimeSeries('GDEC Admin', true);
    expect(query).toHaveBeenCalledTimes(2); // re-queried, uncached
  });

  it('serializes concurrent admin loads (mutex → max concurrency 1)', async () => {
    let active = 0;
    let maxActive = 0;
    query.mockImplementation(
      () =>
        new Promise(resolve => {
          active++;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => {
            active--;
            resolve([]);
          }, 10);
        }),
    );
    await Promise.all([
      svc.getTimeSeries('GDEC Admin', true),
      svc.getDiscounts('GDEC Admin', true),
    ]);
    expect(maxActive).toBe(1);
  });

  it('de-dupes concurrent cache misses into one Snowflake query', async () => {
    let resolveFn!: (rows: any[]) => void;
    query.mockReturnValueOnce(new Promise(res => (resolveFn = res)));
    const p1 = svc.getTimeSeries('Company A', false);
    const p2 = svc.getTimeSeries('Company A', false);
    resolveFn([tenantRow('Company A')]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  it('applies day-level date filtering over Date and string ORDER_DATE', async () => {
    query.mockResolvedValue([
      { COMPANY_NAME: 'A', ORDER_DATE: '2024-01-01', REVENUE: 10, ORDERS: 1, PLATFORM: 'S', ACCOUNT_NAME: 'a' },
      { COMPANY_NAME: 'A', ORDER_DATE: new Date('2024-02-15T00:00:00Z'), REVENUE: 20, ORDERS: 2, PLATFORM: 'S', ACCOUNT_NAME: 'a' },
      { COMPANY_NAME: 'A', ORDER_DATE: '2024-03-01', REVENUE: 30, ORDERS: 3, PLATFORM: 'S', ACCOUNT_NAME: 'a' },
    ]);
    const res = await svc.getTimeSeries('A', false, '2024-01-15', '2024-02-28');
    expect(res.map((r: any) => r.REVENUE)).toEqual([20]);
  });

  it('bounds the cache by MAX_TENANTS (LRU evicts oldest)', async () => {
    (svc as any).MAX_TENANTS = 2;
    query.mockImplementation((_sql: string, binds: any[]) => Promise.resolve([tenantRow(binds[0])]));
    await svc.getTimeSeries('A', false);
    await svc.getTimeSeries('B', false);
    await svc.getTimeSeries('C', false);
    const store = (svc as any).timeseriesByCompany as Map<string, unknown>;
    expect(store.size).toBe(2);
    expect(store.has('A')).toBe(false); // oldest evicted
    expect(store.has('B')).toBe(true);
    expect(store.has('C')).toBe(true);
  });

  it('re-queries after TTL expiry', async () => {
    query.mockResolvedValue([tenantRow('A')]);
    await svc.getTimeSeries('A', false);
    // force the cached entry to be expired
    (svc as any).timeseriesByCompany.get('A').expiresAt = Date.now() - 1;
    await svc.getTimeSeries('A', false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('clearLazyCaches empties all four maps', async () => {
    query.mockResolvedValue([tenantRow('A')]);
    await svc.getTimeSeries('A', false);
    await svc.getDiscounts('A', false);
    expect((svc as any).timeseriesByCompany.size).toBe(1);
    expect((svc as any).discountsByCompany.size).toBe(1);
    (svc as any).clearLazyCaches();
    expect((svc as any).timeseriesByCompany.size).toBe(0);
    expect((svc as any).discountsByCompany.size).toBe(0);
    expect((svc as any).timeseriesInflight.size).toBe(0);
    expect((svc as any).discountsInflight.size).toBe(0);
  });

  it('TENANT_CACHE=ondemand disables caching (re-queries, nothing resident)', async () => {
    (svc as any).TENANT_CACHE_MODE = 'ondemand';
    query.mockResolvedValue([tenantRow('A')]);
    await svc.getTimeSeries('A', false);
    await svc.getTimeSeries('A', false);
    expect(query).toHaveBeenCalledTimes(2);
    expect((svc as any).timeseriesByCompany.size).toBe(0);
  });
});
