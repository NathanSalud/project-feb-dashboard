import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SnowflakeService } from './snowflake.service';

describe('SnowflakeService', () => {
  let service: SnowflakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnowflakeService,
        // compile() constructs the service but does NOT run onModuleInit(),
        // so no real Snowflake connection is opened here.
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<SnowflakeService>(SnowflakeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
