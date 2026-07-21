import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { CacheService } from './cache/cache.service';

describe('AppController', () => {
  let appController: AppController;
  const cache = { getStatus: jest.fn().mockReturnValue({ loaded: true }) };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: CacheService, useValue: cache }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('reports ok and includes cache status', () => {
      const res = appController.health();
      expect(res.status).toBe('ok');
      expect(res.cache).toEqual({ loaded: true });
      expect(typeof res.timestamp).toBe('string');
    });
  });
});
