import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

describe('DashboardController', () => {
  let controller: DashboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: {
            getKpis: jest.fn(),
            getTimeSeries: jest.fn(),
            getShops: jest.fn(),
            getProducts: jest.fn(),
            getAccounts: jest.fn(),
            getGeo: jest.fn(),
            getDiscounts: jest.fn(),
            getDoi: jest.fn(),
          },
        },
      ],
    })
      // Controller is guarded at class level; stub the guard so the test module
      // doesn't need JwtService/ConfigService.
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
