// src/services/time-off.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TimeOffService } from './time-off.service';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { UnprocessableEntityException } from '@nestjs/common';

describe('TimeOffService', () => {
  let service: TimeOffService;

  // 1. Create a fake database transaction runner
  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      findOne: jest.fn(),
      save: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        {
          provide: DataSource, // Fake the Database
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
            manager: {
              findOne: jest.fn(),
            }
          },
        },
        {
          provide: HttpService, // Fake the Network Calls
          useValue: {
            post: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw an error if cancelling a non-existent request', async () => {
    // Force the fake database to return "null" (no request found)
    jest.spyOn(service['dataSource'].manager, 'findOne').mockResolvedValueOnce(null);

    await expect(service.cancelRequest('fake-id')).rejects.toThrow(UnprocessableEntityException);
  });
});