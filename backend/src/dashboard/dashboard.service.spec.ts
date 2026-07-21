import { BadRequestException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

// Direct instantiation with a mocked CacheService.
describe('DashboardService', () => {
  let service: DashboardService;
  let cache: { getTimeSeries: jest.Mock; getDiscounts: jest.Mock };

  beforeEach(() => {
    cache = {
      getTimeSeries: jest.fn().mockResolvedValue([{ COMPANY_NAME: 'A' }]),
      getDiscounts: jest.fn().mockResolvedValue([{ COMPANY_NAME: 'A' }]),
    };
    service = new DashboardService(cache as any);
  });

  it('validates date FORMAT before hitting the cache (malformed → 400, no fetch)', async () => {
    // validateDates only checks YYYY-MM-DD shape, so use a shape-invalid string.
    await expect(service.getTimeSeries('A', false, 'bad-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(cache.getTimeSeries).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date (month 13) before fetching', async () => {
    await expect(service.getTimeSeries('A', false, '2023-13-45')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(cache.getTimeSeries).not.toHaveBeenCalled();
  });

  it('rejects dateFrom after dateTo before fetching', async () => {
    await expect(
      service.getDiscounts('A', false, '2024-02-01', '2024-01-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(cache.getDiscounts).not.toHaveBeenCalled();
  });

  it('passes through the awaited bare array unchanged', async () => {
    const res = await service.getTimeSeries('A', false, '2024-01-01', '2024-02-01');
    expect(res).toEqual([{ COMPANY_NAME: 'A' }]);
    expect(cache.getTimeSeries).toHaveBeenCalledWith('A', false, '2024-01-01', '2024-02-01');
  });
});
